import { COUNTRY_NAMES } from '../config.js';
import { listSources } from './verify.js';

export const COVERED_COUNTRIES = ['PRT', 'LUX', 'BEL'];

/**
 * A country has verified coverage when at least one source in the directory that serves it passed
 * its last reachability check. National sources serve their own country. The EU level source (TED)
 * serves all three, because every above threshold notice from these countries is published there.
 * This is reachability, not completeness: the sources page says so in plain words.
 */
export function verifiedCountries(db) {
  const rows = db.prepare("SELECT country FROM sources WHERE status = 'verified'").all();
  const verified = new Set(rows.map((r) => r.country));
  return COVERED_COUNTRIES.filter((c) => verified.has(c) || verified.has('EU'));
}

export function isCountryVerified(db, country) {
  return verifiedCountries(db).includes(country);
}

const bareHost = (host) => host.toLowerCase().replace(/^www\./, '');

/**
 * Checks that a link points at an official source from the directory that serves `country`.
 * Deep links are fine (a specific notice page), but the host must be the source's own host or one
 * of its subdomains. Returns { ok, url, source } or { ok: false, reason }.
 */
export function matchOfficialSource(db, country, rawUrl) {
  let url;
  try {
    url = new URL(String(rawUrl).trim());
  } catch {
    return { ok: false, reason: 'is not a valid web address' };
  }
  if (url.protocol !== 'https:') return { ok: false, reason: 'must start with https://' };
  if (url.username || url.password) return { ok: false, reason: 'must not contain a username or password' };

  const host = bareHost(url.hostname);
  const candidates = listSources(db).filter((s) => s.country === country || s.country === 'EU');
  const hostsOf = (s) => [new URL(s.url).hostname, ...s.extraHosts].map(bareHost);
  const source = candidates.find((s) => hostsOf(s).some((h) => host === h || host.endsWith(`.${h}`)));
  if (!source) {
    const names = [...new Set(candidates.flatMap(hostsOf))].join(', ');
    return { ok: false, reason: `is not on an official ${COUNTRY_NAMES[country]} source from our directory (${names})` };
  }
  url.hash = '';
  return { ok: true, url: url.toString(), source };
}

/** What the sources page shows for automated retrieval: verified, unavailable or unverified. */
export function retrievalState(db, source) {
  if (source.method === 'api_ingest') {
    const evidence = db
      .prepare(
        `SELECT COUNT(*) AS runs, MAX(finished_at) AS last_at FROM ingestion_runs
         WHERE source_slug = ? AND status IN ('ok','partial') AND (inserted + updated + unchanged) > 0`,
      )
      .get(source.slug);
    if (evidence.runs > 0) {
      const stored = db.prepare('SELECT COUNT(*) AS n, MAX(publication_date) AS newest FROM ted_notices').get();
      return { state: 'verified', stored: stored.n, newest: stored.newest, lastAt: evidence.last_at, feasibility: source.import_feasibility };
    }
    return { state: 'unverified', stored: 0, newest: null, lastAt: null, feasibility: source.import_feasibility };
  }
  return { state: source.retrieval_finding, stored: 0, newest: null, lastAt: source.finding_checked_on, feasibility: source.import_feasibility };
}
