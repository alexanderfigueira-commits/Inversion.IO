import { getMeta, nowIso, setMeta, tx } from '../db/index.js';
import { addDays, daysBetween, todayIso, toTedDate } from '../lib/dates.js';
import { CORE_FIELDS, EXTENDED_FIELDS, TedApiError, createTedClient } from './client.js';
import { normalizeNotice } from './normalize.js';

export const WATERMARK_KEY = 'ted_watermark';
const CHUNK_DAYS = 7;
const MAX_PAGES = 200;
const STALE_RUN_MINUTES = 60;

export function buildQuery(country, from, to) {
  return `buyer-country=${country} AND publication-date>=${toTedDate(from)} AND publication-date<=${toTedDate(to)}`;
}

/** Splits [from, to] into consecutive chunks of at most CHUNK_DAYS days. */
export function chunkWindow(from, to) {
  const chunks = [];
  let start = from;
  while (start <= to) {
    const end = addDays(start, CHUNK_DAYS - 1);
    chunks.push({ from: start, to: end < to ? end : to });
    start = addDays(end, 1);
  }
  return chunks;
}

/**
 * Inserts or updates one notice. The unique publication number makes this idempotent: reading
 * the same notice twice never creates a second row. Returns 'inserted', 'updated' or 'unchanged'.
 * Must be called inside a transaction.
 */
