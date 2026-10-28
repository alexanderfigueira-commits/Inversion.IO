import assert from 'node:assert/strict';
import http from 'node:http';
import { test } from 'node:test';
import { SOURCES, seedSources } from '../src/db/seed.js';
import { COVERED_COUNTRIES, matchOfficialSource, retrievalState, verifiedCountries } from '../src/sources/coverage.js';
import { checkUrl, effectiveStatus, listSources, verifySources } from '../src/sources/verify.js';
import { ingestTed } from '../src/ted/ingest.js';
import { freshDb, startFakeTed, tedNotice, testConfig, verifySource } from './helpers.js';

async function localServer(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  server.unref();
  return { url: `http://127.0.0.1:${server.address().port}/`, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }) };
}

test('a reachability check tells ok, refused and failed apart', async () => {
  const s = await localServer((req, res) => {
    if (req.url === '/ok') return res.end('<html>hello</html>');
    if (req.url === '/blocked') return res.writeHead(403).end('no bots');
    if (req.url === '/broken') return res.writeHead(502).end('bad gateway');
    return undefined; // /hang never answers
  });
  assert.equal((await checkUrl(`${s.url}ok`)).outcome, 'ok');
  const refused = await checkUrl(`${s.url}blocked`);
  assert.equal(refused.outcome, 'refused');
  assert.equal(refused.httpStatus, 403);
  assert.equal((await checkUrl(`${s.url}broken`)).outcome, 'failed');
  const slow = await checkUrl(`${s.url}hang`, { timeoutMs: 150 });
  assert.equal(slow.outcome, 'failed');
  assert.match(slow.error, /No answer within/);
  await s.close();
  assert.equal((await checkUrl(`${s.url}ok`, { timeoutMs: 500 })).outcome, 'failed'); // connection refused
});

test('status moves verified, degraded, unreachable and recovers', () => {
  const db = freshDb();
  const status = () => db.prepare("SELECT status, consecutive_failures n FROM sources WHERE slug = 'pmp-lu'").get();
  assert.equal(status().status, 'unverified');
  verifySource(db, 'pmp-lu', 'ok');
  assert.equal(status().status, 'verified');
  verifySource(db, 'pmp-lu', 'failed');
  assert.deepEqual({ ...status() }, { status: 'degraded', n: 1 });
  verifySource(db, 'pmp-lu', 'failed');
  verifySource(db, 'pmp-lu', 'failed');
  assert.equal(status().status, 'unreachable');
  verifySource(db, 'pmp-lu', 'refused');
  assert.equal(status().status, 'degraded'); // up, but turning automated checks away
  verifySource(db, 'pmp-lu', 'ok');
  assert.deepEqual({ ...status() }, { status: 'verified', n: 0 });
  assert.ok(db.prepare("SELECT last_verified_at FROM sources WHERE slug = 'pmp-lu'").get().last_verified_at);
});

test('a verification older than a few days no longer counts as current', () => {
  const db = freshDb();
  verifySource(db, 'ted');
  const ted = listSources(db).find((s) => s.slug === 'ted');
  assert.equal(effectiveStatus(ted), 'verified');
  assert.equal(effectiveStatus(ted, Date.now() + 4 * 86_400_000), 'stale');
});

test('verifySources checks every source and records the outcome', async () => {
  const db = freshDb();
  const s = await localServer((req, res) => res.end('ok'));
  db.prepare('UPDATE sources SET check_url = ?').run(s.url.replace('http://', 'https://')); // https check against an http stub fails: still recorded
  const results = await verifySources(db, { timeoutMs: 800 });
  assert.equal(results.length, SOURCES.length);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM source_checks').get().n, SOURCES.length);
  assert.ok(db.prepare('SELECT COUNT(*) n FROM sources WHERE last_checked_at IS NOT NULL').get().n === SOURCES.length);
  await s.close();
});

