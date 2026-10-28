import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable, Transform } from 'node:stream';
import { daysBetween, todayIso } from '../lib/dates.js';

// The open dataset "Anúncios de 2012 a 2026" published by IMPIC (Portal BASE) on dados.gov.pt. The research
// note of 27 October 2026 lists it as public domain, biweekly, with a last update shown as 8 March 2026, and
// leaves it unverified whether the feed is stale or the metadata wrong. This module answers that question.
export const BASE_DATASET_API = 'https://dados.gov.pt/api/1/datasets/contratos-publicos-portal-base-impic-anuncios-de-2012-a-2026/';

/** Reads the dataset description from the dados.gov.pt API (small, fast). */
export async function fetchDatasetMeta({ fetchImpl = globalThis.fetch, url = BASE_DATASET_API } = {}) {
  const res = await fetchImpl(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`dados.gov.pt answered HTTP ${res.status} for the dataset description.`);
  const d = await res.json();
  return {
    title: d.title ?? null,
    frequency: d.frequency ?? null,
    license: d.license ?? null,
    lastUpdate: d.last_update ?? d.last_modified ?? null,
    lastModified: d.last_modified ?? null,
    resources: (d.resources ?? []).map((r) => ({
      title: r.title ?? null,
      format: String(r.format ?? '').toLowerCase(),
      url: r.url ?? null,
      filesize: r.filesize ?? null,
      lastModified: r.last_modified ?? r.modified ?? null,
    })),
  };
}

/** Prefers a CSV, then JSON. Other formats (spreadsheets, archives) are listed but not scanned. */
export function pickResource(resources, preferred = ['csv', 'json']) {
  for (const format of preferred) {
    const found = resources.find((r) => r.format === format && r.url);
    if (found) return found;
  }
  return null;
}

/** Streams a file to disk and stops if it grows past maxBytes, so a surprise huge file cannot fill the disk. */
export async function downloadResource(url, file, { fetchImpl = globalThis.fetch, maxBytes = 600 * 1024 * 1024 } = {}) {
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(15 * 60_000) });
  if (!res.ok) throw new Error(`The download answered HTTP ${res.status}.`);
  let bytes = 0;
  const limiter = new Transform({
    transform(chunk, _enc, cb) {
      bytes += chunk.length;
      if (bytes > maxBytes) cb(new Error(`The file is larger than the ${Math.round(maxBytes / 1048576)} MB limit. Raise the limit if you really want it.`));
      else cb(null, chunk);
    },
  });
  try {
    await pipeline(Readable.fromWeb(res.body), limiter, fs.createWriteStream(file));
  } catch (err) {
    fs.rmSync(file, { force: true });
    throw err;
  }
  return { file, bytes };
}

const ISO = /^(\d{4})-(\d{2})-(\d{2})(?:[T ]|$)/;
const DMY = /^(\d{2})[/.-](\d{2})[/.-](\d{4})(?:[T ]|$)/;

/** Returns YYYY-MM-DD for the date shapes Portuguese datasets use, or null. */
export function parseDateCell(value) {
  const v = String(value ?? '').trim();
  let y;
  let m;
  let d;
  let match = ISO.exec(v);
  if (match) [, y, m, d] = match;
  else if ((match = DMY.exec(v))) [, d, m, y] = match;
  else return null;
  const iso = `${y}-${m}-${d}`;
  if (Number(y) < 1990 || Number(y) > 2100) return null;
  return new Date(`${iso}T00:00:00Z`).toISOString().slice(0, 10) === iso ? iso : null;
}

/** Splits a stream of text into CSV records, handling quotes, doubled quotes and line breaks inside fields. */
async function* csvRecords(chunks, delimiter) {
  let field = '';
  let record = [];
  let inQuotes = false;
  let quoteSeen = false; // a quote inside a quoted field: either an escape ("") or the end of the field
  for await (const chunk of chunks) {
    for (const c of chunk) {
      if (inQuotes) {
        if (quoteSeen) {
          quoteSeen = false;
          if (c === '"') {
            field += '"';
            continue;
          }
          inQuotes = false; // that quote ended the field, so handle c as ordinary text below
        } else if (c === '"') {
          quoteSeen = true;
          continue;
        } else {
          field += c;
          continue;
        }
      }
      if (c === '"' && field === '') inQuotes = true;
      else if (c === delimiter) {
        record.push(field);
        field = '';
      } else if (c === '\n') {
        record.push(field.replace(/\r$/, ''));
        field = '';
        yield record;
        record = [];
      } else field += c;
    }
  }
  if (field !== '' || record.length) {
    record.push(field);
    yield record;
  }
}

function detectDelimiter(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(65536);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    const first = buf.toString('utf8', 0, n).replace(/^﻿/, '').split('\n')[0];
    const counts = [',', ';', '\t', '|'].map((d) => [d, first.split(d).length - 1]);
    return counts.sort((a, b) => b[1] - a[1])[0][0];
  } finally {
    fs.closeSync(fd);
  }
}

function summarise(rows, columns) {
  const stats = columns
    .map((c) => ({ name: c.name, dates: c.dates, nonEmpty: c.nonEmpty, newest: c.newest, oldest: c.oldest }))
    .filter((c) => c.nonEmpty > 0 && c.dates / c.nonEmpty >= 0.5);
  const publicationLike = stats.filter((c) => /public|anunc|divulg/i.test(c.name));
  const best = (publicationLike.length ? publicationLike : stats).sort((a, b) => (b.newest ?? '').localeCompare(a.newest ?? ''))[0] ?? null;
  return { rows, dateColumns: stats, newestColumn: best?.name ?? null, newest: best?.newest ?? null };
}

