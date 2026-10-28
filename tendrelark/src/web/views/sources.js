import { html } from '../../lib/html.js';
import { COUNTRY_NAMES } from '../../config.js';
import { formatDate } from '../../lib/dates.js';
import { retrievalState } from '../../sources/coverage.js';
import { layout, pageHead } from '../layout.js';
import { retrievalPill, statusPill } from '../components.js';

const COUNTRY_NOTES = {
  EU: 'Everything above the EU thresholds in all three countries is published on TED, so it is the baseline. National sources only matter for below threshold and national only notices.',
  PRT: 'Portugal publishes notices as public domain open data, but the dataset is updated only every two weeks and may be stale. That suits an archive better than a weekly newsletter.',
  LUX: 'Luxembourg is the hardest of the three. There is no documented machine readable notice feed, and the government says its portal shows only part of the notices published, because every contract notice also appears in the printed press. We cover the above threshold tier through TED. National only notices are partly covered.',
  BEL: 'Belgium has one platform for every level of government, and it flags which notices are also on TED. Whether it offers public API access is not confirmed.',
};

const METHOD_LABEL = { api_ingest: 'Importer built', manual_review: 'Reviewed by hand, not imported' };

const firstSentence = (text) => (text ? (text.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? text) : 'Not assessed yet.');

function checkedLine(s) {
  if (!s.last_checked_at) return 'Not checked yet.';
  const parts = [`Last checked ${formatDate(s.last_checked_at)}`];
  if (s.last_verified_at && s.status !== 'verified') parts.push(`last reachable ${formatDate(s.last_verified_at)}`);
  if (s.status !== 'verified' && s.last_error) parts.push(s.last_error);
  return `${parts.join(', ')}.`;
}

function retrievalDetail(s, r) {
  if (s.method === 'api_ingest') {
    return r.state === 'verified'
      ? `The importer has stored ${r.stored} notice${r.stored === 1 ? '' : 's'}${r.newest ? `, newest published ${formatDate(r.newest)}` : ''}.`
      : 'The importer is built, but no run has stored notices yet, so we do not claim it is working.';
  }
  if (r.state === 'unavailable') return 'No documented automated interface was found. Nothing is imported.';
  return 'Not tested. Nothing is imported.';
}

function sourceCard(s, r) {
  return html`<article class="card source" id="${s.slug}">
    <div class="source-head">
      <h3><a href="${s.url}" rel="noopener noreferrer" target="_blank">${s.name}</a></h3>
      ${statusPill(s)}
    </div>
    <p><span class="tag ${s.method === 'api_ingest' ? 'auto' : ''}">${METHOD_LABEL[s.method]}</span></p>
    <dl>
      <dt>What it is</dt><dd>${s.description}</dd>
      <dt>How we use it</dt><dd>${s.how_we_use_it}</dd>
      <dt>Is it reachable?</dt><dd>${checkedLine(s)}</dd>
      <dt>Automated retrieval</dt><dd>${retrievalPill(r.state)} <span class="muted">${retrievalDetail(s, r)}</span></dd>
      <dt>Import feasibility</dt><dd>${s.import_feasibility ?? 'Not assessed yet.'}</dd>
      ${s.referenceLinks.length
        ? html`<dt>Official pages</dt><dd><ul class="plain">${s.referenceLinks.map((l) => html`<li><a href="${l.url}" rel="noopener noreferrer" target="_blank">${l.label}</a></li>`)}</ul></dd>`
        : ''}
      ${s.finding_checked_on ? html`<dt>Research dated</dt><dd>${formatDate(s.finding_checked_on)}</dd>` : ''}
    </dl>
  </article>`;
}

