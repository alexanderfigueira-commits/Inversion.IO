import { normalizeTedDate } from '../lib/dates.js';
import { sha256 } from '../lib/security.js';

const LANG_PREFERENCE = ['eng', 'por', 'fra', 'nld', 'deu'];
const PUBLICATION_NUMBER = /^\d{1,9}-\d{4}$/;
const TED_HOST = 'ted.europa.eu';

/**
 * TED returns multilingual text as { eng: "...", por: "..." } and often wraps values in arrays.
 * This picks one readable string from whichever shape arrives.
 */
export function pickText(value, langs = LANG_PREFERENCE) {
  if (value == null) return null;
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const text = pickText(item, langs);
      if (text) return text;
    }
    return null;
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value);
    for (const lang of langs) {
      const key = keys.find((k) => k.toLowerCase() === lang);
      if (key) {
        const text = pickText(value[key], langs);
        if (text) return text;
      }
    }
    for (const key of keys) {
      const text = pickText(value[key], langs);
      if (text) return text;
    }
  }
  return null;
}

/** Flattens strings, arrays and language maps into a de duplicated list of strings. */
export function pickList(value) {
  const out = new Set();
  const walk = (v) => {
    if (v == null) return;
    if (typeof v === 'string' || typeof v === 'number') {
      const s = String(v).trim();
      if (s) out.add(s);
    } else if (Array.isArray(v)) v.forEach(walk);
    else if (typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(value);
  return [...out];
}

function earliest(dates) {
  const parsed = dates
    .map(normalizeTedDate)
    .filter(Boolean)
    .map((d) => ({ d, t: Date.parse(d.length === 10 ? `${d}T00:00:00Z` : d) }));
  if (!parsed.length) return null;
  return parsed.reduce((a, b) => (b.t < a.t ? b : a)).d;
}

/** Only accept links that really point at TED. API content is data, not a trusted source of URLs. */
function tedLink(links, publicationNumber) {
  const fallback = `https://${TED_HOST}/en/notice/-/detail/${publicationNumber}`;
  if (!links || typeof links !== 'object') return fallback;
  for (const kind of ['htmlDirect', 'html']) {
    const group = links[kind];
    if (!group || typeof group !== 'object') continue;
    const keys = Object.keys(group);
    const ordered = [...['eng', 'mul'].map((l) => keys.find((k) => k.toLowerCase() === l)).filter(Boolean), ...keys];
    for (const key of ordered) {
      try {
        const u = new URL(group[key]);
        if (u.protocol === 'https:' && u.hostname === TED_HOST) return u.toString();
      } catch {
        // try the next candidate
      }
    }
  }
  return fallback;
}

/**
 * Turns one raw API notice into the shape we store. Returns null when the notice has no usable
 * publication number, so the caller can count it as failed instead of storing junk.
 * `queryCountry` is the country filter that found the notice. It is always recorded, so a notice
 * cannot be lost from country counts because the API left its buyer-country empty.
 */
export function normalizeNotice(apiNotice, { queryCountry = null } = {}) {
  const publicationNumber = pickText(apiNotice?.['publication-number']);
  if (!publicationNumber || !PUBLICATION_NUMBER.test(publicationNumber)) return null;

  const countries = new Set(pickList(apiNotice['buyer-country']).map((c) => c.toUpperCase()).filter((c) => /^[A-Z]{3}$/.test(c)));
  if (queryCountry) countries.add(queryCountry);

  const cpv = new Set(
    pickList(apiNotice['classification-cpv'])
      .map((c) => c.match(/^\d{8}/)?.[0])
      .filter(Boolean),
  );

  const publicationDate = normalizeTedDate(pickText(apiNotice['publication-date']))?.slice(0, 10) ?? null;

  const notice = {
    publication_number: publicationNumber,
    title: pickText(apiNotice['notice-title']),
    buyer_name: pickText(apiNotice['buyer-name']),
    notice_type: pickText(apiNotice['notice-type']),
    publication_date: publicationDate,
    deadline_at: earliest(pickList(apiNotice['deadline-receipt-tender-date-lot'])),
    url: tedLink(apiNotice.links, publicationNumber),
    countries: [...countries].sort(),
    cpv_codes: [...cpv].sort(),
  };
  notice.primary_country = (queryCountry && countries.has(queryCountry) ? queryCountry : notice.countries[0]) ?? null;
  notice.raw = JSON.stringify(apiNotice);
  // Countries are left out of the hash on purpose. A joint procurement can be found by two
  // country queries, and each sees a slightly different set. Countries are merged on upsert.
  notice.content_hash = sha256(
    JSON.stringify([
      notice.title,
      notice.buyer_name,
      notice.notice_type,
      notice.publication_date,
      notice.deadline_at,
      notice.url,
      notice.cpv_codes,
    ]),
  );
  return notice;
}
