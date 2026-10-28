import { nowIso } from '../db/index.js';

const USER_AGENT = 'TendrelarkSourceCheck/1.0 (+https://www.tendrelark.eu/sources)';
const FAILURES_BEFORE_UNREACHABLE = 3;
const STALE_AFTER_DAYS = 3;

/**
 * One reachability check. "ok" means the page answered normally. "refused" means the site is up
 * but turned our automated request away (401, 403, 429), which is common on government portals.
 * "failed" means a timeout, network error or server error.
 */
export async function checkUrl(url, { fetchImpl = globalThis.fetch, timeoutMs = 15_000 } = {}) {
  const started = Date.now();
  try {
    const res = await fetchImpl(url, {
      method: 'GET',
      redirect: 'follow',
      headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    await res.body?.cancel?.();
    const responseMs = Date.now() - started;
    const base = { httpStatus: res.status, responseMs, finalUrl: res.url || url };
    if (res.ok) return { outcome: 'ok', ...base, error: null };
    if ([401, 403, 429].includes(res.status)) return { outcome: 'refused', ...base, error: `Site is up but refused the automated check (HTTP ${res.status}).` };
    return { outcome: 'failed', ...base, error: `HTTP ${res.status}` };
  } catch (err) {
    return {
      outcome: 'failed',
      httpStatus: null,
      responseMs: Date.now() - started,
      finalUrl: null,
      error: err.name === 'TimeoutError' ? `No answer within ${timeoutMs / 1000} seconds.` : String(err.cause?.code || err.message).slice(0, 200),
    };
  }
}

/** Records one check on a source and recomputes its status. */
export function recordCheck(db, source, result, now = nowIso()) {
  db.prepare(
    'INSERT INTO source_checks (source_id, checked_at, outcome, http_status, response_ms, final_url, error) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(source.id, now, result.outcome, result.httpStatus, result.responseMs, result.finalUrl, result.error);

  const failures = result.outcome === 'ok' ? 0 : source.consecutive_failures + 1;
  let status;
  if (result.outcome === 'ok') status = 'verified';
  else if (result.outcome === 'refused') status = 'degraded';
  else status = failures >= FAILURES_BEFORE_UNREACHABLE ? 'unreachable' : 'degraded';

  db.prepare(
    `UPDATE sources SET status = ?, last_checked_at = ?, last_verified_at = CASE WHEN ? = 'ok' THEN ? ELSE last_verified_at END,
       last_http_status = ?, last_response_ms = ?, last_error = ?, consecutive_failures = ? WHERE id = ?`,
  ).run(status, now, result.outcome, now, result.httpStatus, result.responseMs, result.error, failures, source.id);

  // Keep the log small: the latest 50 checks per source are plenty.
  db.prepare(
    'DELETE FROM source_checks WHERE source_id = ? AND id NOT IN (SELECT id FROM source_checks WHERE source_id = ? ORDER BY id DESC LIMIT 50)',
  ).run(source.id, source.id);

  return status;
}

export async function verifySources(db, { fetchImpl, timeoutMs, log = () => {} } = {}) {
  const sources = db.prepare('SELECT * FROM sources ORDER BY sort_order').all();
  const results = [];
  for (const source of sources) {
    const result = await checkUrl(source.check_url, { fetchImpl, timeoutMs });
    const status = recordCheck(db, source, result);
    log(`${source.slug}: ${status}${result.error ? ` (${result.error})` : ` (HTTP ${result.httpStatus}, ${result.responseMs} ms)`}`);
    results.push({ slug: source.slug, status, ...result });
  }
  return results;
}

/** A verified status older than a few days no longer counts as current. */
export function effectiveStatus(source, now = Date.now()) {
  if (source.status === 'verified' && source.last_verified_at) {
    const ageDays = (now - Date.parse(source.last_verified_at)) / 86_400_000;
    if (ageDays > STALE_AFTER_DAYS) return 'stale';
  }
  return source.status;
}

const parseJson = (text, fallback) => {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
};

/** Sources with their JSON columns already parsed into extraHosts and referenceLinks. */
export function listSources(db) {
  return db
    .prepare('SELECT * FROM sources ORDER BY sort_order')
    .all()
    .map((s) => ({ ...s, extraHosts: parseJson(s.extra_hosts, []), referenceLinks: parseJson(s.reference_links, []) }));
}
