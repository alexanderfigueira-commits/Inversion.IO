import { html, raw, xml } from '../../lib/html.js';
import { COUNTRY_NAMES } from '../../config.js';
import { formatDate } from '../../lib/dates.js';
import { excerpt } from '../../lib/text.js';
import { layout, pageHead, flash } from '../layout.js';
import { contentParagraphs, signupForm, sourceLinkItem } from '../components.js';

const SIGNUP_MESSAGES = {
  check: ['ok', 'Almost done. We have sent a confirmation email. Open the link in it to start receiving the newsletter.'],
  invalid: ['error', 'That email address does not look right. Please check it and try again.'],
  consent: ['error', 'Please tick the box so we know you want the newsletter.'],
  slow: ['error', 'That was a bit quick, or the page was open for a long time. Please try again.'],
  limit: ['error', 'Too many attempts from this connection. Please try again in a little while.'],
};

export function newsletterPage({ config, token, status, recent }) {
  const [kind, message] = Object.hasOwn(SIGNUP_MESSAGES, status) ? SIGNUP_MESSAGES[status] : [];
  const body = html`
  ${pageHead({
    eyebrow: 'Weekly newsletter',
    title: 'The weekly tender newsletter',
    lede: 'Once a week: the public tenders from Portugal, Luxembourg and Belgium that look most relevant to IT, engineering and professional services firms. Every item links to its official notice.',
  })}
  <section class="section">
    <div class="container split">
      <div>
        <h2>What you will get</h2>
        <ul class="checks">
          <li>A short list, not every notice published that week</li>
          <li>Buyer, country and deadline for each tender</li>
          <li>A link to the official source on every item</li>
          <li>A short note from us where something deserves a closer look</li>
        </ul>
        <p class="muted">We do not share your address. You confirm by email first, and every issue has a one click unsubscribe. See the <a href="/privacy">privacy page</a>.</p>
        <p><a href="/newsletter/archive">Browse the archive of past issues &rarr;</a></p>
      </div>
      <div class="signup-card">
        ${kind ? flash(kind, message) : ''}
        ${signupForm({ token, idPrefix: 'nl', source: 'newsletter_page', heading: 'Subscribe' })}
      </div>
    </div>
  </section>
  ${recent.length
    ? html`<section class="section alt"><div class="container">
        <div class="section-head"><h2>Latest issues</h2></div>
        <ul class="notice-list">${recent.map(issueRow)}</ul>
        <p><a href="/newsletter/archive">See all issues &rarr;</a></p>
      </div></section>`
    : ''}`;
  return layout({
    config,
    path: '/newsletter',
    title: 'Weekly tender newsletter',
    description: 'A weekly email with the most relevant public tenders from Portugal, Luxembourg and Belgium for IT, engineering and professional services firms. Every item links to its source.',
    body,
    noindex: Boolean(status),
  });
}

function issueRow(issue) {
  return html`<li class="notice">
    <h3><a href="/newsletter/archive/${issue.slug}">${issue.title}</a></h3>
    <p class="meta"><span>${formatDate(issue.issue_date)}</span><span>${COUNTRY_NAMES[issue.country]}</span><span>${issue.link_count} official source link${issue.link_count === 1 ? '' : 's'}</span></p>
    <p class="muted">${excerpt(issue.content)}</p>
  </li>`;
}

/**
 * `countries` are the countries with verified coverage and `issues` are already limited to them.
 * `selected` is the country filter in use, or ''.
 */
