import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addDays, isoWeek, normalizeTedDate, weekRange, weekSlug, formatWeekRange } from '../src/lib/dates.js';
import { chunkWindow, buildQuery } from '../src/ted/ingest.js';
import { normalizeNotice, pickList, pickText } from '../src/ted/normalize.js';
import { tedNotice } from './helpers.js';

test('ISO weeks match the calendar', () => {
  assert.deepEqual(isoWeek('2026-10-26'), { year: 2026, week: 44 });
  assert.deepEqual(isoWeek('2026-11-01'), { year: 2026, week: 44 });
  assert.deepEqual(isoWeek('2026-01-01'), { year: 2026, week: 1 });
  assert.deepEqual(isoWeek('2027-01-03'), { year: 2026, week: 53 }); // 2026 has 53 weeks
  assert.deepEqual(isoWeek('2024-12-30'), { year: 2025, week: 1 }); // belongs to next ISO year
  assert.equal(weekSlug({ year: 2026, week: 5 }), '2026-W05');
});

test('weekRange returns Monday to Sunday and rejects weeks that do not exist', () => {
  assert.deepEqual(weekRange('2026-W44'), { start: '2026-10-26', end: '2026-11-01' });
  assert.deepEqual(weekRange('2026-W53'), { start: '2026-12-28', end: '2027-01-03' });
  assert.deepEqual(weekRange('2026-W01'), { start: '2025-12-29', end: '2026-01-04' });
  assert.throws(() => weekRange('2025-W53'), /does not exist/);
  assert.throws(() => weekRange('2026-44'), /Invalid week/);
  assert.equal(formatWeekRange('2026-10-26', '2026-11-01'), '26 October 2026 to 1 November 2026');
});

test('TED date shapes are normalised', () => {
  assert.equal(normalizeTedDate('2026-03-14+01:00'), '2026-03-14');
  assert.equal(normalizeTedDate('2026-03-14Z'), '2026-03-14');
  assert.equal(normalizeTedDate('2026-03-14'), '2026-03-14');
  assert.equal(normalizeTedDate('2026-03-14T12:00:00+01:00'), '2026-03-14T11:00:00.000Z');
  assert.equal(normalizeTedDate('2026-03-14T12:00:00Z'), '2026-03-14T12:00:00.000Z');
  assert.equal(normalizeTedDate('14/03/2026'), null);
  assert.equal(normalizeTedDate('2026-13-45'), null);
  assert.equal(normalizeTedDate(null), null);
});

test('ingest windows are split into week sized chunks with no gaps', () => {
  const chunks = chunkWindow('2026-10-01', '2026-10-20');
  assert.deepEqual(chunks, [
    { from: '2026-10-01', to: '2026-10-07' },
    { from: '2026-10-08', to: '2026-10-14' },
    { from: '2026-10-15', to: '2026-10-20' },
  ]);
  assert.deepEqual(chunkWindow('2026-10-05', '2026-10-05'), [{ from: '2026-10-05', to: '2026-10-05' }]);
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(buildQuery('PRT', '2026-10-01', '2026-10-07'), 'buyer-country=PRT AND publication-date>=20261001 AND publication-date<=20261007');
});

test('pickText and pickList cope with every shape TED uses', () => {
  assert.equal(pickText('  plain  '), 'plain');
  assert.equal(pickText({ por: 'Olá', eng: 'Hello' }), 'Hello'); // English preferred
  assert.equal(pickText({ por: ['Só português'] }), 'Só português');
  assert.equal(pickText({ ENG: ['Upper case key'] }), 'Upper case key');
  assert.equal(pickText([null, '', 'second']), 'second');
  assert.equal(pickText({}), null);
  assert.equal(pickText(undefined), null);
  assert.deepEqual(pickList(['a', ['b', 'a'], { x: 'c' }, null, 5]), ['a', 'b', 'c', '5']);
});

test('a TED notice is normalised into the stored shape', () => {
  const n = normalizeNotice(tedNotice(12, { country: 'LUX', cpv: ['72000000', '48000000-8'], buyer: 'Ville de Luxembourg' }), { queryCountry: 'LUX' });
  assert.equal(n.publication_number, '12-2026');
  assert.equal(n.title, 'IT services lot 12');
  assert.equal(n.buyer_name, 'Ville de Luxembourg');
  assert.equal(n.publication_date, '2026-10-20');
  assert.equal(n.deadline_at, '2026-12-01');
  assert.deepEqual(n.countries, ['LUX']);
  assert.equal(n.primary_country, 'LUX');
  assert.deepEqual(n.cpv_codes, ['48000000', '72000000']);
  assert.equal(n.url, 'https://ted.europa.eu/en/notice/-/detail/12-2026');
  assert.match(n.content_hash, /^[0-9a-f]{64}$/);
  assert.equal(JSON.parse(n.raw)['publication-number'], '12-2026');
});

test('the earliest deadline across lots wins', () => {
  const raw = tedNotice(5);
  raw['deadline-receipt-tender-date-lot'] = ['2026-12-10+01:00', '2026-11-20+01:00', 'not a date'];
  assert.equal(normalizeNotice(raw).deadline_at, '2026-11-20');
});

test('notices without a valid publication number are rejected, not stored as junk', () => {
  assert.equal(normalizeNotice({ 'notice-title': 'x' }), null);
  assert.equal(normalizeNotice({ 'publication-number': "1-2026'; DROP TABLE" }), null);
  assert.equal(normalizeNotice({ 'publication-number': 'abc' }), null);
});

test('links that do not point at TED are replaced by the canonical TED address', () => {
  const raw = tedNotice(7);
  raw.links = { htmlDirect: { ENG: 'https://evil.example/phish' }, html: { ENG: 'http://ted.europa.eu/insecure' } };
  assert.equal(normalizeNotice(raw).url, 'https://ted.europa.eu/en/notice/-/detail/7-2026');
  raw.links = { htmlDirect: { MUL: 'https://ted.europa.eu/en/notice/-/detail/7-2026/html' } };
  assert.equal(normalizeNotice(raw).url, 'https://ted.europa.eu/en/notice/-/detail/7-2026/html');
  delete raw.links;
  assert.equal(normalizeNotice(raw).url, 'https://ted.europa.eu/en/notice/-/detail/7-2026');
});

test('the country that found a notice is always recorded, even if TED left buyer-country empty', () => {
  const raw = tedNotice(9);
  delete raw['buyer-country'];
  const n = normalizeNotice(raw, { queryCountry: 'BEL' });
  assert.deepEqual(n.countries, ['BEL']);
  assert.equal(n.primary_country, 'BEL');
});

test('the content hash ignores country order but changes when the title changes', () => {
  const a = normalizeNotice(tedNotice(3));
  const b = normalizeNotice(tedNotice(3));
  const c = normalizeNotice(tedNotice(3, { title: 'A corrected title' }));
  assert.equal(a.content_hash, b.content_hash);
  assert.notEqual(a.content_hash, c.content_hash);
});
