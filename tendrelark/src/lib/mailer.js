import nodemailer from 'nodemailer';
import { nowIso } from '../db/index.js';

/**
 * Turns a mail library error into a sentence a person can act on. Mail errors are famously cryptic,
 * and most "it does not work" cases are one of a handful of causes.
 */
export function explainMailError(err) {
  // nodemailer often puts the useful part in the message and a generic code like ESOCKET on the error.
  const code = err?.code ?? '';
  const text = `${code} ${err?.message ?? ''} ${err?.response ?? ''}`;
  if (code === 'EAUTH' || /\b535\b|authentication|invalid login/i.test(text)) {
    return 'The server refused the username or password. The username is usually the full address (support@tendrelark.eu). Check for a typo, and ask your provider if you need an "app password" for sending.';
  }
  if (/ECONNREFUSED/.test(text)) return 'Nothing is listening on that server and port. Check the outgoing (SMTP) server name and port. Many providers use 465 or 587.';
  if (/ENOTFOUND|EDNS|EAI_AGAIN/.test(text)) return 'The server name was not found. Check the spelling of the outgoing (SMTP) server, and that it is not the incoming (POP3 or IMAP) one.';
  if (/ETIMEDOUT|timed? ?out/i.test(text)) return 'The server did not answer in time. The port may be blocked by a firewall or by your hosting provider, which sometimes blocks port 25.';
  if (/wrong version number|ssl3_get_record|packet length too long/i.test(text)) {
    return 'The encryption setting does not match the port. Use smtps:// with port 465, or smtp:// with port 587.';
  }
  if (/self[- ]signed|certificate|CERT_/i.test(text)) return 'The server\u2019s security certificate was not accepted. Check the server name matches the certificate, or ask your provider.';
  if (code === 'EENVELOPE') return 'The server refused the sender or the recipient. The "From" address must belong to your mailbox or be allowed by your provider.';
  if (/\b55[034]\b/.test(text)) return 'The server refused the message. The "From" address may not be allowed for this login, or the recipient address is wrong.';
  return `Sending failed: ${err?.message ?? 'unknown error'}`;
}

/**
 * Sends email through SMTP when SMTP_URL is set. Without it, messages are logged (and printed
 * outside production) but not delivered, and the email_log says 'logged' so nobody mistakes it
 * for a sent message. MAIL_TRANSPORT=memory keeps messages in `mailer.outbox` for tests.
 */
export function createMailer(config, db, { log = console } = {}) {
  const outbox = [];
  const mode = config.mail.transport === 'memory' ? 'memory' : config.mail.smtpUrl ? 'smtp' : 'console';
  const transport = mode === 'smtp' ? nodemailer.createTransport(config.mail.smtpUrl, { connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 30_000 }) : null;

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

  /** Connects and logs in without sending anything. Only meaningful for a real SMTP connection. */
  async function verify() {
    if (mode !== 'smtp') throw new Error('SMTP_URL is not set, so there is nothing to connect to.');
    await transport.verify();
    return true;
  }

  return { mode, outbox, send, verify };
}
