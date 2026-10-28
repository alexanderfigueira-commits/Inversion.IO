import { nowIso } from '../db/index.js';
import { COUNTRY_NAMES } from '../config.js';
import { esc } from '../lib/html.js';
import { formatDate } from '../lib/dates.js';
import { paragraphs } from '../lib/text.js';
import { verifiedCountries } from '../sources/coverage.js';
import { getIssue, IssueError } from './issues.js';
import { unsubscribeUrl } from './subscribers.js';

/** Plain text and HTML bodies. Every source link is the one recorded on the issue, and the archive link is included. */
export function renderIssueEmail(issue, config, unsubscribe) {
  const dateLine = `${formatDate(issue.issue_date)} | ${COUNTRY_NAMES[issue.country] ?? issue.country}`;
  const archiveUrl = `${config.siteUrl}/newsletter/archive/${issue.slug}`;
  const paras = paragraphs(issue.content);

  const text = [
    issue.title,
    dateLine,
    '',
    ...paras.flatMap((p) => [p, '']),
    'Official sources',
    ...issue.links.flatMap((l, i) => [`${i + 1}. ${l.label}`, ...(l.detail ? [`   ${l.detail}`] : []), `   ${l.source_name}: ${l.url}`, '']),
    'Check the official notice before you decide anything. Bid or no bid is always your call.',
    '',
    `Read online: ${archiveUrl}`,
    `Unsubscribe: ${unsubscribe}`,
    '',
  ].join('\n');

  const linksHtml = issue.links
    .map(
      (l) => `
      <tr><td style="padding:14px 0;border-top:1px solid #e3e0d8">
        <p style="margin:0 0 4px;font-size:17px;line-height:1.35"><a href="${esc(l.url)}" style="color:#14532d;font-weight:600">${esc(l.label)}</a></p>
        ${l.detail ? `<p style="margin:0 0 4px;font-size:14px;color:#5b6470">${esc(l.detail)}</p>` : ''}
        <p style="margin:0;font-size:13px;color:#5b6470">Source: <a href="${esc(l.url)}" style="color:#5b6470">${esc(l.source_name)}</a></p>
      </td></tr>`,
    )
    .join('');

  const html = `<!doctype html><html lang="en"><body style="margin:0;background:#faf8f4;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#14213d">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">
    <tr><td style="padding-bottom:8px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#5b6470">Tendrelark &middot; ${esc(dateLine)}</td></tr>
    <tr><td><h1 style="margin:0 0 12px;font-size:26px;line-height:1.2;font-family:Georgia,serif">${esc(issue.title)}</h1>
      ${paras.map((p) => `<p style="margin:0 0 14px;font-size:16px;line-height:1.5">${esc(p).replaceAll('\n', '<br>')}</p>`).join('')}</td></tr>
    <tr><td style="padding-top:6px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#5b6470">Official sources</td></tr>
    ${linksHtml}
    <tr><td style="padding:16px 0;border-top:1px solid #e3e0d8;font-size:14px;line-height:1.5;color:#5b6470">Check the official notice before you decide anything. Bid or no bid is always your call.</td></tr>
    <tr><td style="font-size:13px;color:#5b6470"><a href="${esc(archiveUrl)}" style="color:#5b6470">Read online</a> &middot; <a href="${esc(unsubscribe)}" style="color:#5b6470">Unsubscribe</a></td></tr>
  </table></td></tr></table></body></html>`;

  return { subject: `${issue.title} | Tendrelark`, text, html };
}

/**
 * Sends a published issue to confirmed subscribers who have not received it yet. Safe to run
 * again after a partial failure: delivered subscribers are skipped, failed ones are retried.
 */
export async function sendIssue(db, mailer, config, slug, { log = () => {} } = {}) {
  const issue = getIssue(db, slug);
  if (!issue) throw new IssueError(`Issue ${slug} not found.`);
  if (issue.status !== 'published') throw new IssueError(`Issue ${slug} is a draft. Publish it before sending.`);
  if (!verifiedCountries(db).includes(issue.country)) {
    throw new IssueError(`Coverage for ${COUNTRY_NAMES[issue.country]} is not verified right now, so this issue is hidden from the archive. Run the source check before sending.`);
  }
  if (mailer.mode === 'console') {
    throw new IssueError('SMTP_URL is not set, so nothing would actually be delivered. Refusing to mark this issue as sent.');
  }

  const pending = db
    .prepare(
      `SELECT s.id, s.email FROM subscribers s
       LEFT JOIN newsletter_deliveries d ON d.issue_id = ? AND d.subscriber_id = s.id
       WHERE s.status = 'confirmed' AND (d.status IS NULL OR d.status = 'failed') ORDER BY s.id`,
    )
    .all(issue.id);

  const record = db.prepare(
    `INSERT INTO newsletter_deliveries (issue_id, subscriber_id, status, error, attempted_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(issue_id, subscriber_id) DO UPDATE SET status = excluded.status, error = excluded.error, attempted_at = excluded.attempted_at`,
  );

  let sent = 0;
  let failed = 0;
  for (const sub of pending) {
    const link = unsubscribeUrl(config, sub.id);
    const { subject, text, html } = renderIssueEmail(issue, config, link);
    try {
      await mailer.send({
        to: sub.email,
        kind: 'newsletter_issue',
        subject,
        text,
        html,
        headers: { 'List-Unsubscribe': `<${link}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
      });
      record.run(issue.id, sub.id, 'sent', null, nowIso());
      sent += 1;
    } catch (err) {
      record.run(issue.id, sub.id, 'failed', String(err.message).slice(0, 300), nowIso());
      failed += 1;
      log(`Could not send to subscriber ${sub.id}: ${err.message}`);
    }
  }

  const outstanding = db
    .prepare(
      `SELECT COUNT(*) AS n FROM subscribers s LEFT JOIN newsletter_deliveries d ON d.issue_id = ? AND d.subscriber_id = s.id
       WHERE s.status = 'confirmed' AND (d.status IS NULL OR d.status <> 'sent')`,
    )
    .get(issue.id).n;
  if (outstanding === 0) db.prepare('UPDATE newsletter_issues SET sent_at = COALESCE(sent_at, ?) WHERE id = ?').run(nowIso(), issue.id);

  return { slug, attempted: pending.length, sent, failed, mode: mailer.mode };
}
