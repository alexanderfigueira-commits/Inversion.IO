import { getMeta, nowIso, setMeta, tx } from './db/index.js';
import { hmac, normalizeEmail } from './lib/security.js';

// Everything the site stores about a person is keyed on their email address: the newsletter subscriber
// record, any contact enquiries, and the email log. These functions answer an access request (export)
// and an erasure request (erase) for one address. Backups are the exception, see the privacy page.

const SUBSCRIBER_COLUMNS =
  'id, email, role, status, consent_text_version, consented_at, confirmed_at, unsubscribed_at, signup_source, submit_count, last_submitted_at, created_at, updated_at';

/** Returns null when the text is not a plausible email address. */
export function findPersonalData(db, rawEmail) {
  const email = normalizeEmail(rawEmail);
  if (!email) return null;
  const subscribers = db.prepare(`SELECT ${SUBSCRIBER_COLUMNS} FROM subscribers WHERE email = ?`).all(email);
  const enquiries = db.prepare('SELECT id, name, email, company, interest, message, consented_at, created_at FROM enquiries WHERE email = ?').all(email);
  const emailLog = db.prepare('SELECT id, to_email, subject, kind, status, created_at FROM email_log WHERE lower(to_email) = ? ORDER BY id').all(email);
  const deliveries = subscribers.length
    ? db
        .prepare('SELECT d.issue_id, i.slug AS issue, d.status, d.attempted_at FROM newsletter_deliveries d JOIN newsletter_issues i ON i.id = d.issue_id WHERE d.subscriber_id = ?')
        .all(subscribers[0].id)
    : [];
  return { email, subscribers, enquiries, emailLog, deliveries };
}

export const countPersonalData = (data) => ({
  subscribers: data.subscribers.length,
  enquiries: data.enquiries.length,
  emailLog: data.emailLog.length,
  deliveries: data.deliveries.length,
});

/** A copy of everything held about the address, ready to hand to the person. Secrets are not included. */
export function exportPersonalData(db, rawEmail, now = new Date()) {
  const data = findPersonalData(db, rawEmail);
  if (!data) return null;
  return {
    about: `Personal data held by Tendrelark for ${data.email}`,
    generatedAt: now.toISOString(),
    note: 'Backups may hold older copies of this data until they expire. Tender notices are public information and are not personal to you.',
    subscriber: data.subscribers,
    enquiries: data.enquiries,
    newsletterDeliveries: data.deliveries,
    emailLog: data.emailLog,
  };
}

/**
 * Deletes everything held about the address. The only trace kept is a keyed hash of the address and the time
 * (so erasures can be applied again after a backup restore) and a count of requests, never the address or name.
 */
export function erasePersonalData(db, rawEmail, secret) {
  if (!secret) throw new Error('erasePersonalData needs the app secret to record the erasure.');
  const data = findPersonalData(db, rawEmail);
  if (!data) return null;
  const counts = countPersonalData(data);
  tx(db, () => {
    db.prepare('DELETE FROM subscribers WHERE email = ?').run(data.email); // deliveries go with it (cascade)
    db.prepare('DELETE FROM enquiries WHERE email = ?').run(data.email);
    db.prepare('DELETE FROM email_log WHERE lower(to_email) = ?').run(data.email);
    db.prepare('INSERT INTO erasures (email_hash, erased_at) VALUES (?, ?) ON CONFLICT(email_hash) DO UPDATE SET erased_at = excluded.erased_at').run(erasureHash(secret, data.email), nowIso());
    setMeta(db, 'erasure_requests_handled', Number(getMeta(db, 'erasure_requests_handled') || 0) + 1);
    setMeta(db, 'last_erasure_at', nowIso());
  });
  return counts;
}

/** Deletes email log rows older than `days`. The log is for debugging delivery, so it needs no long memory. */
export function purgeOldEmailLogs(db, days = 90, now = new Date()) {
  const cutoff = new Date(now.getTime() - days * 86_400_000).toISOString();
  return Number(db.prepare('DELETE FROM email_log WHERE created_at < ?').run(cutoff).changes);
}

/** Keyed hash of an address. Without the app secret it cannot be reversed by trying known addresses. */
export const erasureHash = (secret, email) => hmac(secret, `erased:${email}`);

/**
 * Applies recorded erasures again. Run after restoring a backup, and at every start, so a person who asked to be
 * erased does not come back with an old copy of the data. Rows created after the erasure (the person signing up
 * again) are left alone.
 */
export function reapplyErasures(db, secret) {
  const erased = new Map(db.prepare('SELECT email_hash, erased_at FROM erasures').all().map((r) => [r.email_hash, r.erased_at]));
  if (!erased.size) return 0;
  let removed = 0;
  const check = (email, createdAt) => {
    const at = erased.get(erasureHash(secret, String(email).toLowerCase()));
    return at !== undefined && createdAt <= at;
  };
  tx(db, () => {
    for (const r of db.prepare('SELECT id, email, created_at FROM subscribers').all()) {
      if (check(r.email, r.created_at)) removed += Number(db.prepare('DELETE FROM subscribers WHERE id = ?').run(r.id).changes);
    }
    for (const r of db.prepare('SELECT id, email, created_at FROM enquiries').all()) {
      if (check(r.email, r.created_at)) removed += Number(db.prepare('DELETE FROM enquiries WHERE id = ?').run(r.id).changes);
    }
    for (const r of db.prepare('SELECT id, to_email, created_at FROM email_log').all()) {
      if (check(r.to_email, r.created_at)) removed += Number(db.prepare('DELETE FROM email_log WHERE id = ?').run(r.id).changes);
    }
  });
  return removed;
}

/** Deletes signups never confirmed, and old enquiries, per the retention settings. Returns what was removed. */
export function purgeExpiredPersonalData(db, retention, now = new Date()) {
  const before = (days) => new Date(now.getTime() - days * 86_400_000).toISOString();
  return {
    emailLog: purgeOldEmailLogs(db, retention.emailLogDays, now),
    unconfirmedSignups: Number(db.prepare("DELETE FROM subscribers WHERE status = 'pending' AND created_at < ?").run(before(retention.unconfirmedSignupDays)).changes),
    enquiries: Number(db.prepare('DELETE FROM enquiries WHERE created_at < ?').run(before(retention.enquiryDays)).changes),
  };
}
