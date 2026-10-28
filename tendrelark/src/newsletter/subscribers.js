import { nowIso } from '../db/index.js';
import { normalizeEmail, randomToken, sha256, parseUnsubscribeToken, unsubscribeToken } from '../lib/security.js';

// Bump this when the consent wording on the signup form changes, so each subscriber's consent
// can be traced to the exact text they agreed to.
export const CONSENT_VERSION = '2026-10-v1';
export const CONSENT_TEXT =
  'Send me the Tendrelark weekly tender newsletter. I can unsubscribe at any time with one click.';

export const ROLES = {
  it_consultancy: 'IT consultancy',
  engineering_firm: 'Engineering firm',
  professional_services: 'Professional services firm',
  bid_consultant: 'Independent bid consultant',
  other: 'Something else',
};

const CONFIRM_TTL_MS = 48 * 3600 * 1000;
const RESEND_COOLDOWN_MS = 5 * 60 * 1000;

function confirmUrl(config, token) {
  return `${config.siteUrl}/newsletter/confirm?token=${encodeURIComponent(token)}`;
}

export function unsubscribeUrl(config, subscriberId) {
  return `${config.siteUrl}/newsletter/unsubscribe?token=${encodeURIComponent(unsubscribeToken(config.appSecret, subscriberId))}`;
}

/**
 * Starts a signup. Always answers the same way to the caller (the page says "check your inbox")
 * so the form cannot be used to find out who is already on the list.
 * Returns { ok: false, reason: 'invalid_email' } for bad input, otherwise { ok: true }.
 */
export async function requestSignup(db, mailer, config, { email, role, source = 'website' }, now = Date.now()) {
  const address = normalizeEmail(email);
  if (!address) return { ok: false, reason: 'invalid_email' };
  const roleKey = Object.hasOwn(ROLES, role) ? role : null;

  const existing = db.prepare('SELECT * FROM subscribers WHERE email = ?').get(address);
  const stamp = new Date(now).toISOString();

  // The address is the identity. Submitting it again never adds a row: we only count the repeat,
  // so the dashboard shows one subscriber, not several.
  if (existing) {
    db.prepare('UPDATE subscribers SET submit_count = submit_count + 1, last_submitted_at = ? WHERE id = ?').run(stamp, existing.id);
  }

  if (existing?.status === 'confirmed') return { ok: true }; // nothing to do, and nothing to reveal

  if (existing?.status === 'pending' && now - Date.parse(existing.updated_at) < RESEND_COOLDOWN_MS) {
    return { ok: true }; // a confirmation went out moments ago
  }

  const token = randomToken();
  const tokenHash = sha256(token);
  const expires = new Date(now + CONFIRM_TTL_MS).toISOString();

  if (existing) {
    db.prepare(
      `UPDATE subscribers SET status = 'pending', role = COALESCE(?, role), confirm_token_hash = ?, confirm_expires_at = ?,
         consent_text_version = ?, consented_at = ?, unsubscribed_at = NULL, signup_source = ?, updated_at = ? WHERE id = ?`,
    ).run(roleKey, tokenHash, expires, CONSENT_VERSION, stamp, source, stamp, existing.id);
  } else {
    db.prepare(
      `INSERT INTO subscribers (email, role, status, confirm_token_hash, confirm_expires_at, consent_text_version, consented_at,
         signup_source, last_submitted_at, created_at, updated_at) VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(address, roleKey, tokenHash, expires, CONSENT_VERSION, stamp, source, stamp, stamp, stamp);
  }

  const link = confirmUrl(config, token);
  await mailer.send({
    to: address,
    kind: 'newsletter_confirm',
    subject: 'Confirm your Tendrelark newsletter signup',
    text:
      `Hello,\n\nSomeone, hopefully you, asked to receive the Tendrelark weekly tender newsletter at this address.\n\n` +
      `To confirm, open this link (it works for 48 hours):\n${link}\n\n` +
      `If it wasn't you, ignore this email and nothing will happen. You will not hear from us again.\n\n` +
      `Tendrelark\n${config.siteUrl}\n`,
  });
  return { ok: true };
}

/** Returns 'confirmed', 'already', 'expired' or 'invalid'. */
export function confirmSignup(db, token, now = Date.now()) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) return 'invalid';
  const sub = db.prepare('SELECT * FROM subscribers WHERE confirm_token_hash = ?').get(sha256(token));
  if (!sub || sub.status === 'unsubscribed') return 'invalid';
  if (sub.status === 'confirmed') return 'already';
  if (Date.parse(sub.confirm_expires_at) < now) return 'expired';
  const stamp = new Date(now).toISOString();
  db.prepare("UPDATE subscribers SET status = 'confirmed', confirmed_at = ?, updated_at = ? WHERE id = ?").run(stamp, stamp, sub.id);
  return 'confirmed';
}

/** Returns true if the token was valid. Unsubscribing twice is fine. */
export function unsubscribe(db, config, token) {
  const id = parseUnsubscribeToken(config.appSecret, token);
  if (!id) return false;
  const sub = db.prepare('SELECT id, status FROM subscribers WHERE id = ?').get(id);
  if (!sub) return false;
  if (sub.status !== 'unsubscribed') {
    const stamp = nowIso();
    db.prepare("UPDATE subscribers SET status = 'unsubscribed', unsubscribed_at = ?, updated_at = ? WHERE id = ?").run(stamp, stamp, id);
  }
  return true;
}

export function listSubscribers(db, { limit = 200 } = {}) {
  return db
    .prepare(
      `SELECT id, email, role, status, signup_source, submit_count, created_at, confirmed_at, unsubscribed_at, last_submitted_at
       FROM subscribers ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
    .all(limit);
}

export function subscriberCounts(db) {
  const rows = db.prepare('SELECT status, COUNT(*) AS n FROM subscribers GROUP BY status').all();
  const counts = { pending: 0, confirmed: 0, unsubscribed: 0 };
  for (const r of rows) counts[r.status] = r.n;
  return counts;
}
