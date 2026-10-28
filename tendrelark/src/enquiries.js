import { nowIso } from './db/index.js';
import { normalizeEmail } from './lib/security.js';

export const INTEREST_LABELS = {
  tender_intelligence: 'Tender intelligence',
  ai_automation: 'Custom AI automations',
  both: 'Both',
  other: 'Something else',
};

const clean = (value, max) => String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max);

/**
 * Validates and stores a contact enquiry, then emails the team. Returns { ok: false } when
 * the input is not acceptable. The caller has already checked consent, spam trap and rate limit.
 */
export async function createEnquiry(db, mailer, config, input) {
  const email = normalizeEmail(input.email);
  const name = clean(input.name, 120);
  const message = clean(input.message, 4000);
  const company = clean(input.company, 160) || null;
  const interest = Object.hasOwn(INTEREST_LABELS, input.interest) ? input.interest : 'other';
  if (!email || !name || message.length < 5) return { ok: false };

  const now = nowIso();
  db.prepare('INSERT INTO enquiries (name, email, company, interest, message, consented_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    name,
    email,
    company,
    interest,
    message,
    now,
    now,
  );

  // Header fields come from a visitor, so strip line breaks to rule out header injection.
  const oneLine = (s) => s.replace(/[\r\n]+/g, ' ');
  try {
    await mailer.send({
      to: config.contact.email,
      kind: 'enquiry_notification',
      subject: `New enquiry from ${oneLine(name)}`,
      text: `Name: ${name}\nEmail: ${email}\nCompany: ${company ?? '-'}\nInterest: ${INTEREST_LABELS[input.interest] ?? 'Something else'}\n\n${message}\n`,
      headers: { 'Reply-To': `${oneLine(name).replace(/[<>",]/g, '')} <${email}>` },
    });
  } catch {
    // The enquiry is saved. A mail failure is recorded in email_log and must not lose the message.
  }
  return { ok: true };
}
