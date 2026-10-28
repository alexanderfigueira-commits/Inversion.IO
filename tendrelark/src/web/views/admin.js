import { html } from '../../lib/html.js';
import { formatDate } from '../../lib/dates.js';
import { COUNTRY_NAMES } from '../../config.js';
import { MAX_LINKS } from '../../newsletter/issues.js';
import { layout, flash } from '../layout.js';
import { retrievalPill, statusPill } from '../components.js';
import { contentParagraphs } from '../components.js';

function adminShell({ config, path, title, body }) {
  const wrapped = html`<div class="admin-bar"><div class="container">Admin &middot; <a href="/admin">Dashboard</a> &middot; <a href="/admin/subscribers">Subscribers</a> &middot; <a href="/">View site</a></div></div>${body}`;
  return layout({ config, path, title, description: 'Tendrelark admin', body: wrapped, noindex: true });
}

const csrfField = (csrf) => html`<input type="hidden" name="csrf" value="${csrf}">`;
const dt = (iso) => (iso ? `${formatDate(iso)} ${iso.slice(11, 16)} UTC` : 'never');
const problemList = (problems) =>
  problems?.length
    ? html`<div class="flash error" role="alert"><p><strong>${problems.length === 1 ? 'One thing to fix:' : 'Things to fix:'}</strong></p><ul class="errors">${problems.map((p) => html`<li>${p}</li>`)}</ul></div>`
    : '';

