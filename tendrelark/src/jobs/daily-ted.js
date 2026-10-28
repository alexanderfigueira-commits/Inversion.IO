import { getMeta, setMeta } from '../db/index.js';
import { COUNTRY_NAMES } from '../config.js';
import { tedStats } from '../tenders.js';
import { ingestTed } from '../ted/ingest.js';

export const LAST_CYCLE_KEY = 'ted_daily_last_cycle';

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const hhmm = (d) => d.toISOString().slice(11, 16);
const utcDate = (d) => d.toISOString().slice(0, 10);

/** True when today's scheduled time has passed and no cycle has been run for today yet. */
export function isDailyRunDue(db, config, now = new Date()) {
  const [h, m] = config.tedDaily.dailyAtUtc.split(':').map(Number);
  if (now.getUTCHours() * 60 + now.getUTCMinutes() < h * 60 + m) return false;
  let last = null;
  try {
    last = JSON.parse(getMeta(db, LAST_CYCLE_KEY) || 'null');
  } catch {
    last = null;
  }
  return last?.date !== utcDate(now);
}

/**
 * One daily cycle: run the TED import, and if it does not complete, try again every
 * retryIntervalMinutes until retryWindowMinutes have passed. "Complete" means every chunk of the
 * window was read and TED returned notices. A failure, an empty answer and an overlapping run all
 * count as not done. Afterwards the log of every attempt is emailed, whatever the outcome.
 *
 * With the defaults that is one attempt plus up to six retries, ten minutes apart, over one hour.
 */
export async function runDailyTedImport({ db, config, mailer, ingest = ingestTed, sleep = defaultSleep, now = () => new Date(), log = () => {}, sendReport = true }) {
  const { retryIntervalMinutes, retryWindowMinutes } = config.tedDaily;
  const maxAttempts = 1 + Math.floor(retryWindowMinutes / retryIntervalMinutes);
  const cycleStart = now();
  const attempts = [];

  for (let n = 1; n <= maxAttempts; n += 1) {
    const lines = [];
    const at = now();
    let result;
    try {
      result = await ingest(db, config, { log: (m) => { lines.push(m); log(m); } });
    } catch (err) {
      // An overlapping run or an unexpected error. Either way the import is not done.
      result = { status: 'error', complete: false, errors: [err.message], fetched: 0, inserted: 0, updated: 0, unchanged: 0, failed: 0 };
    }
    attempts.push({ n, at: at.toISOString(), result, lines });
    log(`TED import attempt ${n}/${maxAttempts}: ${result.status}${result.complete ? ' (complete)' : ''}`);
    if (result.complete) break;
    if (n < maxAttempts) await sleep(retryIntervalMinutes * 60_000);
  }

  const done = attempts.at(-1).result.complete === true;
  const cycleEnd = now();
  const report = buildReport({ db, config, attempts, done, cycleStart, cycleEnd, maxAttempts });

  let emailed = false;
  if (sendReport) {
    try {
      const sent = await mailer.send({ to: config.tedDaily.reportTo, kind: 'ted_daily_report', subject: report.subject, text: report.text });
      emailed = sent.delivered;
      if (!sent.delivered) log(`The TED report was not delivered because email is not configured (mail mode: ${mailer.mode}).`);
    } catch (err) {
      log(`Could not email the TED report to ${config.tedDaily.reportTo}: ${err.message}`);
    }
  }

  // Remember the cycle so a restart does not run it twice, and so /healthz can show how it went.
  setMeta(db, LAST_CYCLE_KEY, JSON.stringify({ date: utcDate(cycleStart), outcome: done ? 'done' : 'not_done', attempts: attempts.length, finishedAt: cycleEnd.toISOString(), reportEmailed: emailed }));
  return { done, attempts, emailed, subject: report.subject };
}

function describe(result) {
  if (result.status === 'error') return `ERROR: ${result.errors[0]}`;
  const counts = `fetched ${result.fetched}, new ${result.inserted}, changed ${result.updated}, unchanged ${result.unchanged}, failed ${result.failed}`;
  if (result.status === 'empty') return `EMPTY, TED returned no notices (${counts})`;
  if (result.status === 'failed') return `FAILED (${counts})`;
  if (result.status === 'partial') return `${result.complete ? 'COMPLETE, but some notices could not be parsed' : 'PARTIAL, some days could not be read'} (${counts})`;
  return `OK (${counts})`;
}

function buildReport({ db, config, attempts, done, cycleStart, cycleEnd, maxAttempts }) {
  const last = attempts.at(-1).result;
  const date = utcDate(cycleStart);
  const totals = attempts.reduce((t, a) => ({ inserted: t.inserted + (a.result.inserted ?? 0), updated: t.updated + (a.result.updated ?? 0) }), { inserted: 0, updated: 0 });
  const stats = tedStats(db);

  const headline = done
    ? `DONE after ${attempts.length} attempt${attempts.length === 1 ? '' : 's'}: ${totals.inserted} new, ${totals.updated} changed`
    : `NOT DONE after ${attempts.length} attempt${attempts.length === 1 ? '' : 's'}: ${last.status === 'empty' ? 'TED returned no notices' : 'the import did not complete'}`;

  const text = [
    `TED import report for ${date} (UTC)`,
    `Result: ${done ? 'DONE' : 'NOT DONE'}`,
    `Started ${hhmm(cycleStart)} UTC, finished ${hhmm(cycleEnd)} UTC. ${attempts.length} of ${maxAttempts} possible attempts used (retry every ${config.tedDaily.retryIntervalMinutes} minutes for up to ${config.tedDaily.retryWindowMinutes}).`,
    `Countries: ${config.ted.countries.map((c) => COUNTRY_NAMES[c] ?? c).join(', ')}`,
    '',
    ...(done ? [] : ['ACTION NEEDED: the import is still not complete. Notices were not (fully) stored today. Run `npm run ted:probe` on a machine that can reach TED, and check the ingestion runs in the admin area.', '']),
    ...attempts.flatMap((a) => [
      `Attempt ${a.n} at ${hhmm(new Date(a.at))} UTC${a.result.runId ? ` (run #${a.result.runId})` : ''}: ${describe(a.result)}`,
      ...(a.result.window ? [`  Window ${a.result.window.from} to ${a.result.window.to}${a.result.fieldsTier ? `, fields: ${a.result.fieldsTier}` : ''}`] : []),
      ...a.lines.map((l) => `  ${l}`),
      ...(a.result.errors ?? []).filter((e) => !a.lines.some((l) => l.includes(e))).map((e) => `  ${e}`),
      '',
    ]),
    `Database now holds ${stats.notices} TED notices (${stats.byCountry.map((c) => `${c.country} ${c.n}`).join(', ') || 'none'}).`,
    `Newest publication date stored: ${stats.latest_publication ?? 'none'}.`,
    `Next scheduled run: ${config.tedDaily.dailyAtUtc} UTC tomorrow.`,
    '',
  ].join('\n');

  return { subject: `[Tendrelark] TED import ${headline} (${date})`, text };
}
