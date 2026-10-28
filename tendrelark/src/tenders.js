import { todayIso } from './lib/dates.js';

export const SECTORS = {
  it: { label: 'IT and software', divisions: ['48', '72'] },
  engineering: { label: 'Engineering and architecture', divisions: ['71'] },
  consulting: { label: 'Consultancy and business services', divisions: ['73', '79'] },
};

const likeEscape = (s) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * Lists stored TED notices with optional filters. All filter values are bound parameters.
 * `countries` limits what a visitor can pick, so a stray value cannot widen the query.
 */
export function searchNotices(db, { q = '', country = '', sector = '', openOnly = false, page = 1, pageSize = 20 } = {}, allowedCountries = []) {
  const where = [];
  const params = [];

  const term = String(q).trim().slice(0, 100);
  if (term) {
    where.push("(t.title LIKE ? ESCAPE '\\' OR t.buyer_name LIKE ? ESCAPE '\\' OR t.publication_number = ?)");
    params.push(`%${likeEscape(term)}%`, `%${likeEscape(term)}%`, term);
  }
  if (allowedCountries.includes(country)) {
    where.push('EXISTS (SELECT 1 FROM ted_notice_countries c WHERE c.notice_id = t.id AND c.country = ?)');
    params.push(country);
  } else if (allowedCountries.length) {
    where.push(`EXISTS (SELECT 1 FROM ted_notice_countries c WHERE c.notice_id = t.id AND c.country IN (${allowedCountries.map(() => '?').join(',')}))`);
    params.push(...allowedCountries);
  }
  if (Object.hasOwn(SECTORS, sector)) {
    const divisions = SECTORS[sector].divisions;
    where.push(`EXISTS (SELECT 1 FROM ted_notice_cpv p WHERE p.notice_id = t.id AND substr(p.cpv_code, 1, 2) IN (${divisions.map(() => '?').join(',')}))`);
    params.push(...divisions);
  }
  if (openOnly) {
    where.push('(t.deadline_at IS NOT NULL AND substr(t.deadline_at, 1, 10) >= ?)');
    params.push(todayIso());
  }

  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = db.prepare(`SELECT COUNT(*) AS n FROM ted_notices t ${clause}`).get(...params).n;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, Number.parseInt(page, 10) || 1), pages);

  const rows = db
    .prepare(
      `SELECT t.* FROM ted_notices t ${clause} ORDER BY t.publication_date DESC, t.id DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, pageSize, (current - 1) * pageSize);

  const countriesStmt = db.prepare('SELECT country FROM ted_notice_countries WHERE notice_id = ? ORDER BY country');
  for (const r of rows) r.countries = countriesStmt.all(r.id).map((x) => x.country);

  return { rows, total, page: current, pages };
}

export function tedStats(db) {
  const totals = db
    .prepare('SELECT COUNT(*) AS notices, MAX(publication_date) AS latest_publication, MIN(first_seen_at) AS oldest_seen, MAX(last_seen_at) AS last_seen FROM ted_notices')
    .get();
  const byCountry = db
    .prepare('SELECT country, COUNT(*) AS n FROM ted_notice_countries GROUP BY country ORDER BY country')
    .all();
  return { ...totals, byCountry };
}