export function adminDashboard({ config, csrf, flash: message, data }) {
  const { stats, runs, canary, sources, subs, issues, defaultWeek, mailMode, verified } = data;
  const last = runs[0];
  const tedWarning =
    stats.notices === 0
      ? 'No TED notices are stored. An empty database is not a successful import: check the latest run below.'
      : last && ['failed', 'empty'].includes(last.status)
        ? `The latest TED run ${last.status === 'empty' ? 'returned no notices' : 'failed'}. See the table below.`
        : '';
  const body = html`<section class="section"><div class="container admin-page">
    <h1>Admin</h1>
    ${message ? flash(message.kind, message.text) : ''}
    ${tedWarning ? flash('error', tedWarning) : ''}
    ${mailMode === 'console' ? flash('error', 'SMTP_URL is not set. Emails are logged, not delivered, and issues cannot be sent.') : ''}

    <h2>TED notices</h2>
    <dl class="stats">
      <div class="stat"><dt>Notices stored</dt><dd>${stats.notices}</dd></div>
      <div class="stat"><dt>Newest publication date</dt><dd>${stats.latest_publication ?? 'none'}</dd></div>
      ${stats.byCountry.map((c) => html`<div class="stat"><dt>${COUNTRY_NAMES[c.country] ?? c.country}</dt><dd>${c.n}</dd></div>`)}
    </dl>
    <form class="form" method="post" action="/admin/ted/ingest">${csrfField(csrf)}<div><button class="btn btn-small" type="submit">Run ingestion now</button></div></form>
    <div class="table-wrap"><table>
      <caption class="sr-only">Recent ingestion runs</caption>
      <thead><tr><th scope="col">Run</th><th scope="col">Started</th><th scope="col">Status</th><th scope="col">Window</th><th scope="col">Fetched</th><th scope="col">New</th><th scope="col">Changed</th><th scope="col">Failed</th><th scope="col">Fields</th></tr></thead>
      <tbody>${runs.length
        ? runs.map((r) => html`<tr><td>#${r.id}</td><td>${dt(r.started_at)}</td><td>${r.status}${r.error ? html`<br><span class="small muted">${r.error.slice(0, 220)}</span>` : ''}</td><td>${r.window_from} to ${r.window_to}</td><td>${r.fetched}</td><td>${r.inserted}</td><td>${r.updated}</td><td>${r.failed}</td><td>${r.fields_tier ?? ''}</td></tr>`)
        : html`<tr><td colspan="9">No runs yet.</td></tr>`}</tbody>
    </table></div>

    <h2>Persistence check</h2>
    <p class="muted">If a deploy ever resets "Database created" or "Starts", the database is not on persistent storage.</p>
    <dl class="stats">
      <div class="stat"><dt>Database created</dt><dd class="small">${dt(canary.dbCreatedAt)}</dd></div>
      <div class="stat"><dt>Starts recorded</dt><dd>${canary.bootCount}</dd></div>
      <div class="stat"><dt>Database file</dt><dd class="small">${config.databasePath}</dd></div>
    </dl>

    <h2>Sources</h2>
    <p class="muted">Countries with verified coverage, which are the only ones newsletter issues can use: <strong>${verified.length ? verified.map((c) => COUNTRY_NAMES[c]).join(', ') : 'none yet'}</strong>.</p>
    <form class="form" method="post" action="/admin/sources/verify">${csrfField(csrf)}<div><button class="btn btn-small" type="submit">Check all sources now</button></div></form>
    <div class="table-wrap"><table>
      <thead><tr><th scope="col">Source</th><th scope="col">Reachable</th><th scope="col">Last checked</th><th scope="col">Automated retrieval</th><th scope="col">Detail</th></tr></thead>
      <tbody>${sources.map((s) => html`<tr><td>${s.name}</td><td>${statusPill(s)}</td><td>${dt(s.last_checked_at)}</td><td>${retrievalPill(data.retrieval[s.slug].state)}</td><td class="small">${s.last_error ?? (s.last_http_status ? `HTTP ${s.last_http_status}, ${s.last_response_ms} ms` : '')}</td></tr>`)}</tbody>
    </table></div>

    <h2>Newsletter</h2>
    <dl class="stats">
      <div class="stat"><dt>Confirmed subscribers</dt><dd>${subs.confirmed}</dd></div>
      <div class="stat"><dt>Awaiting confirmation</dt><dd>${subs.pending}</dd></div>
      <div class="stat"><dt>Unsubscribed</dt><dd>${subs.unsubscribed}</dd></div>
    </dl>
    <p><a href="/admin/subscribers">See everyone who signed up &rarr;</a></p>
    <div class="btn-row"><a class="btn" href="/admin/issues/new">Write a new issue</a></div>
    <form class="form" method="post" action="/admin/issues/build">${csrfField(csrf)}
      <h3>Or start a draft from stored TED notices</h3>
      <div class="field"><label for="week">ISO week</label><input id="week" type="text" name="week" value="${defaultWeek}" pattern="\\d{4}-W\\d{2}" required></div>
      <div class="field"><label for="build-country">Country</label>
        <select id="build-country" name="country">${verified.length ? verified.map((c) => html`<option value="${c}">${COUNTRY_NAMES[c]}</option>`) : html`<option value="">No country has verified coverage yet</option>`}</select>
      </div>
      <div><button class="btn btn-small btn-secondary" type="submit">Build draft</button></div>
    </form>
    <div class="table-wrap"><table>
      <thead><tr><th scope="col">Issue</th><th scope="col">Date</th><th scope="col">Country</th><th scope="col">Status</th><th scope="col">Links</th><th scope="col">Emailed</th></tr></thead>
      <tbody>${issues.length
        ? issues.map((i) => html`<tr><td><a href="/admin/issues/${i.slug}">${i.title}</a></td><td>${formatDate(i.issue_date)}</td><td>${COUNTRY_NAMES[i.country]}</td>
            <td>${i.status}${i.status === 'published' && !verified.includes(i.country) ? html`<br><span class="small muted">hidden: coverage not verified</span>` : ''}</td><td>${i.link_count}</td><td>${i.sent_at ? dt(i.sent_at) : 'no'}</td></tr>`)
        : html`<tr><td colspan="6">No issues yet.</td></tr>`}</tbody>
    </table></div>
  </div></section>`;
  return adminShell({ config, path: '/admin', title: 'Admin', body });
}

function acceptedSources(sources, verified) {
  return html`<details class="faq"><summary>Which links are accepted?</summary>
    <p>Links must start with https:// and sit on an official source from the directory that serves the issue's country. Deep links to a specific notice are fine.</p>
    <ul>${['PRT', 'LUX', 'BEL'].map((c) => html`<li><strong>${COUNTRY_NAMES[c]}${verified.includes(c) ? '' : ' (coverage not verified yet)'}:</strong> ${sources
      .filter((s) => s.country === c || s.country === 'EU')
      .map((s) => [new URL(s.url).hostname, ...s.extraHosts].join(', '))
      .join('; ')}</li>`)}</ul></details>`;
}

/**
 * The issue editor. `issue` is null for a new issue. `values` are what to show in the fields: what
 * the editor just submitted after an error, or what is stored. A published issue is shown read only.
 */
export function adminIssueForm({ config, csrf, issue, values, problems, flash: message, mailMode, verified, sources }) {
  const published = issue?.status === 'published';
  const links = values.links ?? [];
  const rows = Math.min(MAX_LINKS, Math.max(links.length + 2, 4));
  const countryOptions = [...new Set([...verified, ...(values.country ? [values.country] : [])])].filter((c) => COUNTRY_NAMES[c]);
  const hidden = published && !verified.includes(issue.country);

  if (published) {
    const body = html`<section class="section"><div class="container narrow">
      <p><a href="/admin">&larr; Dashboard</a></p>
      <h1>${issue.title} <span class="tag">published</span></h1>
      ${message ? flash(message.kind, message.text) : ''}${problemList(problems)}
      ${hidden ? flash('error', `This issue is hidden from the public because coverage for ${COUNTRY_NAMES[issue.country]} is not verified right now.`) : ''}
      <p class="muted">${COUNTRY_NAMES[issue.country]} | ${formatDate(issue.issue_date)} | published ${dt(issue.published_at)}. Published issues are frozen. Unpublish to edit.</p>
      <div class="prose">${contentParagraphs(issue.content)}</div>
      <h2>Official sources</h2>
      <ol>${issue.links.map((l) => html`<li><a href="${l.url}" rel="noopener noreferrer" target="_blank">${l.label}</a><br><span class="muted small">${l.source_name}${l.detail ? ` | ${l.detail}` : ''}</span></li>`)}</ol>
      <div class="btn-row">
        ${hidden ? '' : html`<a class="btn btn-secondary" href="/newsletter/archive/${issue.slug}">View public page</a>`}
        <form class="inline-form" method="post" action="/admin/issues/${issue.slug}/unpublish">${csrfField(csrf)}<button class="btn btn-danger" type="submit">Unpublish</button></form>
      </div>
      <hr>
      <form method="post" action="/admin/issues/${issue.slug}/send">${csrfField(csrf)}
        <p>${issue.sent_at ? `Emailed on ${dt(issue.sent_at)}. Sending again only reaches people who have not received it.` : 'Not emailed yet.'}</p>
        ${mailMode === 'console' ? html`<p class="muted">Emailing is disabled until SMTP_URL is set.</p>` : html`<button class="btn" type="submit">Email to confirmed subscribers</button>`}
      </form>
    </div></section>`;
    return adminShell({ config, path: `/admin/issues/${issue.slug}`, title: issue.title, body });
  }

  const action = issue ? `/admin/issues/${issue.slug}/save` : '/admin/issues';
  const body = html`<section class="section"><div class="container narrow">
    <p><a href="/admin">&larr; Dashboard</a></p>
    <h1>${issue ? html`${issue.title} <span class="tag">draft</span>` : 'New newsletter issue'}</h1>
    <p class="muted">Drafts are private. Nothing appears on the public site until you publish.</p>
    ${message ? flash(message.kind, message.text) : ''}${problemList(problems)}
    ${verified.length ? '' : flash('error', 'No country has verified coverage yet, so a new issue cannot be created. Run "Check all sources now" on the dashboard.')}
    <form class="form" method="post" action="${action}" novalidate>
      ${csrfField(csrf)}
      <div class="field"><label for="title">Title</label><input id="title" type="text" name="title" value="${values.title ?? ''}" maxlength="140" required></div>
      <div class="field"><label for="issue_date">Issue date</label><input id="issue_date" type="date" name="issue_date" value="${values.issue_date ?? ''}" required></div>
      <div class="field"><label for="country">Covered country <span class="hint">(only countries with verified coverage)</span></label>
        <select id="country" name="country" required>
          <option value="">Choose a country</option>
          ${countryOptions.map((c) => html`<option value="${c}"${values.country === c ? ' selected' : ''}>${COUNTRY_NAMES[c]}${verified.includes(c) ? '' : ' (coverage not verified)'}</option>`)}
        </select>
      </div>
      <div class="field"><label for="content">Content <span class="hint">(plain text, a blank line starts a new paragraph)</span></label><textarea id="content" name="content" maxlength="8000">${values.content ?? ''}</textarea></div>

      <fieldset class="field">
        <legend>Official source links <span class="hint">(at least one is needed to publish)</span></legend>
        ${acceptedSources(sources, verified)}
        ${Array.from({ length: rows }, (_, i) => {
          const l = links[i] ?? {};
          const n = i + 1;
          return html`<div class="item-edit link-row">
            <div class="field wide"><label for="link_url_${n}">Link ${n} address</label><input id="link_url_${n}" type="text" inputmode="url" name="link_url_${n}" value="${l.url ?? ''}" placeholder="https://"></div>
            <div class="field"><label for="link_label_${n}">Label <span class="hint">(optional, shown as the link text)</span></label><input id="link_label_${n}" type="text" name="link_label_${n}" value="${l.label ?? ''}" maxlength="200"></div>
            <div class="field"><label for="link_detail_${n}">Note <span class="hint">(optional, for example buyer and deadline)</span></label><input id="link_detail_${n}" type="text" name="link_detail_${n}" value="${l.detail ?? ''}" maxlength="300"></div>
          </div>`;
        })}
        <p class="muted small">Need more rows? Save, and an empty row is added each time (up to ${MAX_LINKS}).</p>
      </fieldset>

      <div class="btn-row">
        <button class="btn" type="submit"${verified.length ? '' : ' disabled'}>${issue ? 'Save draft' : 'Create draft'}</button>
        ${issue ? html`<button class="btn btn-secondary" type="submit" formaction="/admin/issues/${issue.slug}/publish">Save and publish</button>` : ''}
      </div>
      ${issue ? html`<p class="muted small">Publishing needs a country with verified coverage, content, and at least one official source link from the directory.</p>` : ''}
    </form>
  </div></section>`;
  return adminShell({ config, path: issue ? `/admin/issues/${issue.slug}` : '/admin/issues/new', title: issue ? issue.title : 'New issue', body });
}

export function adminSubscribers({ config, subscribers, counts }) {
  const body = html`<section class="section"><div class="container admin-page">
    <h1>Newsletter subscribers</h1>
    <p class="muted">One row per email address. Signing up again never adds a row, it only raises the submission count. Anyone who has not confirmed is not a subscriber yet.</p>
    <dl class="stats">
      <div class="stat"><dt>Confirmed</dt><dd>${counts.confirmed}</dd></div>
      <div class="stat"><dt>Awaiting confirmation</dt><dd>${counts.pending}</dd></div>
      <div class="stat"><dt>Unsubscribed</dt><dd>${counts.unsubscribed}</dd></div>
    </dl>
    <p><a class="btn btn-secondary btn-small" href="/admin/subscribers.csv">Download CSV</a></p>
    <div class="table-wrap"><table>
      <thead><tr><th scope="col">Email</th><th scope="col">Status</th><th scope="col">Role</th><th scope="col">Signed up from</th><th scope="col">Submissions</th><th scope="col">First signed up</th><th scope="col">Confirmed</th></tr></thead>
      <tbody>${subscribers.length
        ? subscribers.map((s) => html`<tr><td>${s.email}</td><td>${s.status}</td><td>${s.role ?? ''}</td><td>${s.signup_source ?? ''}</td><td>${s.submit_count}</td><td>${dt(s.created_at)}</td><td>${s.confirmed_at ? dt(s.confirmed_at) : ''}</td></tr>`)
        : html`<tr><td colspan="7">Nobody has signed up yet.</td></tr>`}</tbody>
    </table></div>
  </div></section>`;
  return adminShell({ config, path: '/admin/subscribers', title: 'Subscribers', body });
}
