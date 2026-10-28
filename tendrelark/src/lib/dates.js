const DAY_MS = 86_400_000;

export const todayIso = (now = new Date()) => now.toISOString().slice(0, 10);

export function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  return new Date(d.getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

export function daysBetween(fromIso, toIso) {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / DAY_MS);
}

/** TED expert search wants dates as YYYYMMDD. */
export const toTedDate = (isoDate) => isoDate.replaceAll('-', '');

/**
 * Normalises the date shapes TED returns, such as "2026-03-14+01:00", "2026-03-14Z" or
 * "2026-03-14T12:00:00+01:00". Date-only values stay date-only (YYYY-MM-DD). Values with a
 * time become a UTC ISO timestamp. Anything else returns null.
 */
export function normalizeTedDate(value) {
  if (typeof value !== 'string') return null;
  const m = value.trim().match(/^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2})(?::(\d{2})(?:\.\d+)?)?)?(Z|[+-]\d{2}:\d{2})?$/);
  if (!m) return null;
  const [, date, hm, sec, zone] = m;
  if (Number.isNaN(Date.parse(`${date}T00:00:00Z`))) return null;
  if (!hm) return date;
  const d = new Date(`${date}T${hm}:${sec ?? '00'}${zone ?? 'Z'}`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** ISO 8601 week for a date: { year, week }, weeks start on Monday. */
export function isoWeek(isoDate) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - day + 3); // Thursday of this week decides the year
  const year = d.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(year, 0, 4));
  const firstDay = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDay + 3);
  const week = 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * DAY_MS));
  return { year, week };
}

export const weekSlug = ({ year, week }) => `${year}-W${String(week).padStart(2, '0')}`;

/** Monday and Sunday (YYYY-MM-DD) of an ISO week slug such as "2026-W44". */
export function weekRange(slug) {
  const m = /^(\d{4})-W(\d{2})$/.exec(slug);
  if (!m) throw new Error(`Invalid week "${slug}". Use the form 2026-W44.`);
  const year = Number(m[1]);
  const week = Number(m[2]);
  if (week < 1 || week > 53) throw new Error(`Invalid week number in "${slug}".`);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = (jan4.getUTCDay() + 6) % 7;
  const monday = new Date(jan4.getTime() - jan4Day * DAY_MS + (week - 1) * 7 * DAY_MS);
  const start = monday.toISOString().slice(0, 10);
  const range = { start, end: addDays(start, 6) };
  if (weekSlug(isoWeek(range.start)) !== slug) throw new Error(`Week "${slug}" does not exist.`);
  return range;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "28 October 2026" from YYYY-MM-DD or an ISO timestamp. */
export function formatDate(value) {
  if (!value) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) return '';
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

/** Deadlines may carry a time. Shows "14 March 2026" or "14 March 2026, 12:00 UTC". */
export function formatDeadline(value) {
  if (!value) return '';
  if (value.length <= 10) return formatDate(value);
  return `${formatDate(value)}, ${value.slice(11, 16)} UTC`;
}

export function formatWeekRange(start, end) {
  const s = /^(\d{4})-(\d{2})-(\d{2})/.exec(start);
  const e = /^(\d{4})-(\d{2})-(\d{2})/.exec(end);
  if (!s || !e) return '';
  if (s[1] === e[1] && s[2] === e[2]) return `${Number(s[3])} to ${Number(e[3])} ${MONTHS[Number(s[2]) - 1]} ${s[1]}`;
  return `${formatDate(start)} to ${formatDate(end)}`;
}
