import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { test } from 'node:test';
import { addDays, todayIso } from '../src/lib/dates.js';
import { downloadResource, fetchDatasetMeta, judgeFreshness, parseDateCell, pickResource, renderDatasetReport, scanCsvDates, scanJsonDates } from '../src/sources/base-dataset.js';
import { tempDbPath } from './helpers.js';

async function server(routes) {
  const s = http.createServer((req, res) => {
    const r = routes[req.url];
    if (!r) return res.writeHead(404).end('nope');
    res.writeHead(200, { 'content-type': r.type ?? 'text/plain' });
    return res.end(r.body);
  });
  await new Promise((resolve) => s.listen(0, '127.0.0.1', resolve));
  s.unref();
  return { base: `http://127.0.0.1:${s.address().port}`, close: () => new Promise((r) => { s.closeAllConnections?.(); s.close(r); }) };
}

const iso = (daysAgo) => addDays(todayIso(), -daysAgo);

test('date cells in Portuguese dataset shapes are understood, and junk is not', () => {
  assert.equal(parseDateCell('2026-03-08'), '2026-03-08');
  assert.equal(parseDateCell('2026-03-08T10:20:30'), '2026-03-08');
  assert.equal(parseDateCell('08/03/2026'), '2026-03-08');
  assert.equal(parseDateCell('08-03-2026 10:00'), '2026-03-08');
  assert.equal(parseDateCell('31/02/2026'), null);
  assert.equal(parseDateCell('1850-01-01'), null);
  assert.equal(parseDateCell('12345678'), null);
  assert.equal(parseDateCell('Anúncio de procedimento'), null);
  assert.equal(parseDateCell(null), null);
});

test('the CSV scan copes with semicolons, quotes, line breaks inside fields and mixed date formats', async () => {
  const tmp = tempDbPath();
  const file = path.join(tmp.dir, 'a.csv');
  fs.writeFileSync(
    file,
    '﻿id;descrição;dataPublicacaoAnuncio;prazoPropostas;valor\r\n' +
      '1;"Serviços; de ""TI"""; 2026-03-01;15/04/2026;100\r\n' +
      '2;"Linha um\nlinha dois";08/03/2026;;250,50\r\n' +
      '3;Obras;2026-02-27;01-05-2026;\r\n' +
      '\r\n' +
      '4;"Sem data";;;\r\n',
  );
  const scan = await scanCsvDates(file);
  assert.equal(scan.delimiter, ';');
  assert.equal(scan.rows, 4);
  assert.deepEqual(scan.header, ['id', 'descrição', 'dataPublicacaoAnuncio', 'prazoPropostas', 'valor']);
  const pub = scan.dateColumns.find((c) => c.name === 'dataPublicacaoAnuncio');
  assert.deepEqual([pub.newest, pub.oldest, pub.dates, pub.nonEmpty], ['2026-03-08', '2026-02-27', 3, 3]);
  assert.equal(scan.dateColumns.find((c) => c.name === 'prazoPropostas').newest, '2026-05-01');
  assert.equal(scan.newestColumn, 'dataPublicacaoAnuncio'); // publication like columns win over deadlines
  assert.equal(scan.newest, '2026-03-08');
  assert.ok(!scan.dateColumns.some((c) => c.name === 'valor'));
  tmp.cleanup();
});

test('the CSV scan detects commas too, and a JSON file works the same way', async () => {
  const tmp = tempDbPath();
  fs.writeFileSync(path.join(tmp.dir, 'b.csv'), 'id,data_publicacao\n1,2026-01-05\n2,2026-01-09\n');
  const csv = await scanCsvDates(path.join(tmp.dir, 'b.csv'));
  assert.equal(csv.delimiter, ',');
  assert.equal(csv.newest, '2026-01-09');

  fs.writeFileSync(path.join(tmp.dir, 'c.json'), JSON.stringify({ items: [{ id: 1, dataPublicacao: '2026-04-02' }, { id: 2, dataPublicacao: '2026-04-20', tipo: 'x' }] }));
  const json = scanJsonDates(path.join(tmp.dir, 'c.json'));
  assert.equal(json.rows, 2);
  assert.equal(json.newest, '2026-04-20');
  assert.throws(() => scanJsonDates(path.join(tmp.dir, 'c.json'), { maxBytes: 5 }), /too large/);
  tmp.cleanup();
});

