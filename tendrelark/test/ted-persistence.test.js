import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getMeta, openDatabase } from '../src/db/index.js';
import { seedSources } from '../src/db/seed.js';
import { WATERMARK_KEY, ingestTed, latestRuns, probeTed, reconcileTed } from '../src/ted/ingest.js';
import { freshDb, startFakeTed, tedNotice, tempDbPath, testConfig } from './helpers.js';

// These tests run the real ingestion code against a local stand in for the TED API that follows the
// documented request and response shape. They prove our side: that notices are written once,
// updated when they change, survive a restart, and that gaps are detected. They do not prove the
// live API matches that shape. `npm run ted:probe` does that from a machine that can reach TED.

const WINDOW = { from: '2026-10-14', to: '2026-10-21' };

function fixtures() {
  return [
    tedNotice(101, { country: 'PRT', date: '2026-10-15' }),
    tedNotice(102, { country: 'PRT', date: '2026-10-16', cpv: ['71000000'] }),
    tedNotice(103, { country: 'LUX', date: '2026-10-17' }),
    tedNotice(104, { country: 'BEL', date: '2026-10-18' }),
    tedNotice(105, { country: 'BEL', date: '2026-10-20', cpv: ['15000000'] }),
  ];
}

async function setup(overrides = {}, notices = fixtures()) {
  const ted = await startFakeTed(notices);
  const config = testConfig({ TED_API_URL: ted.url, ...overrides });
  const db = freshDb(config);
  return { ted, config, db, done: () => ted.close() };
}

test('first ingestion stores every notice once, with countries and CPV codes', async () => {
  const { config, db, done } = await setup();
  const r = await ingestTed(db, config, WINDOW);
  assert.equal(r.status, 'ok');
  assert.equal(r.inserted, 5);
  assert.equal(r.failed, 0);
  assert.equal(r.fieldsTier, 'extended');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM ted_notices').get().n, 5);
  assert.deepEqual(db.prepare('SELECT country, COUNT(*) n FROM ted_notice_countries GROUP BY country ORDER BY country').all().map((x) => [x.country, x.n]), [['BEL', 2], ['LUX', 1], ['PRT', 2]]);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM ted_notice_cpv WHERE notice_id = (SELECT id FROM ted_notices WHERE publication_number = '102-2026')").get().n, 1);
  await done();
});

test('running the same ingestion again creates no duplicates', async () => {
  const { config, db, done } = await setup();
  await ingestTed(db, config, WINDOW);
  const again = await ingestTed(db, config, WINDOW);
  assert.equal(again.inserted, 0);
  assert.equal(again.updated, 0);
  assert.equal(again.unchanged, 5);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM ted_notices').get().n, 5);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM (SELECT publication_number FROM ted_notices GROUP BY 1 HAVING COUNT(*) > 1)').get().n, 0);
  await done();
});

test('a corrected notice is updated in place and keeps its first seen time', async () => {
  const { ted, config, db, done } = await setup();
  await ingestTed(db, config, WINDOW);
  const before = db.prepare("SELECT * FROM ted_notices WHERE publication_number = '101-2026'").get();

  ted.state.notices[0]['notice-title'] = { eng: 'Corrected title' };
  ted.state.notices[0]['deadline-receipt-tender-date-lot'] = ['2027-01-15+01:00'];
  await new Promise((r) => setTimeout(r, 5));
  const r = await ingestTed(db, config, WINDOW);

  assert.equal(r.updated, 1);
  assert.equal(r.unchanged, 4);
  const after = db.prepare("SELECT * FROM ted_notices WHERE publication_number = '101-2026'").get();
  assert.equal(after.id, before.id);
  assert.equal(after.title, 'Corrected title');
  assert.equal(after.deadline_at, '2027-01-15');
  assert.equal(after.first_seen_at, before.first_seen_at);
  assert.notEqual(after.updated_at, before.updated_at);
  await done();
});

