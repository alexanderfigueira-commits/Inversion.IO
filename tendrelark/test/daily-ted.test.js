import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LAST_CYCLE_KEY, isDailyRunDue, runDailyTedImport } from '../src/jobs/daily-ted.js';
import { ingestTed } from '../src/ted/ingest.js';
import { getMeta } from '../src/db/index.js';
import { freshDb, memoryMailer, startFakeTed, tedNotice, testConfig } from './helpers.js';

const OK = { status: 'ok', complete: true, runId: 7, window: { from: '2026-10-25', to: '2026-10-28' }, fieldsTier: 'extended', fetched: 120, inserted: 40, updated: 2, unchanged: 78, failed: 0, errors: [] };
const FAILED = { status: 'failed', complete: false, runId: 8, window: { from: '2026-10-25', to: '2026-10-28' }, fieldsTier: 'extended', fetched: 0, inserted: 0, updated: 0, unchanged: 0, failed: 0, errors: ['PRT 2026-10-25 to 2026-10-28: TED API answered HTTP 503'] };
const EMPTY = { ...FAILED, status: 'empty', errors: ['TED returned 0 notices for PRT, LUX, BEL from 2026-10-25 to 2026-10-28.'] };

function harness(script, overrides = {}) {
  const config = testConfig(overrides);
  const db = freshDb(config);
  const mailer = memoryMailer(config, db);
  const sleeps = [];
  const calls = { n: 0 };
  const ingest = async () => {
    const next = script[Math.min(calls.n, script.length - 1)];
    calls.n += 1;
    if (next instanceof Error) throw next;
    return { ...next };
  };
  return { config, db, mailer, sleeps, calls, run: (extra = {}) => runDailyTedImport({ db, config, mailer, ingest, sleep: async (ms) => sleeps.push(ms), ...extra }) };
}

