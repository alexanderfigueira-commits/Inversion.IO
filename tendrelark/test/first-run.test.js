import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addDays, todayIso } from '../src/lib/dates.js';
import { renderFirstRunReport, runFirstCheck } from '../src/ted/first-run.js';
import { freshDb, startFakeTed, tedNotice, testConfig } from './helpers.js';

const yesterday = () => addDays(todayIso(), -1);
const sampleNotices = () => [
  tedNotice(1, { country: 'PRT', date: yesterday(), cpv: ['72000000'], deadline: '2099-01-01' }),
  tedNotice(2, { country: 'PRT', date: yesterday(), cpv: ['71000000'], deadline: '2099-02-01' }),
  tedNotice(3, { country: 'LUX', date: yesterday(), cpv: ['48000000'], deadline: '2099-03-01' }),
  tedNotice(4, { country: 'BEL', date: yesterday(), cpv: ['79000000'], deadline: '2099-04-01' }),
];

async function setup(notices = sampleNotices(), overrides = {}) {
  const ted = await startFakeTed(notices);
  const config = testConfig({ TED_API_URL: ted.url, ...overrides });
  return { ted, config, db: freshDb(config) };
}

test('a clean first run reports no problems and shows how well the data fit', async () => {
  const { ted, config, db } = await setup();
  const r = await runFirstCheck(db, config, { days: 7 });
  assert.equal(r.ok, true, r.problems.join(' | '));
  assert.equal(r.ingest.inserted, 4);
  assert.equal(r.reconcile.ok, true);
  assert.equal(r.coverage.total, 4);
  for (const name of ['title', 'buyer', 'publicationDate', 'deadline', 'cpv', 'country', 'noticeType']) assert.equal(r.coverage.fields[name].percent, 100, name);
  assert.equal(r.rawKeys.keys['publication-number'], 100);
  assert.equal(r.sample.length, 3);

  const text = renderFirstRunReport(r);
  assert.match(text, /RESULT: no problems found/);
  assert.match(text, /Field classification-cpv: accepted/);
  assert.match(text, /PRT .*TED 2, stored 2, OK/);
  assert.match(text, /title\s+100%/);
  assert.doesNotMatch(text, /secret|password|APP_SECRET/i);
  await ted.close();
});

test('rejected optional fields are reported and the data quality problem is named', async () => {
  const { ted, config, db } = await setup();
  ted.state.rejectFields = new Set(['classification-cpv', 'notice-type']);
  const r = await runFirstCheck(db, config, { days: 7 });
  assert.equal(r.ingest.fieldsTier, 'core');
  assert.ok(r.notes.some((n) => /rejected these optional fields: .*classification-cpv/.test(n)));
  assert.ok(r.notes.some((n) => /core fields only/.test(n)));
  assert.match(renderFirstRunReport(r), /Field classification-cpv: REJECTED/);
  await ted.close();
});

test('a field shape we did not expect shows up as a low coverage problem', async () => {
  const odd = sampleNotices().map((n) => ({ ...n, 'notice-title': null })); // the field comes back empty
  const { ted, config, db } = await setup(odd);
  const r = await runFirstCheck(db, config, { days: 7 });
  assert.equal(r.ok, false);
  assert.ok(r.problems.some((p) => /Only 0% of notices got a title/.test(p)), r.problems.join(' | '));
  assert.match(renderFirstRunReport(r), /RESULT: 1 problem found/);
  await ted.close();
});

test('when TED cannot be reached nothing is imported and the reason is plain', async () => {
  const { ted, config, db } = await setup();
  await ted.close();
  const r = await runFirstCheck(db, config, { days: 7 });
  assert.equal(r.ok, false);
  assert.equal(r.probe, null);
  assert.match(r.problems[0], /Could not query the TED API/);
  assert.match(r.problems[0], /Nothing was imported/);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM ted_notices').get().n, 0);
  assert.match(renderFirstRunReport(r), /NOT reachable/);
});

test('an empty answer from TED is a problem, not a pass', async () => {
  const { ted, config, db } = await setup([]);
  const r = await runFirstCheck(db, config, { days: 7 });
  assert.equal(r.ok, false);
  assert.ok(r.problems.some((p) => /no notice at all|returned no notices/.test(p)));
  await ted.close();
});

test('missing notices are found by comparing with TED’s own counts', async () => {
  const { ted, config, db } = await setup();
  // The probe uses the first six requests (core plus five optional fields). Break the first import chunk after that.
  let seen = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    seen += 1;
    if (seen >= 7 && seen <= 10) return new Response('{"message":"forced"}', { status: 500 });
    return realFetch(url, init);
  };
  try {
    const r = await runFirstCheck(db, config, { days: 7 });
    assert.equal(r.ok, false);
    assert.ok(r.problems.some((p) => /TED has \d+ notices .* but \d+ are stored/.test(p)), r.problems.join(' | '));
  } finally {
    globalThis.fetch = realFetch;
  }
  await ted.close();
});
