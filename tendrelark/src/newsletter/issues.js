import { nowIso, tx } from '../db/index.js';
import { addDays, formatDeadline, isoWeek, todayIso, weekRange, weekSlug } from '../lib/dates.js';
import { COUNTRY_NAMES } from '../config.js';
import { COVERED_COUNTRIES, matchOfficialSource, verifiedCountries } from '../sources/coverage.js';

// CPV divisions that match who we write for: software (48), engineering and architecture (71),
// IT services (72), research and consultancy (73) and business services (79).
export const RELEVANT_CPV_DIVISIONS = ['48', '71', '72', '73', '79'];
export const MAX_LINKS = 8;
const MAX_PER_BUILD = 5;
const MIN_RELEVANT_BEFORE_FILLING = 3;

/** An editorial rule was broken. `problems` lists each one in plain words for the form. */
export class IssueError extends Error {
  constructor(message, problems = [message]) {
    super(message);
    this.problems = problems;
  }
}

export const ISSUE_SLUG = /^\d{4}-\d{2}-\d{2}-(?:prt|lux|bel)(?:-\d+)?$/;

const LINK_SELECT = `SELECT l.*, s.name AS source_name, s.slug AS source_slug, t.publication_number
  FROM newsletter_links l JOIN sources s ON s.id = l.source_id LEFT JOIN ted_notices t ON t.id = l.notice_id`;

export function currentWeekSlug(now = new Date()) {
  return weekSlug(isoWeek(todayIso(now)));
}

/** The week before the current one, which is what a Monday morning issue covers. */
export function previousWeekSlug(now = new Date()) {
  return weekSlug(isoWeek(addDays(todayIso(now), -7)));
}

const isRealDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

/**
 * Checks what an editor typed and returns { value, problems }. The rules live here, once, so the
 * admin form, the CLI and publishing all agree. Links must be https and sit on an official source
 * from the directory that serves the issue's country. Each is stored with the source it matched.
 */
export function validateIssueInput(db, input, { requireVerifiedCountry = true } = {}) {
  const problems = [];
  const title = String(input.title ?? '').trim();
  const content = String(input.content ?? '').replace(/\r\n/g, '\n').trim();
  const issueDate = String(input.issue_date ?? '').trim();
  const country = String(input.country ?? '').trim();

  if (!title) problems.push('Add a title.');
  else if (title.length > 140) problems.push('The title is longer than 140 characters.');
  if (!isRealDate(issueDate)) problems.push('Choose a valid issue date.');
  if (content.length > 8000) problems.push('The content is longer than 8000 characters.');

  if (!COVERED_COUNTRIES.includes(country)) problems.push('Choose a covered country.');
  else if (requireVerifiedCountry && !verifiedCountries(db).includes(country)) {
    problems.push(`Coverage for ${COUNTRY_NAMES[country]} is not verified yet. Run the source check on the dashboard first.`);
  }

  const rows = (Array.isArray(input.links) ? input.links : []).filter((l) => String(l?.url ?? '').trim() || String(l?.label ?? '').trim());
  if (rows.length > MAX_LINKS) problems.push(`Use at most ${MAX_LINKS} source links.`);

  const links = [];
  const seen = new Set();
  rows.slice(0, MAX_LINKS).forEach((row, i) => {
    const n = i + 1;
    const rawUrl = String(row.url ?? '').trim();
    if (!rawUrl) return problems.push(`Link ${n} has a label but no address.`);
    if (!COVERED_COUNTRIES.includes(country)) return undefined; // cannot judge the link without a country
    const match = matchOfficialSource(db, country, rawUrl);
    if (!match.ok) return problems.push(`Link ${n} ${match.reason}.`);
    if (seen.has(match.url)) return problems.push(`Link ${n} repeats an earlier link.`);
    seen.add(match.url);
    const label = String(row.label ?? '').trim().slice(0, 200) || new URL(match.url).hostname;
    return links.push({ label, detail: String(row.detail ?? '').trim().slice(0, 300) || null, url: match.url, source_id: match.source.id, notice_id: row.notice_id ?? null });
  });

  return { value: { title, issue_date: issueDate, country, content, links }, problems };
}

function freeSlug(db, issueDate, country) {
  const base = `${issueDate}-${country.toLowerCase()}`;
  let slug = base;
  for (let n = 2; db.prepare('SELECT 1 FROM newsletter_issues WHERE slug = ?').get(slug); n += 1) slug = `${base}-${n}`;
  return slug;
}

function writeLinks(db, issueId, links) {
  const add = db.prepare('INSERT INTO newsletter_links (issue_id, position, source_id, notice_id, label, detail, url) VALUES (?, ?, ?, ?, ?, ?, ?)');
  db.prepare('DELETE FROM newsletter_links WHERE issue_id = ?').run(issueId);
  links.forEach((l, i) => add.run(issueId, i + 1, l.source_id, l.notice_id, l.label, l.detail, l.url));
}