/** Scans a CSV for date columns and reports the newest value in each. Reads the file as a stream. */
export async function scanCsvDates(file) {
  const delimiter = detectDelimiter(file);
  const stream = fs.createReadStream(file, { encoding: 'utf8' });
  let header = null;
  let columns = [];
  let rows = 0;
  for await (const record of csvRecords(stream, delimiter)) {
    if (!header) {
      header = record.map((h) => h.replace(/^﻿/, '').trim());
      columns = header.map((name) => ({ name, dates: 0, nonEmpty: 0, newest: null, oldest: null }));
      continue;
    }
    if (record.length === 1 && record[0] === '') continue; // blank line
    rows += 1;
    record.forEach((cell, i) => {
      const col = columns[i];
      if (!col || cell.trim() === '') return;
      col.nonEmpty += 1;
      const iso = parseDateCell(cell);
      if (!iso) return;
      col.dates += 1;
      if (!col.newest || iso > col.newest) col.newest = iso;
      if (!col.oldest || iso < col.oldest) col.oldest = iso;
    });
  }
  return { delimiter, header, ...summarise(rows, columns) };
}

/** Same idea for a JSON file that holds an array of records (directly, or under a single key). */
export function scanJsonDates(file, { maxBytes = 200 * 1024 * 1024 } = {}) {
  if (fs.statSync(file).size > maxBytes) throw new Error('The JSON file is too large to read in one go. Use the CSV version if there is one.');
  let data = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(data)) data = Object.values(data).find(Array.isArray) ?? [];
  const byName = new Map();
  for (const row of data) {
    for (const [name, value] of Object.entries(row ?? {})) {
      if (value == null || value === '') continue;
      const col = byName.get(name) ?? { name, dates: 0, nonEmpty: 0, newest: null, oldest: null };
      col.nonEmpty += 1;
      const iso = parseDateCell(value);
      if (iso) {
        col.dates += 1;
        if (!col.newest || iso > col.newest) col.newest = iso;
        if (!col.oldest || iso < col.oldest) col.oldest = iso;
      }
      byName.set(name, col);
    }
  }
  return { delimiter: null, header: [...byName.keys()], ...summarise(data.length, [...byName.values()]) };
}

/**
 * What the newest date means for Tendrelark. The dataset is meant to update every two weeks, so a lag
 * of up to about three weeks is normal. A "new this week" newsletter needs fresher data than that.
 */
export function judgeFreshness(newest, { now = new Date() } = {}) {
  if (!newest) return { level: 'unknown', days: null, message: 'No date column was found, so freshness could not be judged. Look at the columns listed above.' };
  const days = daysBetween(newest, todayIso(now));
  if (days <= 21) return { level: 'fresh', days, message: `The newest notice is ${days} days old. That is in line with a biweekly update. Usable for an archive. It is still too slow for a "new this week" newsletter, which needs fresher data.` };
  if (days <= 60) return { level: 'lagging', days, message: `The newest notice is ${days} days old, which is later than a biweekly update should give. Ask IMPIC whether updates are delayed.` };
  return { level: 'stale', days, message: `The newest notice is ${days} days old. The dataset looks stale, whatever its metadata says. Ask IMPIC whether it is still maintained before building on it.` };
}

export function renderDatasetReport({ meta, resource, scan, freshness, downloaded }) {
  const lines = ['Portal BASE open dataset check', '', `Dataset: ${meta.title}`, `Update frequency in the metadata: ${meta.frequency ?? 'not stated'}`, `Licence in the metadata: ${meta.license ?? 'not stated'}`, `Last update in the metadata: ${meta.lastUpdate ?? 'not stated'}`, '', 'Files:'];
  for (const r of meta.resources) lines.push(`  ${r.format || '?'}  ${r.title ?? ''}  ${r.filesize ? `${Math.round(r.filesize / 1048576)} MB` : ''}  last modified ${r.lastModified ?? 'not stated'}`);
  if (!scan) {
    lines.push('', resource ? `Not downloaded. Run again with --download to scan ${resource.format.toUpperCase()} for the newest notice date.` : 'No CSV or JSON file is listed, so the contents cannot be scanned automatically.');
    return `${lines.join('\n')}\n`;
  }
  lines.push('', `Scanned ${downloaded.file} (${Math.round(downloaded.bytes / 1048576)} MB), ${scan.rows} rows.`, 'Date columns found (newest value, share of filled cells that are dates):');
  for (const c of scan.dateColumns) lines.push(`  ${c.name}: newest ${c.newest}, oldest ${c.oldest}, ${Math.round((c.dates / c.nonEmpty) * 100)}% dates`);
  if (!scan.dateColumns.length) lines.push(`  none. Columns: ${scan.header.join(', ')}`);
  lines.push('', `Newest date, from column "${scan.newestColumn ?? 'n/a'}": ${scan.newest ?? 'unknown'}`, `Verdict: ${freshness.level.toUpperCase()}. ${freshness.message}`);
  return `${lines.join('\n')}\n`;
}
