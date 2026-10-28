import { esc, html, raw } from '../lib/html.js';
import { paragraphs } from '../lib/text.js';
import { COUNTRY_NAMES } from '../config.js';
import { formatDate, formatDeadline } from '../lib/dates.js';
import { CONSENT_TEXT, ROLES } from '../newsletter/subscribers.js';
import { effectiveStatus } from '../sources/verify.js';

const STATUS_LABEL = {
  verified: 'Verified reachable',
  degraded: 'Check failed or limited',
  unreachable: 'Not reachable',
  unverified: 'Not checked yet',
  stale: 'Verification out of date',
};

export function statusPill(source) {
  const status = effectiveStatus(source);
  return html`<span class="pill ${status}">${STATUS_LABEL[status]}</span>`;
}

const RETRIEVAL_LABEL = {
  verified: 'Retrieval verified',
  unavailable: 'Retrieval unavailable',
  unverified: 'Retrieval unverified',
};

/** Automated retrieval is a different question from reachability: can we pull notices in by machine? */
export function retrievalPill(state) {
  return html`<span class="pill ${state === 'unavailable' ? 'degraded' : state}">${RETRIEVAL_LABEL[state]}</span>`;
}

export function countryList(codes) {
  return (codes ?? []).map((c) => COUNTRY_NAMES[c] ?? c).join(', ');
}

/** The newsletter signup form. `idPrefix` keeps ids unique when it appears twice on a page. */
export function signupForm({ token, idPrefix = 'signup', source = 'website', heading = null }) {
  return html`<form class="form" method="post" action="/newsletter/subscribe" novalidate>
    ${heading ? html`<h2 class="h3">${heading}</h2>` : ''}
    <input type="hidden" name="t" value="${token}">
    <input type="hidden" name="source" value="${source}">
    <div class="trap" aria-hidden="true">
      <label for="${idPrefix}-site">Leave this field empty</label>
      <input id="${idPrefix}-site" type="text" name="website" tabindex="-1" autocomplete="off">
    </div>
    <div class="field">
      <label for="${idPrefix}-email">Work email</label>
      <input id="${idPrefix}-email" type="email" name="email" autocomplete="email" required maxlength="254" placeholder="you@company.com">
    </div>
    <div class="field">
      <label for="${idPrefix}-role">What best describes you? <span class="hint">(optional)</span></label>
      <select id="${idPrefix}-role" name="role">
        <option value="">Prefer not to say</option>
        ${Object.entries(ROLES).map(([value, label]) => html`<option value="${value}">${label}</option>`)}
      </select>
    </div>
    <div class="field">
      <label class="check" for="${idPrefix}-consent">
        <input id="${idPrefix}-consent" type="checkbox" name="consent" value="yes" required>
        <span>${CONSENT_TEXT} <a href="/privacy">How we use your email</a>.</span>
      </label>
    </div>
    <div><button class="btn" type="submit">Subscribe to the newsletter</button></div>
  </form>`;
}

export function noticeCard(n, { showCountry = true } = {}) {
  return html`<li class="notice">
    <h3><a href="${n.url}" rel="noopener noreferrer" target="_blank">${n.title || `TED notice ${n.publication_number}`}</a></h3>
    <p class="meta">
      ${n.buyer_name ? html`<span>${n.buyer_name}</span>` : ''}
      ${showCountry && n.countries?.length ? html`<span>${countryList(n.countries)}</span>` : ''}
      ${n.publication_date ? html`<span>Published ${formatDate(n.publication_date)}</span>` : ''}
      ${n.deadline_at ? html`<span>Deadline ${formatDeadline(n.deadline_at)}</span>` : ''}
    </p>
    <p class="source-line muted">Source: <a href="${n.url}" rel="noopener noreferrer" target="_blank">TED notice ${n.publication_number}</a></p>
  </li>`;
}

/** Plain text content shown as paragraphs. Everything is escaped, so no markup an editor types can run. */
export function contentParagraphs(content) {
  return paragraphs(content).map((p) => html`<p>${raw(esc(p).replaceAll('\n', '<br>'))}</p>`);
}

/** One official source link, exactly as recorded on the issue. */
export function sourceLinkItem(link) {
  return html`<li class="notice">
    <h3><a class="source-link" href="${link.url}" rel="noopener noreferrer" target="_blank">${link.label}</a></h3>
    ${link.detail ? html`<p class="meta"><span>${link.detail}</span></p>` : ''}
    <p class="source-line muted">Source: ${link.source_name}${link.publication_number ? `, notice ${link.publication_number}` : ''}</p>
  </li>`;
}

export function check(label) {
  return html`<li>${label}</li>`;
}

export { raw };
