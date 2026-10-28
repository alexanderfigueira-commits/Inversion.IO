import { getMeta, nowIso, setMeta, tx } from './db/index.js';
import { normalizeEmail } from './lib/security.js';

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
 * Deletes everything held about the address. The only trace kept is a count of how many erasure requests
 * were handled, with no address and no name, so the operator can show the process is used.
 */
export function erasePersonalData(db, rawEmail) {
  const data = findPersonalData(db, rawEmail);
  if (!data) return null;
  const counts = countPersonalData(data);
  tx(db, () => {
    db.prepare('DELETE FROM subscribers WHERE email = ?').run(data.email); // deliveries go with it (cascade)
    db.prepare('DELETE FROM enquiries WHERE email = ?').run(data.email);
    db.prepare('DELETE FROM email_log WHERE lower(to_email) = ?').run(data.email);
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