export function archivePage({ config, issues, countries, selected }) {
  const tab = (code, label) =>
    html`<li><a href="${code ? `/newsletter/archive?country=${code}` : '/newsletter/archive'}"${selected === code ? raw(' aria-current="page"') : ''}>${label}</a></li>`;
  const body = html`
  ${pageHead({
    eyebrow: 'Newsletter archive',
    title: 'Past issues of the weekly tender newsletter',
    lede: 'Newest first. Each issue covers one country and links to the official sources it draws on. Older notices may have closed, so check the deadline on the notice itself.',
  })}
  <section class="section">
    <div class="container">
      ${countries.length
        ? html`<nav aria-label="Filter by country"><ul class="filter-tabs">${tab('', 'All countries')}${countries.map((c) => tab(c, COUNTRY_NAMES[c]))}</ul></nav>`
        : ''}
      ${issues.length
        ? html`<ul class="notice-list">${issues.map(issueRow)}</ul>`
        : html`<div class="empty">
            <p><strong>${selected ? `No issues have been published for ${COUNTRY_NAMES[selected]} yet.` : 'No issues have been published yet.'}</strong></p>
            <p>${selected ? html`<a href="/newsletter/archive">See all countries</a> or ` : ''}<a href="/newsletter">subscribe</a> to get the first one by email.</p>
          </div>`}
      <p class="muted small"><a href="/newsletter/archive.xml">RSS feed</a> of published issues.</p>
    </div>
  </section>`;
  return layout({
    config,
    path: '/newsletter/archive',
    title: 'Newsletter archive',
    description: 'Archive of the Tendrelark weekly tender newsletter, by date and country. Every issue links to its official sources.',
    body,
    noindex: Boolean(selected),
  });
}

export function issuePage({ config, issue, token }) {
  const body = html`
  ${pageHead({
    eyebrow: `${COUNTRY_NAMES[issue.country]} | ${formatDate(issue.issue_date)}`,
    title: issue.title,
  })}
  <section class="section">
    <div class="container narrow">
      <div class="prose issue-content">${contentParagraphs(issue.content)}</div>
      <h2 id="official-sources">Official sources</h2>
      <ol class="notice-list" aria-labelledby="official-sources">${issue.links.map(sourceLinkItem)}</ol>
      <p class="muted small">Check the official notice before you decide anything. Bid or no bid is always your call.</p>
      <p><a href="/newsletter/archive">&larr; All issues</a></p>
    </div>
  </section>
  <section class="section alt">
    <div class="container split">
      <div><h2>Get the next issue by email</h2><p>One email a week. Unsubscribe with one click.</p></div>
      <div class="signup-card">${signupForm({ token, idPrefix: 'issue', source: `archive_${issue.slug}` })}</div>
    </div>
  </section>`;
  return layout({
    config,
    path: `/newsletter/archive/${issue.slug}`,
    title: issue.title,
    description: `${issue.title}. ${issue.links.length} official source link${issue.links.length === 1 ? '' : 's'} for ${COUNTRY_NAMES[issue.country]}, published ${formatDate(issue.issue_date)}.`,
    body,
    ogType: 'article',
  });
}

/** Confirmation and unsubscribe pages show a button instead of acting on GET, so email scanners that
 *  open every link cannot confirm or unsubscribe anyone by accident. */
export function actionPage({ config, path, title, message, token, action, button, tone = 'ok', hideForm = false }) {
  const body = html`<section class="section"><div class="container narrow">
    <h1>${title}</h1>
    ${message ? flash(tone, message) : ''}
    ${hideForm
      ? html`<div class="btn-row"><a class="btn" href="/">Back to the home page</a><a class="btn btn-secondary" href="/newsletter/archive">Newsletter archive</a></div>`
      : html`<form method="post" action="${action}"><input type="hidden" name="token" value="${token}"><button class="btn" type="submit">${button}</button></form>`}
  </div></section>`;
  return layout({ config, path, title, description: title, body, noindex: true });
}

export function rssFeed({ config, issues }) {
  const items = issues
    .map(
      (i) => `<item><title>${xml(i.title)}</title><link>${xml(`${config.siteUrl}/newsletter/archive/${i.slug}`)}</link><guid isPermaLink="true">${xml(`${config.siteUrl}/newsletter/archive/${i.slug}`)}</guid><pubDate>${new Date(`${i.issue_date}T00:00:00Z`).toUTCString()}</pubDate><category>${xml(COUNTRY_NAMES[i.country])}</category><description>${xml(excerpt(i.content, 300))}</description></item>`,
    )
    .join('');
  return raw(
    `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Tendrelark weekly tender newsletter</title><link>${xml(config.siteUrl)}/newsletter/archive</link><description>Public tenders from Portugal, Luxembourg and Belgium. Every item links to its official source.</description><language>en</language>${items}</channel></rss>`,
  ).value;
}