test('a clean first run needs no retries and emails the log to support', async () => {
  const h = harness([OK]);
  const r = await h.run();
  assert.equal(r.done, true);
  assert.equal(r.attempts.length, 1);
  assert.deepEqual(h.sleeps, []);
  assert.equal(h.mailer.outbox.length, 1);
  const mail = h.mailer.outbox[0];
  assert.equal(mail.to, 'support@tendrelark.eu');
  assert.match(mail.subject, /TED import DONE after 1 attempt: 40 new, 2 changed/);
  assert.match(mail.text, /Result: DONE/);
  assert.match(mail.text, /Attempt 1 at \d\d:\d\d UTC \(run #7\): OK/);
  assert.doesNotMatch(mail.text, /ACTION NEEDED/);
});

test('failures are retried ten minutes apart until a run completes', async () => {
  const h = harness([FAILED, EMPTY, OK]);
  const r = await h.run();
  assert.equal(r.done, true);
  assert.equal(r.attempts.length, 3);
  assert.deepEqual(h.sleeps, [600_000, 600_000]);
  assert.equal(h.calls.n, 3); // stopped as soon as it completed
  const text = h.mailer.outbox[0].text;
  assert.match(text, /Attempt 1 .*FAILED/);
  assert.match(text, /Attempt 2 .*EMPTY, TED returned no notices/);
  assert.match(text, /Attempt 3 .*OK/);
  assert.match(text, /HTTP 503/);
  assert.match(h.mailer.outbox[0].subject, /DONE after 3 attempts/);
});

test('it gives up after one hour: the first attempt plus six retries, then reports NOT DONE', async () => {
  const h = harness([FAILED]);
  const r = await h.run();
  assert.equal(r.done, false);
  assert.equal(r.attempts.length, 7);
  assert.equal(h.calls.n, 7);
  assert.equal(h.sleeps.length, 6);
  assert.equal(h.sleeps.reduce((a, b) => a + b, 0), 60 * 60_000);
  const mail = h.mailer.outbox[0];
  assert.match(mail.subject, /NOT DONE after 7 attempts/);
  assert.match(mail.text, /Result: NOT DONE/);
  assert.match(mail.text, /ACTION NEEDED/);
});

test('an empty answer is never reported as success', async () => {
  const h = harness([EMPTY]);
  const r = await h.run();
  assert.equal(r.done, false);
  assert.match(h.mailer.outbox[0].subject, /NOT DONE.*TED returned no notices/);
  assert.match(h.mailer.outbox[0].text, /0 notices|returned no notices/);
});

test('an overlapping run or a crash counts as not done and is retried', async () => {
  const h = harness([new Error('A TED ingestion run (#3) is already in progress.'), OK]);
  const r = await h.run();
  assert.equal(r.done, true);
  assert.equal(r.attempts.length, 2);
  assert.match(h.mailer.outbox[0].text, /Attempt 1 .*ERROR: A TED ingestion run \(#3\) is already in progress/);
});

test('retry timing follows the settings', async () => {
  const h = harness([FAILED], { TED_RETRY_INTERVAL_MINUTES: '5', TED_RETRY_WINDOW_MINUTES: '20' });
  const r = await h.run();
  assert.equal(r.attempts.length, 5);
  assert.deepEqual(h.sleeps, [300_000, 300_000, 300_000, 300_000]);
});

test('the report goes to the configured address', async () => {
  const h = harness([OK], { TED_REPORT_EMAIL: 'ops@example.com' });
  await h.run();
  assert.equal(h.mailer.outbox[0].to, 'ops@example.com');
});

test('a mail failure never loses the cycle result', async () => {
  const h = harness([OK]);
  h.mailer.send = async () => {
    throw new Error('SMTP down');
  };
  const lines = [];
  const r = await h.run({ log: (m) => lines.push(m) });
  assert.equal(r.done, true);
  assert.equal(r.emailed, false);
  assert.ok(lines.some((l) => /Could not email the TED report/.test(l)));
  assert.equal(JSON.parse(getMeta(h.db, LAST_CYCLE_KEY)).reportEmailed, false);
});

test('without SMTP the report is logged but the cycle says it was not emailed', async () => {
  const config = testConfig({ MAIL_TRANSPORT: '' });
  const db = freshDb(config);
  const { createMailer } = await import('../src/lib/mailer.js');
  const mailer = createMailer(config, db, { log: { info() {} } });
  const r = await runDailyTedImport({ db, config, mailer, ingest: async () => ({ ...OK }), sleep: async () => {} });
  assert.equal(r.emailed, false);
  assert.equal(db.prepare("SELECT status FROM email_log WHERE kind = 'ted_daily_report'").get().status, 'logged');
});

test('the report can be switched off for a manual run', async () => {
  const h = harness([OK]);
  await h.run({ sendReport: false });
  assert.equal(h.mailer.outbox.length, 0);
});

test('the cycle is remembered so a restart does not run it twice', async () => {
  const h = harness([OK]);
  const morning = new Date('2026-10-28T06:30:00Z');
  assert.equal(isDailyRunDue(h.db, h.config, new Date('2026-10-28T05:59:00Z')), false); // too early
  assert.equal(isDailyRunDue(h.db, h.config, morning), true);
  await h.run({ now: () => morning });
  assert.equal(isDailyRunDue(h.db, h.config, new Date('2026-10-28T07:15:00Z')), false); // done today
  assert.equal(isDailyRunDue(h.db, h.config, new Date('2026-10-29T06:00:00Z')), true); // tomorrow
  assert.equal(JSON.parse(getMeta(h.db, LAST_CYCLE_KEY)).outcome, 'done');
});

test('a late start catches up instead of skipping the day', async () => {
  const h = harness([OK]);
  assert.equal(isDailyRunDue(h.db, h.config, new Date('2026-10-28T18:40:00Z')), true);
});

test('the run time can be changed and must be a real time', () => {
  assert.equal(testConfig({ TED_DAILY_AT_UTC: '09:15' }).tedDaily.dailyAtUtc, '09:15');
  assert.throws(() => testConfig({ TED_DAILY_AT_UTC: '25:00' }), /TED_DAILY_AT_UTC/);
});

test('end to end against the stand in TED server: a run that returns nothing is retried, then reported not done', async () => {
  const ted = await startFakeTed([]); // TED has nothing for the window
  const config = testConfig({ TED_API_URL: ted.url, TED_RETRY_INTERVAL_MINUTES: '10', TED_RETRY_WINDOW_MINUTES: '20' });
  const db = freshDb(config);
  const mailer = memoryMailer(config, db);
  const sleeps = [];
  const r = await runDailyTedImport({ db, config, mailer, sleep: async (ms) => sleeps.push(ms) });
  assert.equal(r.done, false);
  assert.equal(r.attempts.length, 3);
  assert.deepEqual(sleeps, [600_000, 600_000]);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM ingestion_runs WHERE status = 'empty'").get().n, 3);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM ted_notices').get().n, 0);
  assert.match(mailer.outbox[0].subject, /NOT DONE/);
  await ted.close();
});

test('end to end against the stand in TED server: TED fails once, then the retry stores the notices', async () => {
  const today = new Date().toISOString().slice(0, 10);
  const ted = await startFakeTed([tedNotice(900, { country: 'PRT', date: today }), tedNotice(901, { country: 'BEL', date: today })]);
  ted.state.failures = Array(8).fill(500); // exhausts the client's own retries on the first attempt
  const config = testConfig({ TED_API_URL: ted.url });
  const db = freshDb(config);
  const mailer = memoryMailer(config, db);
  const r = await runDailyTedImport({ db, config, mailer, sleep: async () => {} });
  assert.equal(r.done, true);
  assert.equal(r.attempts.length, 2);
  assert.equal(r.attempts[0].result.complete, false);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM ted_notices').get().n, 2);
  assert.match(mailer.outbox[0].subject, /DONE after 2 attempts/);
  await ted.close();
});

test('ingestion marks an empty answer as empty, keeps the watermark, and says why', async () => {
  const ted = await startFakeTed([]);
  const config = testConfig({ TED_API_URL: ted.url });
  const db = freshDb(config);
  const r = await ingestTed(db, config);
  assert.equal(r.status, 'empty');
  assert.equal(r.complete, false);
  assert.match(r.errors.at(-1), /not counted as a successful import/);
  assert.equal(getMeta(db, 'ted_watermark'), null);
  await ted.close();
});
