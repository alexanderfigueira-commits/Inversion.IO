import { html } from '../../lib/html.js';
import { COUNTRY_NAMES } from '../../config.js';
import { SECTORS } from '../../tenders.js';
import { layout, pageHead } from '../layout.js';
import { noticeCard } from '../components.js';

function pageLink(query, page) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v) params.set(k, v);
  if (page > 1) params.set('page', String(page));
  const qs = params.toString();
  return `/tenders${qs ? `?${qs}` : ''}`;
}

export function tendersPage({ config, result, query, stats, countries }) {
  const body = html`
  ${pageHead({
    eyebrow: 'Tenders',
    title: 'Tender notices we have stored from TED',
    lede: 'Notices published by buyers in Portugal, Luxembourg and Belgium. Each one links to the official notice on TED. National portals are checked by hand and are listed on the sources page.',
  })}
  <section class="section">
    <div class="container">
      <form class="filters" method="get" action="/tenders" role="search">
        <div class="field"><label for="f-q">Search title or buyer</label><input id="f-q" type="search" name="q" value="${query.q}" maxlength="100"></div>
        <div class="field"><label for="f-country">Country</label>
          <select id="f-country" name="country">
            <option value="">All three</option>
            ${countries.map((c) => html`<option value="${c}"${query.country === c ? ' selected' : ''}>${COUNTRY_NAMES[c] ?? c}</option>`)}
          </select>
        </div>
        <div class="field"><label for="f-sector">Type of work</label>
          <select id="f-sector" name="sector">
            <option value="">Any</option>
            ${Object.entries(SECTORS).map(([key, s]) => html`<option value="${key}"${query.sector === key ? ' selected' : ''}>${s.label}</option>`)}
          </select>
        </div>
        <div class="field">
          <label class="check" for="f-open"><input id="f-open" type="checkbox" name="open" value="1"${query.open ? ' checked' : ''}><span>Still open</span></label>
          <button class="btn btn-small" type="submit">Filter</button>
        </div>
      </form>

      <p class="muted" aria-live="polite">${result.total} notice${result.total === 1 ? '' : 's'} found${stats.notices ? ` out of ${stats.notices} stored` : ''}.${query.sector ? ' Type of work uses the notice classification (CPV) when TED provides it.' : ''}</p>

      ${result.rows.length
        ? html`<ul class="notice-list">${result.rows.map((n) => noticeCard(n))}</ul>`
        : html`<div class="empty"><p><strong>Nothing matches those filters.</strong></p><p>${stats.notices ? 'Try widening the search.' : 'No notices have been stored yet. They appear after the first ingestion run.'}</p></div>`}

      ${result.pages > 1
        ? html`<nav class="pager" aria-label="Pagination">
            ${result.page > 1 ? html`<a class="btn btn-secondary btn-small" href="${pageLink(query, result.page - 1)}" rel="prev">&larr; Newer</a>` : html`<span></span>`}
            <span class="muted">Page ${result.page} of ${result.pages}</span>
            ${result.page < result.pages ? html`<a class="btn btn-secondary btn-small" href="${pageLink(query, result.page + 1)}" rel="next">Older &rarr;</a>` : html`<span></span>`}
          </nav>`
        : ''}
    </div>
  </section>`;
  return layout({
    config,
    path: '/tenders',
    title: 'Tenders',
    description: 'Public tender notices from Portugal, Luxembourg and Belgium stored from TED, each linked to its official notice.',
    body,
    noindex: Boolean(query.q || query.country || query.sector || query.open || result.page > 1),
  });
}