test('notices are still there after the database is closed and reopened', async () => {
  const tmp = tempDbPath();
  const { ted, done } = await setup();
  const config = testConfig({ TED_API_URL: ted.url, DATABASE_PATH: tmp.file });

  let db = openDatabase(config.databasePath);
  seedSources(db);
  await ingestTed(db, config, WINDOW);
  const snapshot = db.prepare('SELECT publication_number, title, buyer_name, publication_date, deadline_at, url, content_hash FROM ted_notices ORDER BY publication_number').all();
  const watermark = getMeta(db, WATERMARK_KEY);
  db.close();

  db = openDatabase(config.databasePath); // a fresh process opening the same file
  const reloaded = db.prepare('SELECT publication_number, title, buyer_name, publication_date, deadline_at, url, content_hash FROM ted_notices ORDER BY publication_number').all();
  assert.equal(reloaded.length, 5);
  assert.deepEqual(reloaded, snapshot);
  assert.equal(getMeta(db, WATERMARK_KEY), watermark);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM ted_notice_countries').get().n, 5);

  // And ingesting after the restart still creates no duplicates.
  const again = await ingestTed(db, config, WINDOW);
  assert.equal(again.inserted, 0);
  assert.equal(again.unchanged, 5);
  db.close();
  tmp.cleanup();
  await done();
});

test('paging through a large result stores everything', async () => {
  const many = Array.from({ length: 23 }, (_, i) => tedNotice(200 + i, { country: 'PRT', date: '2026-10-16' }));
  const { ted, config, db, done } = await setup({ TED_PAGE_SIZE: '5' }, many);
  const r = await ingestTed(db, config, WINDOW);
  assert.equal(r.inserted, 23);
  assert.ok(ted.state.requests.filter((q) => q.query.includes('PRT')).length >= 5);
  await done();
});

test('the watermark moves forward only after a complete run', async () => {
  const { ted, config, db, done } = await setup();
  ted.state.failures = Array(200).fill(500); // more than every chunk and retry can use
  const bad = await ingestTed(db, config, WINDOW);
  assert.equal(bad.status, 'failed');
  assert.ok(bad.errors.length > 0);
  assert.equal(getMeta(db, WATERMARK_KEY), null);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM ted_notices').get().n, 0);

  ted.state.failures = [];
  const good = await ingestTed(db, config, WINDOW);
  assert.equal(good.status, 'ok');
  assert.equal(getMeta(db, WATERMARK_KEY), WINDOW.to);
  const runs = latestRuns(db, 5);
  assert.deepEqual(runs.map((x) => x.status), ['ok', 'failed']);
  assert.match(runs[1].error, /HTTP 500/);
  await done();
});

test('later runs re-read an overlap so late notices are caught', async () => {
  const { ted, config, db, done } = await setup({ TED_OVERLAP_DAYS: '3' });
  await ingestTed(db, config, WINDOW);
  ted.state.requests.length = 0;
  ted.state.notices.push(tedNotice(300, { country: 'PRT', date: '2026-10-20' })); // appears late

  const r = await ingestTed(db, config, { to: '2026-10-22' });
  assert.equal(r.window.from, '2026-10-18'); // 2026-10-21 watermark minus 3 days
  assert.equal(r.inserted, 1);
  assert.equal(getMeta(db, WATERMARK_KEY), '2026-10-22');
  await done();
});

test('one failing chunk gives a partial run and keeps the watermark back', async () => {
  const { ted, config, db, done } = await setup({ TED_COUNTRIES: 'PRT' });
  ted.state.failures = [500, 500, 500, 500]; // exhausts retries on the first chunk only
  const r = await ingestTed(db, config, { from: '2026-10-01', to: '2026-10-21' });
  assert.equal(r.status, 'partial');
  assert.equal(getMeta(db, WATERMARK_KEY), null);
  assert.ok(r.inserted >= 1);
  await done();
});

test('a temporary rate limit is retried and the run still succeeds', async () => {
  const { ted, config, db, done } = await setup();
  ted.state.failures = [429, 503];
  const r = await ingestTed(db, config, WINDOW);
  assert.equal(r.status, 'ok');
  assert.equal(r.inserted, 5);
  await done();
});

