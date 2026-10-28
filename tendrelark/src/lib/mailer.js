import nodemailer from 'nodemailer';
import { nowIso } from '../db/index.js';

/**
 * Sends email through SMTP when SMTP_URL is set. Without it, messages are logged (and printed
 * outside production) but not delivered, and the email_log says 'logged' so nobody mistakes it
 * for a sent message. MAIL_TRANSPORT=memory keeps messages in `mailer.outbox` for tests.
 */
export function createMailer(config, db, { log = console } = {}) {
  const outbox = [];
  const mode = config.mail.transport === 'memory' ? 'memory' : config.mail.smtpUrl ? 'smtp' : 'console';
  const transport = mode === 'smtp' ? nodemailer.createTransport(config.mail.smtpUrl) : null;

  const record = db.prepare('INSERT INTO email_log (to_email, subject, kind, status, error, created_at) VALUES (?, ?, ?, ?, ?, ?)');

  async function send({ to, subject, text, html, kind, headers = {} }) {
    const message = { from: config.mail.from, to, subject, text, html, headers };
    try {
      if (mode === 'smtp') {
        await transport.sendMail(message);
        record.run(to, subject, kind, 'sent', null, nowIso());
        return { delivered: true };
      }
      if (mode === 'memory') outbox.push(message);
      else if (!config.production) log.info?.(`\n[mail not sent: SMTP_URL is not set]\nTo: ${to}\nSubject: ${subject}\n\n${text}\n`);
      record.run(to, subject, kind, 'logged', null, nowIso());
      return { delivered: false };
    } catch (err) {
      record.run(to, subject, kind, 'failed', String(err.message).slice(0, 300), nowIso());
      throw err;
    }
  }

  return { mode, outbox, send };
}
