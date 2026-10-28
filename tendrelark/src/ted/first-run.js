import { addDays, todayIso } from '../lib/dates.js';
import { createTedClient } from './client.js';
import { ingestTed, probeTed, reconcileTed } from './ingest.js';

const pct = (n, total) => (total ? Math.round((n / total) * 1000) / 10 : 0);

/**
 * How well did the real data fit what we assumed? For the notices stored by one run, count how many
 * ended up with each field filled in. A low number points at a field shape we did not expect.
 */
export function measureFieldCoverage(db, runId) {
  const total = db.prepare('SELECT COUNT(*) AS n FROM ted_notices WHERE last_run_id = ?').get(runId).n;
  const count = (where) => db.prepare(`SELECT COUNT(*) AS n FROM ted_notices t WHERE t.last_run_id = ? AND ${where}`).get(runId).n;
  const fields = {
    title: count("t.title IS NOT NULL AND t.title <> ''"),
    buyer: count("t.buyer_name IS NOT NULL AND t.buyer_name <> ''"),
    publicationDate: count('t.publication_date IS NOT NULL'),
    deadline: count('t.deadline_at IS NOT NULL'),
    noticeType: count("t.notice_type IS NOT NULL AND t.notice_type <> ''"),
    cpv: count('EXISTS (SELECT 1 FROM ted_notice_cpv p WHERE p.notice_id = t.id)'),
    country: count('EXISTS (SELECT 1 FROM ted_notice_countries c WHERE c.notice_id = t.id)'),
  };
  return { total, fields: Object.fromEntries(Object.entries(fields).map(([k, n]) => [k, { count: n, percent: pct(n, total) }])) };
}

/** Which keys the API really returned, as a share of the stored raw notices. Shows renamed or missing fields. */
export function measureRawKeys(db, runId, limit = 500) {
  const rows = db.prepare('SELECT raw FROM ted_notices WHERE last_run_id = ? LIMIT ?').all(runId, limit);
  const seen = new Map();
  for (const { raw } of rows) {
    let obj;
    try {
      obj = JSON.parse(raw);
    } catch {
      continue;
    }
    for (const [key, value] of Object.entries(obj)) {
      const empty = value == null || value === '' || (Array.isArray(value) && value.length === 0) || (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0);
      if (!empty) seen.set(key, (seen.get(key) ?? 0) + 1);
    }
  }
  return { sampled: rows.length, keys: Object.fromEntries([...seen.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => [k, pct(n, rows.length)])) };
}

/**
 * The first real run against TED. It probes the API, imports the last `days` days, compares the result
 * with TED's own counts, and measures how well the data fits. Everything it finds that looks wrong goes
 * into `problems`, in plain words. Meant to be run once from a machine that can reach TED.
 */
export async function runFirstCheck(db, config, { days = 30, client = createTedClient(config), log = () => {}, now = new Date() } = {}) {
  const today = todayIso(now);
  const result = { startedAt: now.toISOString(), days, countries: config.ted.countries, problems: [], notes: [] };

  // 1. Can we talk to the API at all, and which optional fields does it accept?
  try {
    result.probe = await probeTed(config, { client });
  } catch (err) {
    result.probe = null;
    result.problems.push(`Could not query the TED API: ${err.status ? `HTTP ${err.status}. ${String(err.body ?? '').slice(0, 300)}` : err.message}. Nothing was imported. Check this machine can reach api.ted.europa.eu.`);
    return finish(result);
  }
  const rejected = result.probe.fields.filter((f) => !f.accepted).map((f) => f.field);
  if (rejected.length) result.notes.push(`TED rejected these optional fields: ${rejected.join(', ')}. The importer falls back to core fields if needed, or set TED_FIELDS to the accepted list.`);
  if (!result.probe.core.sample) result.problems.push('The probe query returned no notice at all, so the field shapes could not be checked.');

  // 2. Import the window for real.
  result.ingest = await ingestTed(db, config, { from: addDays(today, -days), to: today, client, log });
  if (result.ingest.status === 'failed') result.problems.push(`The import failed: ${result.ingest.errors.slice(0, 3).join(' | ')}`);
  else if (result.ingest.status === 'empty') result.problems.push('TED returned no notices for the window. Nothing was stored.');
  else if (result.ingest.status === 'partial') result.problems.push(`The import was only partly complete (${result.ingest.failed} notices could not be parsed, ${result.ingest.errors.length} errors).`);
  if (result.ingest.fieldsTier === 'core') result.notes.push('The import used the core fields only, so deadlines, CPV codes and notice types will be missing.');

  // 3. Does what we stored match what TED says exists?
  try {
    result.reconcile = await reconcileTed(db, config, { days, to: addDays(today, -1), client });
    for (const r of result.reconcile.rows.filter((x) => x.missing !== 0)) {
      result.problems.push(`${r.country}: TED has ${r.tedCount} notices for ${r.from} to ${r.to} but ${r.storedCount} are stored (${r.missing > 0 ? `${r.missing} missing` : `${-r.missing} more than TED reports`}).`);
    }
  } catch (err) {
    result.reconcile = null;
    result.problems.push(`The completeness check could not run: ${err.message}`);
  }

  // 4. How well did the real data fit what we assumed?
  if (result.ingest.runId) {
    result.coverage = measureFieldCoverage(db, result.ingest.runId);
    result.rawKeys = measureRawKeys(db, result.ingest.runId);
    const f = result.coverage.fields;
    if (result.coverage.total > 0) {
      if (f.title.percent < 90) result.problems.push(`Only ${f.title.percent}% of notices got a title. The shape of "notice-title" may differ from what the code expects.`);
      if (f.buyer.percent < 90) result.problems.push(`Only ${f.buyer.percent}% of notices got a buyer name. The shape of "buyer-name" may differ from what the code expects.`);
      if (f.publicationDate.percent < 99) result.problems.push(`Only ${f.publicationDate.percent}% of notices got a publication date.`);
      if (result.ingest.fieldsTier !== 'core' && f.cpv.percent === 0) result.problems.push('No notice got a CPV code, so sector filters and newsletter relevance will not work. Check "classification-cpv".');
      if (result.ingest.fieldsTier !== 'core' && f.deadline.percent === 0) result.notes.push('No notice got a deadline. Some notice types (for example award notices) legitimately have none, but check "deadline-receipt-tender-date-lot".');
    }
    result.sample = db
      .prepare('SELECT publication_number, title, buyer_name, primary_country, publication_date, deadline_at, url FROM ted_notices WHERE last_run_id = ? ORDER BY publication_date DESC, id DESC LIMIT 3')
      .all(result.ingest.runId);
  }
  return finish(result);
}