/** Creates a draft. Only countries with verified coverage are accepted. Drafts are never public. */
export function createDraft(db, input) {
  const { value, problems } = validateIssueInput(db, input);
  if (problems.length) throw new IssueError(problems[0], problems);
  const now = nowIso();
  return tx(db, () => {
    const slug = freeSlug(db, value.issue_date, value.country);
    const id = Number(
      db
        .prepare(`INSERT INTO newsletter_issues (slug, title, issue_date, country, content, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'draft', ?, ?)`)
        .run(slug, value.title, value.issue_date, value.country, value.content, now, now).lastInsertRowid,
    );
    writeLinks(db, id, value.links);
    return getIssue(db, slug);
  });
}

/** Saves edits to a draft. Published issues are frozen so what readers see never changes silently. */
export function updateDraft(db, slug, input) {
  const issue = db.prepare('SELECT * FROM newsletter_issues WHERE slug = ?').get(slug);
  if (!issue) throw new IssueError('Issue not found.');
  if (issue.status === 'published') throw new IssueError('A published issue cannot be edited. Unpublish it first.');
  // Keeping the same country never needs a fresh verification, so a lapse does not trap a draft.
  const { value, problems } = validateIssueInput(db, input, { requireVerifiedCountry: input.country !== issue.country });
  if (problems.length) throw new IssueError(problems[0], problems);
  tx(db, () => {
    db.prepare('UPDATE newsletter_issues SET title = ?, issue_date = ?, country = ?, content = ?, updated_at = ? WHERE id = ?').run(value.title, value.issue_date, value.country, value.content, nowIso(), issue.id);
    writeLinks(db, issue.id, value.links);
  });
  return getIssue(db, slug);
}

/**
 * The publish gate. Before an issue goes public it needs a title, content, a country whose
 * coverage is verified right now, and at least one source link that still resolves to an official
 * source in the directory. Every failure is reported together so the editor fixes them in one go.
 */
export function publishIssue(db, slug) {
  const issue = getIssue(db, slug);
  if (!issue) throw new IssueError('Issue not found.');
  if (issue.status === 'published') return issue;

  const { problems } = validateIssueInput(db, {
    title: issue.title,
    issue_date: issue.issue_date,
    country: issue.country,
    content: issue.content,
    links: issue.links,
  });
  if (!issue.content.trim()) problems.push('Add the issue content.');
  if (!issue.links.length) problems.push('Add at least one official source link from the directory.');
  if (problems.length) throw new IssueError(problems[0], [...new Set(problems)]);

  const now = nowIso();
  db.prepare("UPDATE newsletter_issues SET status = 'published', published_at = ?, updated_at = ? WHERE id = ?").run(now, now, issue.id);
  return getIssue(db, slug);
}

export function unpublishIssue(db, slug) {
  const result = db.prepare("UPDATE newsletter_issues SET status = 'draft', published_at = NULL, updated_at = ? WHERE slug = ?").run(nowIso(), slug);
  if (!result.changes) throw new IssueError('Issue not found.');
  return getIssue(db, slug);
}

export function getIssue(db, slug) {
  const issue = db.prepare('SELECT * FROM newsletter_issues WHERE slug = ?').get(slug);
  if (!issue) return null;
  return { ...issue, links: db.prepare(`${LINK_SELECT} WHERE l.issue_id = ? ORDER BY l.position`).all(issue.id) };
}

/** Every issue, drafts included. For the admin area only. */
export function listAllIssues(db) {
  return db
    .prepare(`SELECT i.*, (SELECT COUNT(*) FROM newsletter_links WHERE issue_id = i.id) AS link_count FROM newsletter_issues i ORDER BY i.issue_date DESC, i.id DESC`)
    .all();
}

/**
 * What the public can see: published issues whose country has verified coverage. Drafts never
 * appear, and neither do published issues for a country whose coverage has lapsed.
 */
export function listPublicIssues(db, { country } = {}) {
  const countries = verifiedCountries(db).filter((c) => !country || c === country);
  if (!countries.length) return [];
  return db
    .prepare(
      `SELECT i.*, (SELECT COUNT(*) FROM newsletter_links WHERE issue_id = i.id) AS link_count FROM newsletter_issues i
       WHERE i.status = 'published' AND i.country IN (${countries.map(() => '?').join(',')})
       ORDER BY i.issue_date DESC, i.id DESC`,
    )
    .all(...countries);
}

export function getPublicIssue(db, slug) {
  if (!ISSUE_SLUG.test(slug)) return null;
  const issue = getIssue(db, slug);
  if (!issue || issue.status !== 'published' || !verifiedCountries(db).includes(issue.country)) return null;
  return issue;
}