test('if TED rejects the extended fields, ingestion falls back to core fields and says so', async () => {
  const { ted, config, db, done } = await setup();
  ted.state.rejectFields = new Set(['classification-cpv']);
  const r = await ingestTed(db, config, WINDOW);
  assert.equal(r.status, 'ok');
  assert.equal(r.fieldsTier, 'core');
  assert.equal(r.inserted, 5);
  assert.equal(db.prepare('SELECT fields_tier FROM ingestion_runs WHERE id = ?').get(r.runId).fields_tier, 'core');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM ted_notice_cpv').get().n, 0);
  await done();
});

test('a malformed API response fails the run instead of storing nothing quietly', async () => {
  const { ted, config, db, done } = await setup();
  ted.state.malformed = true;
  const r = await ingestTed(db, config, WINDOW);
  assert.equal(r.status, 'failed');
  assert.match(r.errors[0], /no "notices" array/);
  await done();
});

test('an unparseable notice is counted as failed while the rest are stored', async () => {
  const bad = { ...tedNotice(400, { country: 'PRT', date: '2026-10-16' }), 'publication-number': 'garbage' };
  const { config, db, done } = await setup({}, [...fixtures(), bad]);
  const r = await ingestTed(db, config, WINDOW);
  assert.equal(r.inserted, 5);
  assert.equal(r.failed, 1);
  assert.equal(r.status, 'partial');
  assert.equal(getMeta(db, WATERMARK_KEY), WINDOW.to); // a bad record must not pin the window in place
  await done();
});

test('two runs cannot overlap', async () => {
  const { config, db, done } = await setup();
  db.prepare("INSERT INTO ingestion_runs (source_slug, started_at, status) VALUES ('ted', ?, 'running')").run(new Date().toISOString());
  await assert.rejects(ingestTed(db, config, WINDOW), /already in progress/);
  db.prepare("UPDATE ingestion_runs SET started_at = '2020-01-01T00:00:00.000Z'").run(); // a long dead run
  const r = await ingestTed(db, config, WINDOW);
  assert.equal(r.status, 'ok');
  assert.equal(db.prepare("SELECT status FROM ingestion_runs WHERE id = 1").get().status, 'failed');
  await done();
});

test('reconcile passes when everything TED has is stored, and flags a missing notice', async () => {
  const { config, db, done } = await setup();
  await ingestTed(db, config, WINDOW);

  const ok = await reconcileTed(db, config, { days: 8, to: '2026-10-21' });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.rows.map((r) => [r.country, r.tedCount, r.storedCount]), [['PRT', 2, 2], ['LUX', 1, 1], ['BEL', 2, 2]]);

  db.prepare("DELETE FROM ted_notices WHERE publication_number = '103-2026'").run();
  const gap = await reconcileTed(db, config, { days: 8, to: '2026-10-21' });
  assert.equal(gap.ok, false);
  assert.equal(gap.rows.find((r) => r.country === 'LUX').missing, 1);
  await done();
});

test('probe reports which optional fields TED accepts', async () => {
  const { ted, config, done } = await setup();
  ted.state.rejectFields = new Set(['contract-nature']);
  const report = await probeTed(config);
  const byField = Object.fromEntries(report.fields.map((f) => [f.field, f.accepted]));
  assert.equal(byField['classification-cpv'], true);
  assert.equal(byField['contract-nature'], false);
  assert.equal(report.core.totalNoticeCount >= 0, true);
  await done();
});

test('a notice found by two country queries is stored once with both countries', async () => {
  const joint = tedNotice(500, { country: 'PRT', date: '2026-10-16' });
  joint['buyer-country'] = ['PRT', 'BEL'];
  const { config, db, done } = await setup({}, [joint]);
  const r = await ingestTed(db, config, WINDOW);
  assert.equal(r.fetched, 2);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM ted_notices').get().n, 1);
  assert.deepEqual(db.prepare('SELECT country FROM ted_notice_countries ORDER BY country').all().map((x) => x.country), ['BEL', 'PRT']);
  await done();
});
