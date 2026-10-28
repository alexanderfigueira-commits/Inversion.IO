import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { openDatabase } from '../src/db/index.js';
import { seedSources } from '../src/db/seed.js';
import { createMailer } from '../src/lib/mailer.js';
import { formToken, hmac } from '../src/lib/security.js';
import { recordCheck } from '../src/sources/verify.js';
import { createApp } from '../src/web/app.js';

export function testConfig(overrides = {}) {
  return loadConfig({
    NODE_ENV: 'test',
    DATABASE_PATH: ':memory:',
    APP_SECRET: 'test-secret-test-secret-test-secret-1234',
    SITE_URL: 'https://www.tendrelark.eu',
    MAIL_TRANSPORT: 'memory',
    TED_RETRY_BASE_MS: '1',
    TED_PAGE_SIZE: '100',
    ...overrides,
  });
}

export function freshDb(config = testConfig()) {
  const db = openDatabase(config.databasePath);
  seedSources(db);
  return db;
}

export function tempDbPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tendrelark-test-'));
  return { dir, file: path.join(dir, 'test.db'), cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

/** Builds a notice in the shape the TED v3 API documents. */
export function tedNotice(n, { country = 'PRT', date = '2026-10-20', cpv = ['72000000'], deadline = '2026-12-01', title, buyer } = {}) {
  return {
    'publication-number': `${n}-2026`,
    'notice-title': { eng: title ?? `IT services lot ${n}`, por: `Serviços de TI lote ${n}` },
    'buyer-name': { por: [buyer ?? `Buyer ${n}`] },
    'buyer-country': [country],
    'publication-date': `${date}+02:00`,
    'notice-type': 'cn-standard',
    'deadline-receipt-tender-date-lot': deadline ? [`${deadline}+01:00`] : [],
    'classification-cpv': cpv,
    links: { htmlDirect: { ENG: `https://ted.europa.eu/en/notice/-/detail/${n}-2026` } },
  };
}

/**
 * A stand in for api.ted.europa.eu that follows the documented request and response shape:
 * POST JSON { query, fields, page, limit } returning { notices, totalNoticeCount }.
 * It filters by country and publication date from the query, paginates, and can be told to fail.
 */
export async function startFakeTed(initial = []) {
  const state = {
    notices: [...initial],
    requests: [],
    failures: [], // statuses to return for upcoming requests, consumed in order
    rejectFields: new Set(), // field names that cause HTTP 400, like the real API for unknown fields
    malformed: false,
  };

  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = JSON.parse(raw || '{}');
      state.requests.push(body);
      const next = state.failures.shift();
      if (next) {
        res.writeHead(next, { 'content-type': 'application/json', ...(next === 429 ? { 'retry-after': '0' } : {}) });
        return res.end(JSON.stringify({ message: `forced ${next}` }));
      }
      const bad = (body.fields ?? []).find((f) => state.rejectFields.has(f));
      if (bad) {
        res.writeHead(400, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ message: `Unknown field ${bad}` }));
      }
      if (state.malformed) {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ hello: 'world' }));
      }
      const m = /buyer-country=(\w{3}) AND publication-date>=(\d{8}) AND publication-date<=(\d{8})/.exec(body.query ?? '');
      const [, country, from, to] = m ?? [];
      const compact = (n) => String(n['publication-date']).slice(0, 10).replaceAll('-', '');
      const matches = state.notices.filter((n) => n['buyer-country'].includes(country) && compact(n) >= from && compact(n) <= to);
      const limit = body.limit ?? 100;
      const page = body.page ?? 1;
      const slice = matches.slice((page - 1) * limit, page * limit).map((n) => {
        const out = {};
        for (const f of body.fields ?? []) if (f in n) out[f] = n[f];
        return out;
      });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ notices: slice, totalNoticeCount: matches.length }));
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  server.unref(); // a failing test must never leave the process hanging on this server
  const url = `http://127.0.0.1:${server.address().port}/v3/notices/search`;
  return {
    state,
    url,
    close: () => new Promise((resolve) => {
      server.closeAllConnections?.();
      server.close(resolve);
    }),
  };
}

export function memoryMailer(config, db) {
  return createMailer(config, db, { log: { info() {} } });
}

/** Marks a directory source as having passed its reachability check, the way a real check would. */
export function verifySource(db, slug, outcome = 'ok') {
  const source = db.prepare('SELECT * FROM sources WHERE slug = ?').get(slug);
  recordCheck(db, source, {
    outcome,
    httpStatus: outcome === 'ok' ? 200 : outcome === 'refused' ? 403 : null,
    responseMs: 12,
    finalUrl: source.url,
    error: outcome === 'ok' ? null : 'test failure',
  });
}

/** Starts the real Express app on a random port over a scratch database. */
export async function startApp(overrides = {}) {
  const config = { ...testConfig({ ADMIN_PASSWORD: 'correct horse battery', ...overrides }), quietLogs: true };
  const db = freshDb(config);
  const mailer = memoryMailer(config, db);
  const app = createApp({ config, db, mailer, log: { info() {}, error() {} } });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  server.unref();
  const base = `http://127.0.0.1:${server.address().port}`;
  const adminAuth = `Basic ${Buffer.from(`${config.admin.user}:${config.admin.password}`).toString('base64')}`;

  const call = async (method, path, { form, headers = {}, admin = false } = {}) => {
    const res = await fetch(base + path, {
      method,
      redirect: 'manual',
      headers: { ...(admin ? { authorization: adminAuth } : {}), ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}), ...headers },
      body: form ? new URLSearchParams(form).toString() : undefined,
    });
    return { status: res.status, headers: res.headers, text: await res.text() };
  };

  return {
    config, db, mailer, base,
    get: (path, opts) => call('GET', path, opts),
    post: (path, form, opts = {}) => call('POST', path, { ...opts, form }),
    /** A form token old enough to pass the "not a script" timing check. */
    token: () => formToken(config.appSecret, Date.now() - 5000),
    csrf: () => hmac(config.appSecret, 'admin-csrf'),
    close: () => new Promise((resolve) => {
      server.closeAllConnections?.();
      server.close(resolve);
    }),
  };
}