export function sourcesPage({ config, sources, retrieval }) {
  const byCountry = (code) => sources.filter((s) => s.country === code);
  const ted = sources.find((s) => s.slug === 'ted');
  const groups = [
    { key: 'EU', title: 'EU level' },
    { key: 'PRT', title: 'Portugal' },
    { key: 'LUX', title: 'Luxembourg' },
    { key: 'BEL', title: 'Belgium' },
  ];

  const body = html`
  ${pageHead({
    eyebrow: 'Sources and coverage',
    title: 'Where our tender information comes from',
    lede: 'We would rather show you the limits of our coverage than hide them. For each country you can see the official platform, a link to it, whether notices can be retrieved automatically, and what we know about importing from it.',
  })}

  <section class="section">
    <div class="container">
      <div class="section-head"><h2>Coverage at a glance</h2></div>
      <div class="table-wrap">
        <table>
          <caption class="sr-only">Coverage by country</caption>
          <thead><tr><th scope="col">Country</th><th scope="col">Above EU thresholds</th><th scope="col">National platform</th><th scope="col">Import feasibility</th></tr></thead>
          <tbody>
            ${['PRT', 'LUX', 'BEL'].map((code) => html`<tr>
                <th scope="row">${COUNTRY_NAMES[code]}</th>
                <td>${ted ? html`<a href="#ted">TED</a><br>${retrievalPill(retrieval.ted.state)}` : '-'}</td>
                <td>${byCountry(code).map((s) => html`<div class="glance"><a href="#${s.slug}">${s.name}</a><br>${retrievalPill(retrieval[s.slug].state)}</div>`)}</td>
                <td>${byCountry(code).map((s) => html`<div class="glance">${firstSentence(s.import_feasibility)}</div>`)}</td>
              </tr>`)}
          </tbody>
        </table>
      </div>
      <p class="muted small">Nothing is imported from a national platform today. The pill under each name shows what we can say about automated retrieval, and “verified” is only used once an importer has actually stored records.</p>
    </div>
  </section>

  <section class="section alt">
    <div class="container prose">
      <h2>How to read this page</h2>
      <p>Each source answers two separate questions.</p>
      <p><strong>Is it reachable?</strong> We make an automated request to the platform and record the result and the date.</p>
      <ul>
        <li><span class="pill verified">Verified reachable</span> It answered normally at the last check. This does not mean every notice on it has been collected.</li>
        <li><span class="pill degraded">Check failed or limited</span> It did not answer normally, or refused our automated request.</li>
        <li><span class="pill unreachable">Not reachable</span> Several checks in a row failed.</li>
        <li><span class="pill stale">Verification out of date</span> It passed once, but not within the last few days.</li>
        <li><span class="pill unverified">Not checked yet</span> We have not run a check yet.</li>
      </ul>
      <p><strong>Can its notices be retrieved automatically?</strong></p>
      <ul>
        <li><span class="pill verified">Retrieval verified</span> An importer exists and has stored records from this source.</li>
        <li><span class="pill degraded">Retrieval unavailable</span> We researched it and found no documented automated interface.</li>
        <li><span class="pill unverified">Retrieval unverified</span> We have not tested it, or the research could not confirm it.</li>
      </ul>
      <p>The national findings come from our research dated 27 October 2026, which relies on each platform’s own pages and documentation. Coverage changes, so the dates on each card are the ones to trust.</p>
    </div>
  </section>

  ${groups.map((group) => {
    const list = byCountry(group.key);
    if (!list.length) return '';
    return html`<section class="section" aria-labelledby="g-${group.key}">
      <div class="container">
        <div class="section-head"><h2 id="g-${group.key}">${group.title}</h2><p>${COUNTRY_NOTES[group.key]}</p></div>
        <div class="grid grid-2">${list.map((s) => sourceCard(s, retrieval[s.slug]))}</div>
      </div>
    </section>`;
  })}

  <section class="section alt">
    <div class="container narrow prose">
      <h2>Missing a source you rely on?</h2>
      <p>Tell us which platform you use and we will look at it. <a href="/contact">Get in touch</a>.</p>
    </div>
  </section>`;

  return layout({
    config,
    path: '/sources',
    title: 'Sources and coverage',
    description: 'The official tender platforms for Portugal, Luxembourg and Belgium, whether notices can be retrieved automatically, and what we know about importing from each.',
    body,
  });
}

export { retrievalState };