function finish(result) {
  result.ok = result.problems.length === 0;
  return result;
}

/** A plain text report that is safe to paste into an issue or an email. It contains no secrets. */
export function renderFirstRunReport(r) {
  const lines = [`TED first run report`, `Run at ${r.startedAt}. Window: last ${r.days} days. Countries: ${r.countries.join(', ')}.`, ''];

  lines.push('1. API');
  if (r.probe) {
    lines.push(`   Reachable. Probe query: ${r.probe.query}`);
    lines.push(`   Notices matching the probe query: ${r.probe.core.totalNoticeCount ?? 'unknown'}`);
    for (const f of r.probe.fields) lines.push(`   Field ${f.field}: ${f.accepted ? 'accepted' : `REJECTED (${f.error})`}`);
  } else lines.push('   NOT reachable.');

  if (r.ingest) {
    const i = r.ingest;
    lines.push('', '2. Import', `   Status: ${i.status}. Fields used: ${i.fieldsTier}. Window ${i.window.from} to ${i.window.to}.`);
    lines.push(`   Fetched ${i.fetched}, new ${i.inserted}, changed ${i.updated}, unchanged ${i.unchanged}, could not parse ${i.failed}.`);
    for (const e of i.errors.slice(0, 5)) lines.push(`   Error: ${e}`);
  }
  if (r.reconcile) {
    lines.push('', '3. Completeness against TED’s own counts');
    for (const x of r.reconcile.rows) lines.push(`   ${x.country} ${x.from} to ${x.to}: TED ${x.tedCount}, stored ${x.storedCount}, ${x.missing === 0 ? 'OK' : `DIFFERENCE ${x.missing}`}`);
  }
  if (r.coverage) {
    lines.push('', `4. How well the data fits (${r.coverage.total} notices from this run)`);
    for (const [name, v] of Object.entries(r.coverage.fields)) lines.push(`   ${name.padEnd(16)} ${String(v.percent).padStart(5)}%  (${v.count})`);
    const keys = Object.entries(r.rawKeys.keys);
    if (keys.length) lines.push(`   Keys TED actually returned (share of ${r.rawKeys.sampled} sampled): ${keys.map(([k, p]) => `${k} ${p}%`).join(', ')}`);
  }
  if (r.sample?.length) {
    lines.push('', '5. Newest stored notices');
    for (const n of r.sample) lines.push(`   ${n.publication_number} | ${n.primary_country} | ${n.publication_date} | ${n.title ?? '(no title)'} | ${n.buyer_name ?? '(no buyer)'} | ${n.url}`);
  }
  if (r.notes.length) lines.push('', 'Notes', ...r.notes.map((n) => `   - ${n}`));
  lines.push('', r.ok ? 'RESULT: no problems found.' : `RESULT: ${r.problems.length} problem${r.problems.length === 1 ? '' : 's'} found.`);
  for (const p of r.problems) lines.push(`   - ${p}`);
  return `${lines.join('\n')}\n`;
}
