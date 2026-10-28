import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { ingestTed } from '../src/ted/ingest.js';
import { PUBLIC_DIR } from '../src/web/assets.js';
import { startApp, startFakeTed, tedNotice, verifySource } from './helpers.js';

const TED_LINK = 'https://ted.europa.eu/en/notice/-/detail/123456-2026';
const issueForm = (app, over = {}) => ({
  csrf: app.csrf(),
  title: 'Tender watch: Portugal',
  issue_date: '2026-11-02',
  country: 'PRT',
  content: 'Two tenders worth a look.\n\nBoth close in December.',
  link_url_1: TED_LINK,
  link_label_1: 'IT services framework',
  link_detail_1: 'Câmara de Lisboa',
  ...over,
});
const location = (r) => r.headers.get('location');
const hrefs = (html) => [...html.matchAll(/class="source-link" href="([^"]+)"/g)].map((m) => m[1].replaceAll('&amp;', '&'));

// ---- public pages and headers ----------------------------------------------------------------

test('public pages render and carry strict security headers and no cookies', async (t) => {
  const app = await startApp();
  t.after(() => app.close());
  for (const p of ['/', '/tender-intelligence', '/ai-automations', '/tenders', '/sources', '/newsletter', '/newsletter/archive', '/contact', '/privacy']) {
    const r = await app.get(p);
    assert.equal(r.status, 200, p);
    assert.match(r.text, /<title>[^<]*Tendrelark/, p);
    assert.match(r.text, /<link rel="canonical" href="https:\/\/www\.tendrelark\.eu/, p);
    assert.match(r.headers.get('content-security-policy'), /script-src 'none'/, p);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(r.headers.get('x-frame-options'), 'DENY');
    assert.equal(r.headers.get('set-cookie'), null, `${p} must not set cookies`);
    assert.doesNotMatch(r.text, /<script(?![^>]*ld\+json)/, `${p} has no scripts`);
    assert.doesNotMatch(r.text, /style="/, `${p} has no inline styles`);
  }
  assert.equal((await app.get('/nope')).status, 404);
  assert.equal(app.config.production, false);
  assert.match((await app.get('/robots.txt')).text, /Disallow: \/admin/);
});

test('every asset the pages reference exists', async (t) => {
  const app = await startApp();
  t.after(() => app.close());
  const seen = new Set();
  for (const p of ['/', '/sources', '/newsletter/archive']) {
    const { text } = await app.get(p);
    for (const m of text.matchAll(/(?:href|src|content)="((?:\/(?:css|img)\/|https:\/\/www\.tendrelark\.eu\/img\/)[^"]+)"/g)) seen.add(m[1].replace('https://www.tendrelark.eu', ''));
  }
  assert.ok(seen.has('/css/site.css') && seen.has('/img/favicon.svg') && seen.has('/img/og-image.png'), [...seen].join(', '));
  for (const asset of seen) {
    const r = await app.get(asset);
    assert.equal(r.status, 200, asset);
  }
});

test('the logo photo sits in the lower left, not in the hero, and uses the real photo when it exists', async (t) => {
  const app = await startApp();
  t.after(() => app.close());
  let r = await app.get('/');
  const hero = r.text.slice(r.text.indexOf('class="hero"'), r.text.indexOf('id="who"'));
  assert.ok(!hero.includes('logo-figure'), 'nothing in the hero');
  assert.ok(r.text.indexOf('logo-figure') > r.text.indexOf('id="newsletter"'), 'below the fold, beside the signup');
  assert.match(r.text, /logo-figure fallback/); // stand in mark while the photo file is missing

  const file = path.join(PUBLIC_DIR, 'img', 'logo-photo.jpg');
  assert.ok(!fs.existsSync(file), 'the photo is supplied by the owner, not committed');
  fs.writeFileSync(file, 'x');
  try {
    r = await app.get('/');
    assert.match(r.text, /<img src="\/img\/logo-photo\.jpg" alt="A paper bird/);
    assert.doesNotMatch(r.text, /logo-figure fallback/);
  } finally {
    fs.rmSync(file);
  }
});

test('page content is escaped, including notice titles that contain markup', async (t) => {
  const ted = await startFakeTed([tedNotice(777, { country: 'PRT', date: new Date().toISOString().slice(0, 10), title: '<script>alert(1)</script> & "quotes"', buyer: '<img src=x onerror=alert(1)>' })]);
  const app = await startApp({ TED_API_URL: ted.url });
  t.after(async () => { await app.close(); await ted.close(); });
  await ingestTed(app.db, app.config);
  const r = await app.get('/tenders');
  assert.match(r.text, /&lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; &quot;quotes&quot;/);
  assert.doesNotMatch(r.text, /<script>alert/);
  assert.doesNotMatch(r.text, /<img src=x/);
  assert.match(r.text, /href="https:\/\/ted\.europa\.eu\/en\/notice\/-\/detail\/777-2026"/);
});

test('tender search uses bound parameters and ignores hostile filters', async (t) => {
  const ted = await startFakeTed([tedNotice(1, { country: 'PRT', date: new Date().toISOString().slice(0, 10) })]);
  const app = await startApp({ TED_API_URL: ted.url });
  t.after(async () => { await app.close(); await ted.close(); });
  await ingestTed(app.db, app.config);
  for (const q of ["?q=' OR 1=1 --", '?q=%25', '?country=FRA', '?sector[]=x', '?page=-5', '?page=abc&q=%5C']) {
    assert.equal((await app.get(`/tenders${q}`)).status, 200, q);
  }
  assert.match((await app.get("/tenders?q=' OR 1=1 --")).text, /0 notices found/);
  assert.match((await app.get('/tenders?country=PRT')).text, /1 notice found/);
});

// ---- the sources page --------------------------------------------------------------------------

function card(html, slug) {
  const m = new RegExp(`<article class="card source" id="${slug}">([\\s\\S]*?)</article>`).exec(html);
  assert.ok(m, `card for ${slug}`);
  return m[1];
}

test('the sources page states retrieval status per source and implies nothing is imported', async (t) => {
  const app = await startApp();
  t.after(() => app.close());
  const { text } = await app.get('/sources');

  assert.match(text, /Where our tender information comes from/);
  assert.match(card(text, 'eprocurement-be'), /href="https:\/\/www\.publicprocurement\.be\/"/);
  assert.doesNotMatch(card(text, 'eprocurement-be'), /href="https:\/\/enot\.publicprocurement\.be/);
  assert.match(card(text, 'eprocurement-be'), /Retrieval unverified/);
  assert.match(card(text, 'eprocurement-be'), /Not imported/);
  assert.match(card(text, 'eprocurement-be'), /whether access is open, needs a key or needs a formal agreement is unverified/);
  assert.match(card(text, 'pmp-lu'), /Retrieval unavailable/);
  assert.match(card(text, 'pmp-lu'), /only part of the notices/);
  assert.match(card(text, 'pmp-lu'), /RSS still exists.*unverified/);
  assert.match(card(text, 'base-pt'), /Retrieval unverified/);
  assert.match(card(text, 'base-pt'), /8 March 2026/);
  assert.match(card(text, 'base-pt'), /href="https:\/\/dados\.gov\.pt\/en\/datasets\//);
  assert.match(card(text, 'dre-pt'), /Retrieval unverified/);
  assert.match(card(text, 'ted'), /no run has stored notices yet, so we do not claim it is working/);
  assert.match(card(text, 'ted'), /Retrieval unverified/);
  for (const slug of ['ted', 'base-pt', 'dre-pt', 'pmp-lu', 'eprocurement-be']) {
    assert.doesNotMatch(card(text, slug), /Retrieval verified/, `${slug} must not claim verified retrieval`);
    assert.match(card(text, slug), /Not checked yet/, `${slug} starts unchecked`);
  }
  assert.match(text, /Research dated<\/dt><dd>27 October 2026/);
});

test('TED turns to verified retrieval only after an import has stored notices', async (t) => {
  const ted = await startFakeTed([tedNotice(5, { country: 'BEL', date: new Date().toISOString().slice(0, 10) })]);
  const app = await startApp({ TED_API_URL: ted.url });
  t.after(async () => { await app.close(); await ted.close(); });
  await ingestTed(app.db, app.config);
  verifySource(app.db, 'ted');
  const { text } = await app.get('/sources');
  assert.match(card(text, 'ted'), /Retrieval verified/);
  assert.match(card(text, 'ted'), /has stored 1 notice/);
  assert.match(card(text, 'ted'), /Verified reachable/);
  assert.doesNotMatch(card(text, 'pmp-lu'), /Retrieval verified/);
  assert.doesNotMatch(card(text, 'eprocurement-be'), /Retrieval verified/);
});

// ---- newsletter signup ---------------------------------------------------------------------------

test('a visitor signs up and confirms with no account, no cookie and no profile', async (t) => {
  const app = await startApp();
  t.after(() => app.close());
  const page = await app.get('/newsletter');
  assert.match(page.text, /<form class="form" method="post" action="\/newsletter\/subscribe"/);
  assert.match(page.text, /name="email"/);

  const r = await app.post('/newsletter/subscribe', { t: app.token(), email: 'Visitor@Example.com', role: 'it_consultancy', consent: 'yes', source: 'newsletter_page', website: '' });
  assert.equal(r.status, 303);
  assert.equal(location(r), '/newsletter?status=check');
  assert.equal(r.headers.get('set-cookie'), null);
  assert.match((await app.get('/newsletter?status=check')).text, /We have sent a confirmation email/);

  const sub = app.db.prepare('SELECT * FROM subscribers').get();
  assert.deepEqual([sub.email, sub.status, sub.signup_source], ['visitor@example.com', 'pending', 'newsletter_page']);
  assert.equal(app.mailer.outbox.length, 1);

  // Opening the link (as a mail scanner would) confirms nothing. Only the button does.
  const link = /https:\/\/www\.tendrelark\.eu(\/newsletter\/confirm\?token=[^\s]+)/.exec(app.mailer.outbox[0].text)[1];
  const open = await app.get(link);
  assert.equal(open.status, 200);
  assert.equal(app.db.prepare('SELECT status FROM subscribers').get().status, 'pending');
  const token = decodeURIComponent(link.split('token=')[1]);
  const done = await app.post('/newsletter/confirm', { token });
  assert.match(done.text, /You are subscribed/);
  assert.equal(app.db.prepare('SELECT status FROM subscribers').get().status, 'confirmed');
});

test('repeated submissions from the form leave exactly one subscriber', async (t) => {
  const app = await startApp();
  t.after(() => app.close());
  for (const email of ['dup@example.com', 'DUP@example.com', ' dup@example.com ']) {
    const r = await app.post('/newsletter/subscribe', { t: app.token(), email, consent: 'yes' });
    assert.equal(location(r), '/newsletter?status=check'); // the visitor always sees the same answer
  }
  assert.equal(app.db.prepare('SELECT COUNT(*) n FROM subscribers').get().n, 1);
  assert.equal(app.db.prepare('SELECT submit_count FROM subscribers').get().submit_count, 3);
  assert.equal(app.mailer.outbox.length, 1);
  const list = await app.get('/admin/subscribers', { admin: true });
  assert.equal((list.text.match(/dup@example\.com/g) ?? []).length, 1);
  assert.match(list.text, /<td>3<\/td>/);
});

test('signup rejects bots, missing consent, bad emails and rapid fire', async (t) => {
  const app = await startApp();
  t.after(() => app.close());
  const cases = [
    [{ t: app.token(), email: 'bot@example.com', consent: 'yes', website: 'http://spam.example' }, 'check', 0], // trap filled: looks fine, stores nothing
    [{ t: app.token(), email: 'a@example.com' }, 'consent', 0],
    [{ t: app.token(), email: 'not-an-email', consent: 'yes' }, 'invalid', 0],
    [{ t: 'garbage', email: 'a@example.com', consent: 'yes' }, 'slow', 0],
    [{ email: 'a@example.com', consent: 'yes' }, 'slow', 0],
    [{ t: (await import('../src/lib/security.js')).formToken(app.config.appSecret), email: 'a@example.com', consent: 'yes' }, 'slow', 0], // submitted instantly
  ];
  for (const [form, status, rows] of cases) {
    assert.equal(location(await app.post('/newsletter/subscribe', form)), `/newsletter?status=${status}`);
    assert.equal(app.db.prepare('SELECT COUNT(*) n FROM subscribers').get().n, rows);
  }
  let limited = false;
  for (let i = 0; i < 12; i += 1) {
    if (location(await app.post('/newsletter/subscribe', { t: app.token(), email: `r${i}@example.com`, consent: 'yes' })).endsWith('limit')) limited = true;
  }
  assert.ok(limited, 'the rate limit kicks in');
  assert.equal((await app.get('/newsletter?status=__proto__')).status, 200); // odd status values are harmless
});

test('unsubscribing works from the page and from the one click header', async (t) => {
  const app = await startApp();
  t.after(() => app.close());
  await app.post('/newsletter/subscribe', { t: app.token(), email: 'bye@example.com', consent: 'yes' });
  const id = app.db.prepare('SELECT id FROM subscribers').get().id;
  const { unsubscribeToken } = await import('../src/lib/security.js');
  const tok = unsubscribeToken(app.config.appSecret, id);
  assert.equal((await app.get(`/newsletter/unsubscribe?token=${tok}`)).status, 200);
  assert.equal(app.db.prepare('SELECT status FROM subscribers').get().status, 'pending'); // GET changes nothing
  const oneClick = await app.post(`/newsletter/unsubscribe?token=${tok}`, { 'List-Unsubscribe': 'One-Click' });
  assert.equal(oneClick.status, 200);
  assert.equal(app.db.prepare('SELECT status FROM subscribers').get().status, 'unsubscribed');
  assert.equal((await app.post('/newsletter/unsubscribe', { token: `${id}.nope-nope-nope-nope-nope` })).status, 400);
});

// ---- the admin area ----------------------------------------------------------------------------

test('the admin area needs the password, and every change needs the form token', async (t) => {
  const app = await startApp();
  t.after(() => app.close());
  assert.equal((await app.get('/admin')).status, 401);
  assert.equal((await app.get('/admin', { headers: { authorization: `Basic ${Buffer.from('editor:wrong').toString('base64')}` } })).status, 401);
  assert.equal((await app.get('/admin/issues/new')).status, 401);
  assert.equal((await app.get('/admin/subscribers.csv')).status, 401);
  assert.equal((await app.post('/admin/issues', issueForm(app))).status, 401);
  assert.equal((await app.get('/admin', { admin: true })).status, 200);
  assert.equal((await app.post('/admin/issues', { ...issueForm(app), csrf: 'forged' }, { admin: true })).status, 403);
  assert.equal((await app.post('/admin/issues', issueForm(app), { admin: true, headers: { 'sec-fetch-site': 'cross-site' } })).status, 403);
  assert.equal((await app.get('/admin', { admin: true })).headers.get('cache-control'), 'no-store');

  const off = await startApp({ ADMIN_PASSWORD: '' });
  assert.equal((await off.get('/admin', { admin: true })).status, 404);
  await off.close();
});

test('an admin cannot create an issue until a country has verified coverage', async (t) => {
  const app = await startApp();
  t.after(() => app.close());
  const form = await app.get('/admin/issues/new', { admin: true });
  assert.match(form.text, /No country has verified coverage yet/);
  const r = await app.post('/admin/issues', issueForm(app), { admin: true });
  assert.equal(r.status, 422);
  assert.match(r.text, /Coverage for Portugal is not verified yet/);
  assert.equal(app.db.prepare('SELECT COUNT(*) n FROM newsletter_issues').get().n, 0);

  verifySource(app.db, 'pmp-lu'); // only Luxembourg is verified now
  const fresh = await app.get('/admin/issues/new', { admin: true });
  assert.match(fresh.text, /<option value="LUX">Luxembourg<\/option>/);
  assert.doesNotMatch(fresh.text, /<option value="PRT"/);
  assert.doesNotMatch(fresh.text, /<option value="BEL"/);
  assert.equal((await app.post('/admin/issues', issueForm(app), { admin: true })).status, 422); // PRT still refused
});

test('drafts stay out of every public page until published, then only the recorded links show', async (t) => {
  const app = await startApp();
  t.after(() => app.close());
  verifySource(app.db, 'ted');

  // Create the draft through the form.
  const created = await app.post('/admin/issues', issueForm(app, { link_url_2: 'https://www.base.gov.pt/Base4/pt/detalhe/?type=anuncios&id=42', link_label_2: 'BASE record' }), { admin: true });
  assert.equal(created.status, 303);
  assert.equal(location(created), '/admin/issues/2026-11-02-prt?done=created');
  const slug = '2026-11-02-prt';

  // Private everywhere.
  assert.equal((await app.get(`/newsletter/archive/${slug}`)).status, 404);
  assert.doesNotMatch((await app.get('/newsletter/archive')).text, /Tender watch: Portugal/);
  assert.match((await app.get('/newsletter/archive')).text, /No issues have been published yet/);
  assert.doesNotMatch((await app.get('/sitemap.xml')).text, new RegExp(slug));
  assert.doesNotMatch((await app.get('/newsletter/archive.xml')).text, /Tender watch/);
  assert.doesNotMatch((await app.get('/newsletter')).text, /Tender watch: Portugal/);
  assert.match((await app.get(`/admin/issues/${slug}`, { admin: true })).text, /draft/);

  // Publish.
  const pub = await app.post(`/admin/issues/${slug}/publish`, issueForm(app, { link_url_2: 'https://www.base.gov.pt/Base4/pt/detalhe/?type=anuncios&id=42', link_label_2: 'BASE record' }), { admin: true });
  assert.equal(pub.status, 303);
  assert.equal(location(pub), `/admin/issues/${slug}?done=published`);

  // Public now.
  const archive = await app.get('/newsletter/archive');
  assert.match(archive.text, new RegExp(`<a href="/newsletter/archive/${slug}">Tender watch: Portugal</a>`));
  assert.match(archive.text, /2 official source links/);
  assert.match(archive.text, /<span>2 November 2026<\/span><span>Portugal<\/span>/);
  assert.match((await app.get('/sitemap.xml')).text, new RegExp(slug));
  assert.match((await app.get('/newsletter/archive.xml')).text, /Tender watch: Portugal/);

  // The detail page shows exactly the links recorded for the issue, in order, and nothing else external.
  const detail = await app.get(`/newsletter/archive/${slug}`);
  assert.equal(detail.status, 200);
  const recorded = app.db.prepare('SELECT url FROM newsletter_links l JOIN newsletter_issues i ON i.id = l.issue_id WHERE i.slug = ? ORDER BY position').all(slug).map((r) => r.url);
  assert.deepEqual(hrefs(detail.text), recorded);
  assert.deepEqual(recorded, [TED_LINK, 'https://www.base.gov.pt/Base4/pt/detalhe/?type=anuncios&id=42']);
  const main = detail.text.slice(detail.text.indexOf('<main'), detail.text.indexOf('</main>'));
  const external = [...main.matchAll(/href="(https?:\/\/[^"]+)"/g)].map((m) => m[1].replaceAll('&amp;', '&'));
  assert.deepEqual(external, recorded);
  assert.match(detail.text, /Two tenders worth a look\./);
  assert.match(detail.text, /Both close in December\./);
  assert.match(detail.text, /Portugal \| 2 November 2026/);
  assert.match(detail.text, /Source: TED, Tenders Electronic Daily/);

  // Unpublish takes it straight back out.
  await app.post(`/admin/issues/${slug}/unpublish`, { csrf: app.csrf() }, { admin: true });
  assert.equal((await app.get(`/newsletter/archive/${slug}`)).status, 404);
  assert.match((await app.get('/newsletter/archive')).text, /No issues have been published yet/);
});

test('publishing is refused without an official source link, and the issue stays private', async (t) => {
  const app = await startApp();
  t.after(() => app.close());
  verifySource(app.db, 'ted');
  await app.post('/admin/issues', issueForm(app, { link_url_1: '', link_label_1: '', link_detail_1: '' }), { admin: true });
  const slug = '2026-11-02-prt';
  const r = await app.post(`/admin/issues/${slug}/publish`, issueForm(app, { link_url_1: '', link_label_1: '' }), { admin: true });
  assert.equal(r.status, 422);
  assert.match(r.text, /Not published/);
  assert.match(r.text, /Add at least one official source link from the directory/);
  assert.equal(app.db.prepare('SELECT status FROM newsletter_issues WHERE slug = ?').get(slug).status, 'draft');
  assert.equal((await app.get(`/newsletter/archive/${slug}`)).status, 404);

  // An off directory link is refused with a clear reason, and the typed values stay in the form.
  const bad = await app.post(`/admin/issues/${slug}/publish`, issueForm(app, { link_url_1: 'https://evil.example/phish', link_label_1: 'Phish' }), { admin: true });
  assert.equal(bad.status, 422);
  assert.match(bad.text, /Link 1 is not on an official Portugal source from our directory/);
  assert.match(bad.text, /value="https:\/\/evil\.example\/phish"/);
  assert.equal(app.db.prepare('SELECT COUNT(*) n FROM newsletter_links').get().n, 0);
});

test('the archive lists issues by date and country, shows an empty state, and hides unverified countries', async (t) => {
  const app = await startApp();
  t.after(() => app.close());
  verifySource(app.db, 'ted');
  const make = async (over) => {
    const r = await app.post('/admin/issues', issueForm(app, over), { admin: true });
    const slug = /\/admin\/issues\/([^?]+)/.exec(location(r))[1];
    await app.post(`/admin/issues/${slug}/publish`, issueForm(app, over), { admin: true });
    return slug;
  };
  assert.match((await app.get('/newsletter/archive?country=LUX')).text, /No issues have been published for Luxembourg yet/);
  const a = await make({ title: 'Older Portuguese issue', issue_date: '2026-10-12' });
  const b = await make({ title: 'Belgian issue', issue_date: '2026-10-26', country: 'BEL', link_url_1: 'https://www.publicprocurement.be/publication-workspaces/1' });
  const c = await make({ title: 'Newer Portuguese issue', issue_date: '2026-10-19' });

  const all = (await app.get('/newsletter/archive')).text;
  const order = ['Belgian issue', 'Newer Portuguese issue', 'Older Portuguese issue'].map((t) => all.indexOf(t));
  assert.ok(order.every((i) => i > 0) && order[0] < order[1] && order[1] < order[2], 'newest first');
  assert.match(all, /Filter by country/);
  const pt = (await app.get('/newsletter/archive?country=PRT')).text;
  assert.match(pt, /Older Portuguese issue/);
  assert.doesNotMatch(pt, /Belgian issue/);
  assert.match((await app.get('/newsletter/archive?country=XX')).text, /Belgian issue/); // unknown filter falls back to all
  for (const slug of [a, b, c]) assert.equal((await app.get(`/newsletter/archive/${slug}`)).status, 200);

  verifySource(app.db, 'ted', 'failed'); // coverage lapses
  const hidden = await app.get('/newsletter/archive');
  assert.match(hidden.text, /No issues have been published yet/);
  assert.doesNotMatch(hidden.text, /Filter by country/);
  assert.equal((await app.get(`/newsletter/archive/${a}`)).status, 404);
  assert.match((await app.get('/admin', { admin: true })).text, /hidden: coverage not verified/);
});

test('issue content and labels are escaped on the public page', async (t) => {
  const app = await startApp();
  t.after(() => app.close());
  verifySource(app.db, 'ted');
  const over = { title: '<script>alert(1)</script>', content: '<img src=x onerror=alert(1)>\n\nLine one\nLine two', link_label_1: '"><script>alert(2)</script>', link_detail_1: '<b>bold</b>' };
  await app.post('/admin/issues', issueForm(app, over), { admin: true });
  await app.post('/admin/issues/2026-11-02-prt/publish', issueForm(app, over), { admin: true });
  const { text } = await app.get('/newsletter/archive/2026-11-02-prt');
  assert.doesNotMatch(text, /<script>alert/);
  assert.doesNotMatch(text, /<img src=x/);
  assert.doesNotMatch(text, /<b>bold/);
  assert.match(text, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(text, /Line one<br>Line two/);
  assert.deepEqual(hrefs(text), [TED_LINK]);
});

test('a published issue cannot be edited through the form', async (t) => {
  const app = await startApp();
  t.after(() => app.close());
  verifySource(app.db, 'ted');
  await app.post('/admin/issues', issueForm(app), { admin: true });
  await app.post('/admin/issues/2026-11-02-prt/publish', issueForm(app), { admin: true });
  const r = await app.post('/admin/issues/2026-11-02-prt/save', issueForm(app, { title: 'Sneaky change', link_url_1: 'https://www.base.gov.pt/x' }), { admin: true });
  assert.equal(r.status, 422);
  assert.equal(app.db.prepare("SELECT title FROM newsletter_issues WHERE slug = '2026-11-02-prt'").get().title, 'Tender watch: Portugal');
  assert.equal(app.db.prepare('SELECT url FROM newsletter_links').get().url, TED_LINK);
  const page = await app.get('/admin/issues/2026-11-02-prt', { admin: true });
  assert.match(page.text, /Published issues are frozen/);
  assert.doesNotMatch(page.text, /name="title"/);
});

test('admin can build a draft from stored TED notices and it stays private', async (t) => {
  const today = new Date().toISOString().slice(0, 10);
  const ted = await startFakeTed([tedNotice(31, { country: 'PRT', date: today, cpv: ['72000000'], deadline: '2099-01-01' })]);
  const app = await startApp({ TED_API_URL: ted.url });
  t.after(async () => { await app.close(); await ted.close(); });
  await ingestTed(app.db, app.config);
  verifySource(app.db, 'ted');
  const { isoWeek, weekSlug } = await import('../src/lib/dates.js');
  const week = weekSlug(isoWeek(today));
  const r = await app.post('/admin/issues/build', { csrf: app.csrf(), week, country: 'PRT' }, { admin: true });
  assert.equal(r.status, 303);
  const slug = /\/admin\/issues\/([^?]+)\?done=built/.exec(location(r))[1];
  assert.equal((await app.get(`/newsletter/archive/${slug}`)).status, 404);
  assert.equal(app.db.prepare('SELECT COUNT(*) n FROM newsletter_links').get().n, 1);
  const again = await app.post('/admin/issues/build', { csrf: app.csrf(), week, country: 'PRT' }, { admin: true });
  assert.match(decodeURIComponent(location(again)), /already exists/);
});

test('the subscriber export neutralises spreadsheet formulas', async (t) => {
  const app = await startApp();
  t.after(() => app.close());
  await app.post('/newsletter/subscribe', { t: app.token(), email: '=cmd|x@example.com', consent: 'yes' });
  await app.post('/newsletter/subscribe', { t: app.token(), email: 'fine@example.com', consent: 'yes' });
  const csv = await app.get('/admin/subscribers.csv', { admin: true });
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  assert.match(csv.text, /^email,status,role,signed_up_from,submissions/);
  assert.match(csv.text, /"'=cmd\|x@example\.com"/);
  assert.match(csv.text, /"fine@example\.com","pending"/);
});

test('contact form stores an enquiry and emails the team, and stops bots', async (t) => {
  const app = await startApp();
  t.after(() => app.close());
  const ok = await app.post('/contact', { t: app.token(), name: 'Rui', email: 'rui@example.com', company: 'Acme', interest: 'ai_automation', message: 'We bid on IT tenders in Lisbon.', consent: 'yes' });
  assert.equal(location(ok), '/contact?status=sent');
  assert.equal(app.db.prepare('SELECT COUNT(*) n FROM enquiries').get().n, 1);
  assert.equal(app.db.prepare('SELECT interest FROM enquiries').get().interest, 'ai_automation');
  assert.equal(app.mailer.outbox[0].to, 'support@tendrelark.eu');
  assert.equal(location(await app.post('/contact', { t: app.token(), name: 'Bot', email: 'b@example.com', message: 'spam spam', consent: 'yes', website: 'x' })), '/contact?status=sent');
  assert.equal(app.db.prepare('SELECT COUNT(*) n FROM enquiries').get().n, 1);
  assert.equal(location(await app.post('/contact', { t: app.token(), name: 'X', email: 'bad', message: 'hello there', consent: 'yes' })), '/contact?status=invalid');
  assert.equal(location(await app.post('/contact', { t: app.token(), name: 'X', email: 'x@example.com', message: 'hello there' })), '/contact?status=invalid');
});

test('healthz reports what an operator needs to confirm TED notices are being stored', async (t) => {
  const today = new Date().toISOString().slice(0, 10);
  const ted = await startFakeTed([tedNotice(41, { country: 'LUX', date: today })]);
  const app = await startApp({ TED_API_URL: ted.url });
  t.after(async () => { await app.close(); await ted.close(); });
  let h = JSON.parse((await app.get('/healthz')).text);
  assert.equal(h.status, 'ok');
  assert.equal(h.ted.noticesStored, 0);
  assert.equal(h.ted.lastSuccessAt, null);
  assert.equal(h.ted.dailyCycle, null);
  await ingestTed(app.db, app.config);
  h = JSON.parse((await app.get('/healthz')).text);
  assert.equal(h.ted.noticesStored, 1);
  assert.deepEqual(h.ted.byCountry, { LUX: 1 });
  assert.equal(h.ted.lastRun.status, 'ok');
  assert.ok(h.ted.lastSuccessAt);
  assert.equal(h.sources.length, 5);
  assert.doesNotMatch(JSON.stringify(h), /subscribers|@/); // no personal data
  assert.doesNotMatch(JSON.stringify(h), /tendrelark-test|\.db/); // no file paths
});