function candidates(db, country, start, end) {
  const rows = db
    .prepare(
      `SELECT DISTINCT t.id, t.publication_number, t.title, t.buyer_name, t.deadline_at, t.publication_date, t.url
       FROM ted_notices t JOIN ted_notice_countries c ON c.notice_id = t.id
       WHERE c.country = ? AND t.publication_date >= ? AND t.publication_date <= ?`,
    )
    .all(country, start, end);
  const cpvStmt = db.prepare('SELECT cpv_code FROM ted_notice_cpv WHERE notice_id = ?');
  return rows.map((r) => {
    const cpv = cpvStmt.all(r.id).map((x) => x.cpv_code);
    let relevance = 1; // no CPV data: cannot judge, keep as a fallback
    if (cpv.length) relevance = cpv.some((c) => RELEVANT_CPV_DIVISIONS.includes(c.slice(0, 2))) ? 0 : 2;
    return { ...r, relevance };
  });
}

/**
 * Picks the tenders for one country and ISO week. Relevant CPV divisions come first, then notices
 * with no CPV data if there are too few relevant ones. Notices whose deadline passed by the end of
 * the week are skipped. Closest deadline first, because that is what a reader can act on.
 */
export function selectItems(db, country, start, end) {
  const pool = candidates(db, country, start, end)
    .filter((n) => n.relevance < 2 && (!n.deadline_at || n.deadline_at.slice(0, 10) >= end))
    .sort((a, b) => a.relevance - b.relevance || (a.deadline_at ?? '9999').localeCompare(b.deadline_at ?? '9999') || b.publication_date.localeCompare(a.publication_date));
  const relevant = pool.filter((n) => n.relevance === 0);
  return (relevant.length >= MIN_RELEVANT_BEFORE_FILLING ? relevant : pool).slice(0, MAX_PER_BUILD);
}

/**
 * Starts a draft for one country from the TED notices stored for an ISO week. It is a starting point
 * for an editor, not an issue: it stays a draft until someone reviews, edits and publishes it.
 * The issue date is the Monday after the covered week, so building the same week twice finds the same draft.
 */
export function buildDraftIssue(db, { week = previousWeekSlug(), country, replace = false } = {}) {
  if (!COVERED_COUNTRIES.includes(country)) throw new IssueError(`Choose one of ${COVERED_COUNTRIES.join(', ')}.`);
  if (!verifiedCountries(db).includes(country)) throw new IssueError(`Coverage for ${COUNTRY_NAMES[country]} is not verified yet. Run the source check first.`);

  const { start, end } = weekRange(week);
  const issueDate = addDays(end, 1);
  const slug = `${issueDate}-${country.toLowerCase()}`;
  const existing = db.prepare('SELECT id, status FROM newsletter_issues WHERE slug = ?').get(slug);
  if (existing?.status === 'published') throw new IssueError(`Issue ${slug} is already published and cannot be rebuilt.`);
  if (existing && !replace) throw new IssueError(`A draft ${slug} already exists. Edit it, or rebuild with replace.`);

  const picked = selectItems(db, country, start, end);
  const total = db
    .prepare(
      `SELECT COUNT(DISTINCT t.id) AS n FROM ted_notices t JOIN ted_notice_countries c ON c.notice_id = t.id
       WHERE c.country = ? AND t.publication_date >= ? AND t.publication_date <= ?`,
    )
    .get(country, start, end).n;

  const name = COUNTRY_NAMES[country];
  const content =
    `TED published ${total} notice${total === 1 ? '' : 's'} from buyers in ${name} in week ${week.split('-W')[1]} of ${week.slice(0, 4)}. ` +
    (picked.length
      ? `Below are the ones that look most relevant to IT, engineering and professional services firms, closest deadline first. Each links to its official notice. Check the notice itself before you decide anything.`
      : `None of them matched our filters, so there is nothing to list yet. Add official source links by hand, or leave this draft.`);

  const links = [];
  for (const n of picked) {
    const match = matchOfficialSource(db, country, n.url);
    if (!match.ok) continue;
    const detail = [n.buyer_name, n.deadline_at ? `Deadline ${formatDeadline(n.deadline_at)}` : null].filter(Boolean).join(' | ');
    links.push({ label: n.title || `TED notice ${n.publication_number}`, detail: detail || null, url: match.url, source_id: match.source.id, notice_id: n.id });
  }

  const now = nowIso();
  tx(db, () => {
    let id;
    if (existing) {
      id = existing.id;
      db.prepare('UPDATE newsletter_issues SET content = ?, updated_at = ? WHERE id = ?').run(content, now, id);
    } else {
      id = Number(
        db
          .prepare(`INSERT INTO newsletter_issues (slug, title, issue_date, country, content, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'draft', ?, ?)`)
          .run(slug, `Tender watch: ${name}, week ${week.split('-W')[1]} of ${week.slice(0, 4)}`, issueDate, country, content, now, now).lastInsertRowid,
      );
    }
    writeLinks(db, id, links);
  });
  return { slug, linkCount: links.length, totalNotices: total };
}