export function upsertNotice(db, n, runId, now = nowIso()) {
  const existing = db.prepare('SELECT id, content_hash FROM ted_notices WHERE publication_number = ?').get(n.publication_number);
  let id;
  let outcome;

  if (!existing) {
    id = Number(
      db
        .prepare(
          `INSERT INTO ted_notices (publication_number, title, buyer_name, primary_country, notice_type, publication_date,
             deadline_at, url, raw, content_hash, first_seen_at, last_seen_at, updated_at, last_run_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(n.publication_number, n.title, n.buyer_name, n.primary_country, n.notice_type, n.publication_date, n.deadline_at, n.url, n.raw, n.content_hash, now, now, now, runId).lastInsertRowid,
    );
    outcome = 'inserted';
  } else if (existing.content_hash === n.content_hash) {
    id = existing.id;
    db.prepare('UPDATE ted_notices SET last_seen_at = ?, last_run_id = ? WHERE id = ?').run(now, runId, id);
    outcome = 'unchanged';
  } else {
    id = existing.id;
    db.prepare(
      `UPDATE ted_notices SET title = ?, buyer_name = ?, primary_country = COALESCE(primary_country, ?), notice_type = ?,
         publication_date = ?, deadline_at = ?, url = ?, raw = ?, content_hash = ?, last_seen_at = ?, updated_at = ?, last_run_id = ?
       WHERE id = ?`,
    ).run(n.title, n.buyer_name, n.primary_country, n.notice_type, n.publication_date, n.deadline_at, n.url, n.raw, n.content_hash, now, now, runId, id);
    outcome = 'updated';
  }

  const addCountry = db.prepare('INSERT OR IGNORE INTO ted_notice_countries (notice_id, country) VALUES (?, ?)');
  for (const c of n.countries) addCountry.run(id, c);

  // CPV codes can change when a notice is corrected, so they are replaced, not merged.
  if (outcome !== 'unchanged') {
    db.prepare('DELETE FROM ted_notice_cpv WHERE notice_id = ?').run(id);
    const addCpv = db.prepare('INSERT OR IGNORE INTO ted_notice_cpv (notice_id, cpv_code) VALUES (?, ?)');
    for (const code of n.cpv_codes) addCpv.run(id, code);
  }
  return outcome;
}

function startRun(db, from, to) {
  // Clean up runs that died without finishing, then refuse to overlap a live one.
  const cutoff = new Date(Date.now() - STALE_RUN_MINUTES * 60_000).toISOString();
  db.prepare(
    `UPDATE ingestion_runs SET status = 'failed', finished_at = ?, error = 'Interrupted: the process ended before the run finished.'
     WHERE source_slug = 'ted' AND status = 'running' AND started_at < ?`,
  ).run(nowIso(), cutoff);
  const live = db.prepare("SELECT id FROM ingestion_runs WHERE source_slug = 'ted' AND status = 'running'").get();
  if (live) throw new Error(`A TED ingestion run (#${live.id}) is already in progress.`);
  return Number(
    db
      .prepare("INSERT INTO ingestion_runs (source_slug, started_at, status, window_from, window_to) VALUES ('ted', ?, 'running', ?, ?)")
      .run(nowIso(), from, to).lastInsertRowid,
  );
}

/**
 * Reads TED notices for the configured countries and stores them.
 *
 * Window: from the saved watermark minus the overlap (so late or corrected notices are caught), or
 * the backfill period on a first run, up to today. The watermark only moves forward after a run in
 * which every chunk succeeded, so a partial run is simply repeated next time.
 */
export async function ingestTed(db, config, { from, to, client = createTedClient(config), log = () => {} } = {}) {
  const today = todayIso();
  const watermark = getMeta(db, WATERMARK_KEY);
  const windowTo = to ?? today;
  const windowFrom = from ?? (watermark ? addDays(watermark, -config.ted.overlapDays) : addDays(today, -config.ted.backfillDays));
  if (windowFrom > windowTo) throw new Error(`Invalid window: ${windowFrom} is after ${windowTo}.`);

  const runId = startRun(db, windowFrom, windowTo);
  const totals = { fetched: 0, inserted: 0, updated: 0, unchanged: 0, failed: 0 };
  const errors = [];
  let chunksOk = 0;
  let chunksTotal = 0;
  let tier = config.ted.fields ? 'custom' : 'extended';

  const fieldsFor = () => (config.ted.fields ?? (tier === 'extended' ? EXTENDED_FIELDS : CORE_FIELDS));

  async function fetchPage(query, page) {
    try {
      return await client.search({ query, fields: fieldsFor(), page, limit: config.ted.pageSize });
    } catch (err) {
      // TED rejects a request outright if one field name is unknown. Drop to the core fields once
      // and carry on, but record that we did so the loss of detail is visible.
      if (err instanceof TedApiError && err.status === 400 && tier === 'extended') {
        tier = 'core';
        log(`TED rejected the extended field list (${err.body.slice(0, 200)}). Continuing with core fields.`);
        return client.search({ query, fields: fieldsFor(), page, limit: config.ted.pageSize });
      }
      throw err;
    }
  }

  try {
    for (const country of config.ted.countries) {
      for (const chunk of chunkWindow(windowFrom, windowTo)) {
        chunksTotal += 1;
        const query = buildQuery(country, chunk.from, chunk.to);
        try {
          let page = 1;
          let seen = 0;
          for (;;) {
            if (page > MAX_PAGES) throw new Error(`More than ${MAX_PAGES} pages for ${country} ${chunk.from} to ${chunk.to}. Narrow the window.`);
            const body = await fetchPage(query, page);
            const notices = Array.isArray(body?.notices) ? body.notices : [];
            if (!Array.isArray(body?.notices)) throw new Error('TED response had no "notices" array.');

            const now = nowIso();
            tx(db, () => {
              for (const raw of notices) {
                totals.fetched += 1;
                const normalized = normalizeNotice(raw, { queryCountry: country });
                if (!normalized) {
                  totals.failed += 1;
                  continue;
                }
                totals[upsertNotice(db, normalized, runId, now)] += 1;
              }
            });

            seen += notices.length;
            const total = Number(body.totalNoticeCount);
            if (notices.length === 0 || (Number.isFinite(total) && seen >= total)) break;
            page += 1;
          }
          chunksOk += 1;
          log(`${country} ${chunk.from} to ${chunk.to}: ${seen} notices`);
        } catch (err) {
          errors.push(`${country} ${chunk.from} to ${chunk.to}: ${err.message}`);
          log(`FAILED ${country} ${chunk.from} to ${chunk.to}: ${err.message}`);
        }
      }
    }
  } catch (err) {
    errors.push(err.message);
  }

  // A run that reads every chunk but gets nothing back is not a success. Across several days and
  // three countries TED always has notices, so an empty answer points at a wrong query, a field
  // problem or an API change. It gets its own status, says so in the run record, and the
  // watermark stays put so the same window is read again.
  const allRead = chunksOk === chunksTotal;
  const empty = allRead && totals.fetched === 0;
  const status = empty ? 'empty' : allRead && totals.failed === 0 ? 'ok' : chunksOk === 0 ? 'failed' : 'partial';
  if (empty) {
    errors.push(`TED returned 0 notices for ${config.ted.countries.join(', ')} from ${windowFrom} to ${windowTo}. Nothing was stored and this is not counted as a successful import.`);
  }
  db.prepare(
    `UPDATE ingestion_runs SET status = ?, finished_at = ?, fields_tier = ?, fetched = ?, inserted = ?, updated = ?, unchanged = ?, failed = ?, error = ?
     WHERE id = ?`,
  ).run(status, nowIso(), tier, totals.fetched, totals.inserted, totals.updated, totals.unchanged, totals.failed, errors.length ? errors.join('\n').slice(0, 2000) : null, runId);

  // Advance only when every chunk was read. A notice we could not parse is recorded as failed but
  // must not pin the watermark in place, or each run would re-read an ever larger window.
  if (allRead && !empty && (!watermark || windowTo > watermark)) setMeta(db, WATERMARK_KEY, windowTo);

  // complete: every chunk was read and TED returned something. A notice we could not parse does not
  // make a run incomplete (retrying would not fix it), but a failed chunk or an empty answer does.
  return { runId, status, complete: allRead && !empty, window: { from: windowFrom, to: windowTo }, fieldsTier: tier, ...totals, errors };
}

export function latestRuns(db, limit = 5) {
  return db.prepare("SELECT * FROM ingestion_runs WHERE source_slug = 'ted' ORDER BY id DESC LIMIT ?").all(limit);
}

export function lastSuccessfulRun(db) {
  return db.prepare("SELECT * FROM ingestion_runs WHERE source_slug = 'ted' AND status = 'ok' ORDER BY id DESC LIMIT 1").get() ?? null;
}

/**
 * Asks TED how many notices exist for each country over the last `days` days, counts what we hold
 * for the same window, and reports the difference. This is the check that proves persistence: a
 * non zero gap means notices were missed, dropped or never written to disk.
 */
export async function reconcileTed(db, config, { days = 14, to, client = createTedClient(config) } = {}) {
  const windowTo = to ?? addDays(todayIso(), -1); // yesterday: today's publications may still be arriving
  const windowFrom = addDays(windowTo, -(days - 1));
  const rows = [];

  for (const country of config.ted.countries) {
    const body = await client.search({ query: buildQuery(country, windowFrom, windowTo), fields: ['publication-number'], page: 1, limit: 1 });
    const api = Number(body?.totalNoticeCount);
    if (!Number.isFinite(api)) throw new Error(`TED did not return totalNoticeCount for ${country}.`);
    const held = db
      .prepare(
        `SELECT COUNT(*) AS n FROM ted_notices t
         JOIN ted_notice_countries c ON c.notice_id = t.id
         WHERE c.country = ? AND t.publication_date >= ? AND t.publication_date <= ?`,
      )
      .get(country, windowFrom, windowTo).n;
    rows.push({ country, from: windowFrom, to: windowTo, tedCount: api, storedCount: held, missing: api - held });
  }
  return { ok: rows.every((r) => r.missing === 0), days: daysBetween(windowFrom, windowTo) + 1, rows };
}

const CANDIDATE_FIELDS = ['notice-type', 'deadline-receipt-tender-date-lot', 'classification-cpv', 'estimated-value-lot', 'contract-nature'];

/**
 * Confirms the API works from this machine and shows which optional fields TED accepts, with a
 * sample of each value's real shape. Run it once from an environment that can reach TED.
 */
export async function probeTed(config, { client = createTedClient(config) } = {}) {
  const to = addDays(todayIso(), -1);
  const from = addDays(to, -6);
  const country = config.ted.countries[0];
  const query = buildQuery(country, from, to);
  const report = { query, core: null, fields: [] };

  const core = await client.search({ query, fields: CORE_FIELDS, page: 1, limit: 1 });
  report.core = { totalNoticeCount: core.totalNoticeCount ?? null, sample: core.notices?.[0] ?? null };

  for (const field of CANDIDATE_FIELDS) {
    try {
      const body = await client.search({ query, fields: ['publication-number', field], page: 1, limit: 1 });
      report.fields.push({ field, accepted: true, sample: body.notices?.[0]?.[field] ?? null });
    } catch (err) {
      report.fields.push({ field, accepted: false, error: err.status ? `HTTP ${err.status}: ${err.body.slice(0, 160)}` : err.message });
    }
  }
  return report;
}