test('freshness is judged against what a biweekly feed should look like', () => {
  const now = new Date();
  assert.equal(judgeFreshness(iso(5), { now }).level, 'fresh');
  assert.match(judgeFreshness(iso(5), { now }).message, /too slow for a "new this week" newsletter|still too slow/);
  assert.equal(judgeFreshness(iso(40), { now }).level, 'lagging');
  assert.equal(judgeFreshness('2026-03-08', { now: new Date('2026-10-28T00:00:00Z') }).level, 'stale'); // the case in the research note
  assert.equal(judgeFreshness(null).level, 'unknown');
});

test('the dataset description is read and the best file is picked', async (t) => {
  const meta = {
    title: 'Anúncios de 2012 a 2026',
    frequency: 'biweekly',
    license: 'cc-0',
    last_update: '2026-03-08T10:00:00',
    resources: [
      { title: 'Anúncios (xlsx)', format: 'XLSX', url: 'https://example.pt/a.xlsx', filesize: 1000 },
      { title: 'Anúncios (csv)', format: 'CSV', url: 'https://example.pt/a.csv', filesize: 5 * 1048576, last_modified: '2026-03-08' },
    ],
  };
  const s = await server({ '/api/': { body: JSON.stringify(meta), type: 'application/json' } });
  t.after(() => s.close());
  const got = await fetchDatasetMeta({ url: `${s.base}/api/` });
  assert.equal(got.title, 'Anúncios de 2012 a 2026');
  assert.equal(got.frequency, 'biweekly');
  assert.equal(got.lastUpdate, '2026-03-08T10:00:00');
  assert.equal(pickResource(got.resources).format, 'csv');
  assert.equal(pickResource([{ format: 'xlsx', url: 'x' }]), null);
  await assert.rejects(fetchDatasetMeta({ url: `${s.base}/missing/` }), /HTTP 404/);
  assert.match(renderDatasetReport({ meta: got, resource: pickResource(got.resources), scan: null }), /Run again with --download/);
});

test('download, scan and report work end to end, and flag a stale file', async (t) => {
  const csv = `id;dataPublicacao\n1;2026-03-08\n2;2026-02-01\n`;
  const s = await server({ '/f.csv': { body: csv } });
  t.after(() => s.close());
  const tmp = tempDbPath();
  const file = path.join(tmp.dir, 'dl.csv');
  const downloaded = await downloadResource(`${s.base}/f.csv`, file);
  assert.equal(downloaded.bytes, Buffer.byteLength(csv));
  const scan = await scanCsvDates(file);
  const freshness = judgeFreshness(scan.newest, { now: new Date('2026-10-28T00:00:00Z') });
  const report = renderDatasetReport({ meta: { title: 'T', frequency: 'biweekly', license: 'cc-0', lastUpdate: '2026-03-08', resources: [] }, resource: null, scan, freshness, downloaded });
  assert.match(report, /Newest date, from column "dataPublicacao": 2026-03-08/);
  assert.match(report, /Verdict: STALE/);
  assert.match(report, /Ask IMPIC/);
  tmp.cleanup();
});

test('a download that grows past the limit is stopped and leaves no partial file', async (t) => {
  const s = await server({ '/big.csv': { body: 'x'.repeat(50_000) } });
  t.after(() => s.close());
  const tmp = tempDbPath();
  const file = path.join(tmp.dir, 'big.csv');
  await assert.rejects(downloadResource(`${s.base}/big.csv`, file, { maxBytes: 10_000 }), /larger than the/);
  assert.equal(fs.existsSync(file), false);
  await assert.rejects(downloadResource(`${s.base}/none.csv`, file), /HTTP 404/);
  tmp.cleanup();
});