test('the directory matches the research: current Belgian platform, Luxembourg hosts, nothing pre-verified', () => {
  const db = freshDb();
  const by = Object.fromEntries(listSources(db).map((s) => [s.slug, s]));
  assert.equal(by['eprocurement-be'].url, 'https://www.publicprocurement.be/');
  assert.ok(!listSources(db).some((s) => s.url.includes('enot.publicprocurement.be')), 'the legacy Belgian address is not a source');
  assert.equal(by['pmp-lu'].url, 'https://marches.public.lu/fr.html');
  assert.deepEqual(by['pmp-lu'].extraHosts, ['pmp.lu', 'pmp.b2g.etat.lu']);
  assert.equal(by['base-pt'].url, 'https://www.base.gov.pt/');

  // Reachability starts unverified for everything, and no national source claims verified retrieval.
  assert.ok(listSources(db).every((s) => s.status === 'unverified'));
  assert.equal(by['base-pt'].retrieval_finding, 'unverified');
  assert.equal(by['dre-pt'].retrieval_finding, 'unverified');
  assert.equal(by['pmp-lu'].retrieval_finding, 'unavailable');
  assert.equal(by['eprocurement-be'].retrieval_finding, 'unverified');
  assert.ok(listSources(db).filter((s) => s.slug !== 'ted').every((s) => s.retrieval_finding !== 'verified' && s.method === 'manual_review'));
  assert.equal(listSources(db).filter((s) => s.method === 'api_ingest').length, 1);

  // Every national source carries a researched feasibility statement and dated finding.
  for (const slug of ['base-pt', 'dre-pt', 'pmp-lu', 'eprocurement-be']) {
    assert.ok(by[slug].import_feasibility.length > 40, slug);
    assert.equal(by[slug].finding_checked_on, '2026-10-27');
  }
  assert.match(by['base-pt'].import_feasibility, /8 March 2026/);
  assert.match(by['base-pt'].import_feasibility, /unverified/);
  assert.match(by['pmp-lu'].description, /only part of the notices/);
  assert.match(by['eprocurement-be'].import_feasibility, /unverified/);
  // Reference links are https only.
  for (const s of listSources(db)) for (const l of s.referenceLinks) assert.ok(/^https?:\/\//.test(l.url), l.url);
});

test('seeding again refreshes descriptions but never erases verification results', () => {
  const db = freshDb();
  verifySource(db, 'ted');
  verifySource(db, 'eprocurement-be', 'failed');
  seedSources(db);
  seedSources(db);
  const by = Object.fromEntries(listSources(db).map((s) => [s.slug, s]));
  assert.equal(by.ted.status, 'verified');
  assert.equal(by['eprocurement-be'].status, 'degraded');
  assert.equal(listSources(db).length, SOURCES.length);
});

test('TED retrieval is verified only once an import has stored notices', async () => {
  const ted = await startFakeTed([tedNotice(1, { country: 'PRT', date: '2026-10-20' })]);
  const config = testConfig({ TED_API_URL: ted.url });
  const db = freshDb(config);
  const state = (slug) => retrievalState(db, listSources(db).find((s) => s.slug === slug));

  assert.equal(state('ted').state, 'unverified');
  await ingestTed(db, config, { from: '2026-10-14', to: '2026-10-21' });
  const after = state('ted');
  assert.equal(after.state, 'verified');
  assert.equal(after.stored, 1);
  assert.equal(after.newest, '2026-10-20');

  assert.equal(state('base-pt').state, 'unverified');
  assert.equal(state('pmp-lu').state, 'unavailable');
  assert.equal(state('eprocurement-be').state, 'unverified');
  await ted.close();
});

test('an empty import does not make TED retrieval verified', async () => {
  const ted = await startFakeTed([]);
  const config = testConfig({ TED_API_URL: ted.url });
  const db = freshDb(config);
  await ingestTed(db, config, { from: '2026-10-14', to: '2026-10-21' });
  assert.equal(retrievalState(db, listSources(db).find((s) => s.slug === 'ted')).state, 'unverified');
  await ted.close();
});

test('a country has verified coverage only when a source serving it passed its check', () => {
  const db = freshDb();
  assert.deepEqual(verifiedCountries(db), []);
  verifySource(db, 'pmp-lu');
  assert.deepEqual(verifiedCountries(db), ['LUX']); // a national source serves only its own country
  verifySource(db, 'ted');
  assert.deepEqual(verifiedCountries(db), ['PRT', 'LUX', 'BEL']); // TED serves all three
  verifySource(db, 'ted', 'failed');
  assert.deepEqual(verifiedCountries(db), ['LUX']); // lapses when the check fails
  verifySource(db, 'pmp-lu', 'refused');
  assert.deepEqual(verifiedCountries(db), []);
  assert.deepEqual(COVERED_COUNTRIES, ['PRT', 'LUX', 'BEL']);
});

test('official source links are matched against the directory for the issue country', () => {
  const db = freshDb();
  const ok = (country, url) => matchOfficialSource(db, country, url);

  assert.equal(ok('PRT', 'https://ted.europa.eu/en/notice/-/detail/12-2026').source.slug, 'ted');
  assert.equal(ok('PRT', 'https://www.base.gov.pt/Base4/pt/detalhe/?type=anuncios&id=1').source.slug, 'base-pt');
  assert.equal(ok('LUX', 'https://pmp.b2g.etat.lu/index.php?search').source.slug, 'pmp-lu');
  assert.equal(ok('LUX', 'https://marches.public.lu/fr/avis.html').source.slug, 'pmp-lu');
  assert.equal(ok('BEL', 'https://www.publicprocurement.be/publication-workspaces/68ba25c6').source.slug, 'eprocurement-be');
  assert.equal(ok('PRT', 'https://sub.diariodarepublica.pt/dr/x').source.slug, 'dre-pt');
  assert.equal(ok('BEL', 'https://ted.europa.eu/en/notice/-/detail/1-2026#frag').url, 'https://ted.europa.eu/en/notice/-/detail/1-2026');

  for (const [country, url, why] of [
    ['PRT', 'http://www.base.gov.pt/', 'plain http'],
    ['PRT', 'https://evil.example/base.gov.pt', 'unrelated host'],
    ['PRT', 'https://ted.europa.eu.evil.example/', 'look alike host'],
    ['PRT', 'https://notted.europa.eu/', 'host that only ends the same way'],
    ['PRT', 'https://ted.europa.eu@evil.example/', 'credentials trick'],
    ['PRT', 'https://user:pw@www.base.gov.pt/', 'credentials in the link'],
    ['LUX', 'https://www.base.gov.pt/', 'another country’s portal'],
    ['BEL', 'https://marches.public.lu/fr.html', 'another country’s portal'],
    ['PRT', 'javascript:alert(1)', 'script scheme'],
    ['PRT', 'not a url', 'not a url'],
  ]) {
    assert.equal(ok(country, url).ok, false, `${why}: ${url}`);
  }
  assert.match(ok('LUX', 'https://www.base.gov.pt/').reason, /official Luxembourg source/);
});
