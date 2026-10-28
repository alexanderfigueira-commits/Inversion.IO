import assert from 'node:assert/strict';
import { test } from 'node:test';
import { upsertNotice } from '../src/ted/ingest.js';
import { normalizeNotice } from '../src/ted/normalize.js';
import {
  IssueError, buildDraftIssue, createDraft, getIssue, getPublicIssue, listAllIssues, listPublicIssues, publishIssue, unpublishIssue, updateDraft, validateIssueInput,
} from '../src/newsletter/issues.js';
import { renderIssueEmail, sendIssue } from '../src/newsletter/send.js';
import { confirmSignup, listSubscribers, requestSignup, subscriberCounts, unsubscribe } from '../src/newsletter/subscribers.js';
import { unsubscribeToken } from '../src/lib/security.js';
import { createMailer } from '../src/lib/mailer.js';
import { freshDb, memoryMailer, tedNotice, testConfig, verifySource } from './helpers.js';

const TED_LINK = 'https://ted.europa.eu/en/notice/-/detail/123456-2026';

function setup() {
  const config = testConfig();
  const db = freshDb(config);
  return { config, db, mailer: memoryMailer(config, db) };
}

const issueInput = (over = {}) => ({
  title: 'Tender watch: Portugal',
  issue_date: '2026-11-02',
  country: 'PRT',
  content: 'Two tenders worth a look this week.\n\nBoth are open until December.',
  links: [{ label: 'IT services framework', url: TED_LINK, detail: 'Câmara de Lisboa | Deadline 1 December 2026' }],
  ...over,
});

const store = (db, raw, country) => upsertNotice(db, normalizeNotice(raw, { queryCountry: country }), null);

// ---- signup -------------------------------------------------------------------------------

test('signup stores one pending subscriber and sends a confirmation, nothing more', async () => {
  const { db, config, mailer } = setup();
  const tablesBefore = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((t) => t.name);

  const r = await requestSignup(db, mailer, config, { email: '  Ana.Silva@Example.COM ', role: 'bid_consultant', source: 'home' });
  assert.equal(r.ok, true);
  const rows = db.prepare('SELECT * FROM subscribers').all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].email, 'ana.silva@example.com');
  assert.equal(rows[0].status, 'pending');
  assert.equal(rows[0].role, 'bid_consultant');
  assert.equal(rows[0].signup_source, 'home');
  assert.equal(rows[0].submit_count, 1);
  assert.ok(rows[0].consented_at && rows[0].consent_text_version);

  assert.equal(mailer.outbox.length, 1);
  assert.match(mailer.outbox[0].text, /\/newsletter\/confirm\?token=/);

  // No account, profile or customer record exists or was created.
  assert.ok(!tablesBefore.some((t) => /user|account|customer|profile|waitlist/i.test(t)), tablesBefore.join(', '));
  assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().length, tablesBefore.length);
});

test('submitting the same address again never adds a row', async () => {
  const { db, config, mailer } = setup();
  const day = Date.parse('2026-10-28T10:00:00Z');
  await requestSignup(db, mailer, config, { email: 'ana@example.com' }, day);
  await requestSignup(db, mailer, config, { email: 'ANA@example.com' }, day + 1000); // case differs
  await requestSignup(db, mailer, config, { email: ' ana@example.com ' }, day + 2000); // spaces differ
  assert.equal(db.prepare('SELECT COUNT(*) n FROM subscribers').get().n, 1);
  const row = db.prepare('SELECT * FROM subscribers').get();
  assert.equal(row.submit_count, 3);
  assert.equal(mailer.outbox.length, 1); // the cooldown stops confirmation spam
  assert.deepEqual(subscriberCounts(db), { pending: 1, confirmed: 0, unsubscribed: 0 });

  // After the cooldown a repeat sends a fresh confirmation, still on the same row.
  await requestSignup(db, mailer, config, { email: 'ana@example.com' }, day + 10 * 60_000);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM subscribers').get().n, 1);
  assert.equal(mailer.outbox.length, 2);
});

test('a confirmed subscriber who signs up again is unchanged and gets no email', async () => {
  const { db, config, mailer } = setup();
  await requestSignup(db, mailer, config, { email: 'ana@example.com' });
  const token = /token=([^\s]+)/.exec(mailer.outbox[0].text)[1];
  assert.equal(confirmSignup(db, decodeURIComponent(token)), 'confirmed');
  const before = db.prepare('SELECT * FROM subscribers').get();

  const again = await requestSignup(db, mailer, config, { email: 'Ana@Example.com' });
  assert.equal(again.ok, true); // same answer as for a new address: nothing is revealed
  const after = db.prepare('SELECT * FROM subscribers').get();
  assert.equal(after.status, 'confirmed');
  assert.equal(after.confirmed_at, before.confirmed_at);
  assert.equal(after.submit_count, 2);
  assert.equal(mailer.outbox.length, 1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM subscribers').get().n, 1);
});

test('bad addresses are rejected and nothing is stored', async () => {
  const { db, config, mailer } = setup();
  for (const email of ['', 'nope', 'a@b', 'a b@example.com', 'x@@example.com', `${'a'.repeat(70)}@example.com`, 'a@example..com']) {
    assert.equal((await requestSignup(db, mailer, config, { email })).ok, false, email);
  }
  assert.equal(db.prepare('SELECT COUNT(*) n FROM subscribers').get().n, 0);
  assert.equal(mailer.outbox.length, 0);
});

test('confirmation links work once, expire, and cannot be forged', async () => {
  const { db, config, mailer } = setup();
  const t0 = Date.parse('2026-10-28T10:00:00Z');
  await requestSignup(db, mailer, config, { email: 'ana@example.com' }, t0);
  const token = decodeURIComponent(/token=([^\s]+)/.exec(mailer.outbox[0].text)[1]);
  assert.equal(confirmSignup(db, 'x'.repeat(43)), 'invalid');
  assert.equal(confirmSignup(db, token, t0 + 49 * 3600_000), 'expired');
  assert.equal(confirmSignup(db, token, t0 + 3600_000), 'confirmed');
  assert.equal(confirmSignup(db, token, t0 + 3700_000), 'already');
  assert.equal(db.prepare("SELECT token FROM (SELECT confirm_token_hash AS token FROM subscribers)").get().token.includes(token), false); // only a hash is stored
});

test('unsubscribe works with a valid signed token and with nothing else', async () => {
  const { db, config, mailer } = setup();
  await requestSignup(db, mailer, config, { email: 'ana@example.com' });
  const id = db.prepare('SELECT id FROM subscribers').get().id;
  assert.equal(unsubscribe(db, config, `${id}.forged-forged-forged-forged`), false);
  assert.equal(unsubscribe(db, config, String(id)), false);
  assert.equal(unsubscribe(db, config, unsubscribeToken(config.appSecret, id)), true);
  assert.equal(unsubscribe(db, config, unsubscribeToken(config.appSecret, id)), true); // twice is fine
  assert.equal(db.prepare('SELECT status FROM subscribers').get().status, 'unsubscribed');

  // Signing up again re-opens the same row.
  await requestSignup(db, mailer, config, { email: 'ana@example.com' });
  assert.equal(db.prepare('SELECT COUNT(*) n FROM subscribers').get().n, 1);
  assert.equal(db.prepare('SELECT status FROM subscribers').get().status, 'pending');
  assert.equal(listSubscribers(db).length, 1);
});

// ---- issue drafting and publishing -------------------------------------------------------

test('a new issue needs a country with verified coverage', () => {
  const { db } = setup();
  assert.throws(() => createDraft(db, issueInput()), (e) => e instanceof IssueError && /Coverage for Portugal is not verified yet/.test(e.problems.join(' ')));
  assert.equal(db.prepare('SELECT COUNT(*) n FROM newsletter_issues').get().n, 0);

  verifySource(db, 'pmp-lu'); // verifies Luxembourg only
  assert.throws(() => createDraft(db, issueInput({ country: 'PRT' })), /not verified/);
  assert.equal(createDraft(db, issueInput({ country: 'LUX', links: [{ url: 'https://pmp.lu/notice/1', label: 'Notice' }] })).country, 'LUX');
});

test('editors get every problem at once, in plain words', () => {
  const { db } = setup();
  verifySource(db, 'ted');
  const bad = issueInput({
    title: '',
    issue_date: '2026-02-31',
    country: 'PRT',
    links: [
      { url: 'http://ted.europa.eu/x', label: 'insecure' },
      { url: 'https://evil.example/phish', label: 'off directory' },
      { url: 'https://www.base.gov.pt/ok', label: 'fine' },
      { url: TED_LINK, label: 'one' },
      { url: `${TED_LINK}#again`, label: 'repeat' },
      { url: '', label: 'label only' },
    ],
  });
  const { problems } = validateIssueInput(db, bad);
  const text = problems.join('\n');
  assert.match(text, /Add a title/);
  assert.match(text, /valid issue date/);
  assert.match(text, /Link 1 must start with https/);
  assert.match(text, /Link 2 is not on an official Portugal source from our directory \(.*ted\.europa\.eu/);
  assert.match(text, /Link 5 repeats an earlier link/);
  assert.match(text, /Link 6 has a label but no address/);
  assert.doesNotMatch(text, /Link 3|Link 4/);
  assert.equal(validateIssueInput(db, issueInput({ links: Array.from({ length: 9 }, (_, i) => ({ url: `${TED_LINK}${i}`, label: String(i) })) })).problems.some((p) => /at most 8/.test(p)), true);
});

test('drafts are private: they never reach the public listing or detail lookup', () => {
  const { db } = setup();
  verifySource(db, 'ted');
  const draft = createDraft(db, issueInput());
  assert.equal(draft.status, 'draft');
  assert.deepEqual(listPublicIssues(db), []);
  assert.equal(getPublicIssue(db, draft.slug), null);
  assert.equal(listAllIssues(db).length, 1);
  assert.equal(getIssue(db, draft.slug).links[0].url, TED_LINK); // the admin can still read it
});

test('publishing needs verified coverage, content and at least one official source link', () => {
  const { db } = setup();
  verifySource(db, 'ted');
  const noLinks = createDraft(db, issueInput({ links: [] }));
  assert.throws(() => publishIssue(db, noLinks.slug), (e) => /at least one official source link/.test(e.problems.join(' ')));
  assert.equal(getIssue(db, noLinks.slug).status, 'draft');

  const noContent = createDraft(db, issueInput({ content: '', issue_date: '2026-11-09' }));
  assert.throws(() => publishIssue(db, noContent.slug), (e) => /Add the issue content/.test(e.problems.join(' ')));

  const good = createDraft(db, issueInput({ issue_date: '2026-11-16' }));
  assert.deepEqual(listPublicIssues(db), []); // still a draft
  const published = publishIssue(db, good.slug);
  assert.equal(published.status, 'published');
  assert.ok(published.published_at);
  assert.deepEqual(listPublicIssues(db).map((i) => i.slug), [good.slug]);
  assert.equal(getPublicIssue(db, good.slug).links.length, 1);
  // Only the published one became public.
  assert.equal(listPublicIssues(db).length, 1);
  assert.equal(listAllIssues(db).length, 3);
});

test('coverage that lapses after drafting blocks publication', () => {
  const { db } = setup();
  verifySource(db, 'ted');
  const draft = createDraft(db, issueInput());
  verifySource(db, 'ted', 'failed');
  assert.throws(() => publishIssue(db, draft.slug), /not verified yet/);
  assert.equal(listPublicIssues(db).length, 0);
});

test('a source link that leaves the directory blocks publication too', () => {
  const { db } = setup();
  verifySource(db, 'ted');
  const draft = createDraft(db, issueInput());
  db.prepare("UPDATE newsletter_links SET url = 'https://evil.example/swapped' WHERE issue_id = ?").run(getIssue(db, draft.slug).id);
  assert.throws(() => publishIssue(db, draft.slug), /Link 1 is not on an official Portugal source/);
});

test('published issues are listed by date, filtered by country, and hidden if coverage lapses', () => {
  const { db } = setup();
  verifySource(db, 'ted');
  const a = publishIssue(db, createDraft(db, issueInput({ title: 'A', issue_date: '2026-10-12' })).slug);
  const b = publishIssue(db, createDraft(db, issueInput({ title: 'B', issue_date: '2026-10-26', country: 'BEL', links: [{ url: 'https://www.publicprocurement.be/x', label: 'x' }] })).slug);
  const c = publishIssue(db, createDraft(db, issueInput({ title: 'C', issue_date: '2026-10-19' })).slug);
  assert.deepEqual(listPublicIssues(db).map((i) => i.title), ['B', 'C', 'A']); // newest first
  assert.deepEqual(listPublicIssues(db, { country: 'PRT' }).map((i) => i.title), ['C', 'A']);
  assert.deepEqual(listPublicIssues(db, { country: 'LUX' }), []);

  verifySource(db, 'ted', 'failed'); // coverage lapses for every country
  assert.deepEqual(listPublicIssues(db), []);
  assert.equal(getPublicIssue(db, a.slug), null);
  assert.equal(getIssue(db, b.slug).status, 'published'); // still stored, just not shown
  verifySource(db, 'ted');
  assert.equal(getPublicIssue(db, c.slug).title, 'C');
});

test('published issues are frozen, and unpublishing returns one to a private draft', () => {
  const { db } = setup();
  verifySource(db, 'ted');
  const issue = publishIssue(db, createDraft(db, issueInput()).slug);
  assert.throws(() => updateDraft(db, issue.slug, issueInput({ title: 'Changed' })), /cannot be edited/);
  assert.equal(getIssue(db, issue.slug).title, 'Tender watch: Portugal');
  unpublishIssue(db, issue.slug);
  assert.equal(getPublicIssue(db, issue.slug), null);
  assert.equal(updateDraft(db, issue.slug, issueInput({ title: 'Changed' })).title, 'Changed');
});

test('slugs are unique per date and country', () => {
  const { db } = setup();
  verifySource(db, 'ted');
  assert.equal(createDraft(db, issueInput()).slug, '2026-11-02-prt');
  assert.equal(createDraft(db, issueInput()).slug, '2026-11-02-prt-2');
  assert.equal(createDraft(db, issueInput({ country: 'BEL', links: [] })).slug, '2026-11-02-bel');
});

test('the database itself refuses a source link that is not https', () => {
  const { db } = setup();
  verifySource(db, 'ted');
  const issue = createDraft(db, issueInput());
  const id = getIssue(db, issue.slug).id;
  const ted = db.prepare("SELECT id FROM sources WHERE slug = 'ted'").get().id;
  assert.throws(() => db.prepare("INSERT INTO newsletter_links (issue_id, position, source_id, label, url) VALUES (?, 9, ?, 'x', 'http://ted.europa.eu/x')").run(id, ted), /CHECK/);
  assert.throws(() => db.prepare("INSERT INTO newsletter_links (issue_id, position, source_id, label, url) VALUES (?, 9, NULL, 'x', 'https://ted.europa.eu/x')").run(id), /NOT NULL/);
});

// ---- building a draft from stored TED notices ------------------------------------------------

test('a draft can be started from stored TED notices, and stays private', () => {
  const { db } = setup();
  verifySource(db, 'ted');
  store(db, tedNotice(11, { country: 'PRT', date: '2026-10-27', cpv: ['72000000'], deadline: '2026-11-20', title: 'Cloud services' }), 'PRT');
  store(db, tedNotice(12, { country: 'PRT', date: '2026-10-28', cpv: ['71000000'], deadline: '2026-11-10', title: 'Bridge design' }), 'PRT');
  store(db, tedNotice(13, { country: 'PRT', date: '2026-10-28', cpv: ['79000000'], deadline: '2026-11-30', title: 'Consultancy' }), 'PRT');
  store(db, tedNotice(14, { country: 'PRT', date: '2026-10-28', cpv: ['15000000'], deadline: '2026-11-30', title: 'Cheese supplies' }), 'PRT');
  store(db, tedNotice(15, { country: 'PRT', date: '2026-10-28', cpv: ['72000000'], deadline: '2026-10-29', title: 'Already closed' }), 'PRT');
  store(db, tedNotice(16, { country: 'LUX', date: '2026-10-28', cpv: ['72000000'], title: 'Luxembourg tender' }), 'LUX');
  store(db, tedNotice(17, { country: 'PRT', date: '2026-10-05', cpv: ['72000000'], title: 'Wrong week' }), 'PRT');

  const built = buildDraftIssue(db, { week: '2026-W44', country: 'PRT' });
  assert.equal(built.slug, '2026-11-02-prt');
  assert.equal(built.totalNotices, 5);
  const issue = getIssue(db, built.slug);
  assert.equal(issue.status, 'draft');
  assert.equal(issue.country, 'PRT');
  assert.deepEqual(issue.links.map((l) => l.label), ['Bridge design', 'Cloud services', 'Consultancy']); // closest deadline first
  assert.ok(issue.links.every((l) => l.url.startsWith('https://ted.europa.eu/') && l.source_slug === 'ted'));
  assert.match(issue.links[0].detail, /Deadline 10 November 2026/);
  assert.deepEqual(listPublicIssues(db), []);

  assert.throws(() => buildDraftIssue(db, { week: '2026-W44', country: 'PRT' }), /already exists/);
  assert.equal(buildDraftIssue(db, { week: '2026-W44', country: 'PRT', replace: true }).linkCount, 3);
  publishIssue(db, built.slug);
  assert.throws(() => buildDraftIssue(db, { week: '2026-W44', country: 'PRT', replace: true }), /already published/);
});

test('building a draft needs a verified country and a real week', () => {
  const { db } = setup();
  assert.throws(() => buildDraftIssue(db, { week: '2026-W44', country: 'PRT' }), /not verified/);
  verifySource(db, 'ted');
  assert.throws(() => buildDraftIssue(db, { week: '2026-W99', country: 'PRT' }), /Invalid week|does not exist/);
  assert.throws(() => buildDraftIssue(db, { week: '2026-W44', country: 'FRA' }), /Choose one of/);
  const empty = buildDraftIssue(db, { week: '2026-W44', country: 'BEL' });
  assert.equal(empty.linkCount, 0);
  assert.throws(() => publishIssue(db, empty.slug), /at least one official source link/); // an empty build cannot go public
});

// ---- emailing an issue -----------------------------------------------------------------------

test('an issue is emailed to confirmed subscribers only, once, with exactly its recorded links', async () => {
  const { db, config, mailer } = setup();
  verifySource(db, 'ted');
  for (const e of ['one@example.com', 'two@example.com', 'three@example.com']) await requestSignup(db, mailer, config, { email: e });
  mailer.outbox.length = 0;
  for (const e of ['one@example.com', 'two@example.com']) {
    const id = db.prepare('SELECT id FROM subscribers WHERE email = ?').get(e).id;
    db.prepare("UPDATE subscribers SET status = 'confirmed' WHERE id = ?").run(id);
  }

  const issue = createDraft(db, issueInput({ title: 'Tender <b>watch</b>', links: [{ label: 'A "quoted" <i>label</i>', url: TED_LINK, detail: 'Buyer & co' }] }));
  await assert.rejects(sendIssue(db, mailer, config, issue.slug), /is a draft/);
  publishIssue(db, issue.slug);

  const r = await sendIssue(db, mailer, config, issue.slug);
  assert.equal(r.sent, 2);
  assert.deepEqual(mailer.outbox.map((m) => m.to).sort(), ['one@example.com', 'two@example.com']);
  const mail = mailer.outbox[0];
  assert.match(mail.headers['List-Unsubscribe'], /\/newsletter\/unsubscribe\?token=/);
  assert.equal(mail.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  assert.ok(mail.text.includes(TED_LINK));
  assert.ok(mail.html.includes(`href="${TED_LINK}"`));
  assert.ok(!mail.html.includes('<b>watch</b>') && !mail.html.includes('<i>label</i>')); // markup in content is escaped
  assert.match(mail.html, /Buyer &amp; co/);

  assert.equal((await sendIssue(db, mailer, config, issue.slug)).sent, 0); // nothing goes out twice
  assert.ok(getIssue(db, issue.slug).sent_at);
});

test('emailing is refused when it would not really deliver, or coverage has lapsed', async () => {
  const { db, config } = setup();
  verifySource(db, 'ted');
  const consoleMailer = createMailer(testConfig({ MAIL_TRANSPORT: '' }), db, { log: { info() {} } });
  const issue = publishIssue(db, createDraft(db, issueInput()).slug);
  await assert.rejects(sendIssue(db, consoleMailer, config, issue.slug), /SMTP_URL is not set/);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM newsletter_deliveries').get().n, 0);
  verifySource(db, 'ted', 'failed');
  await assert.rejects(sendIssue(db, memoryMailer(config, db), config, issue.slug), /not verified right now/);
});

test('failed deliveries are retried on the next send and do not block the rest', async () => {
  const { db, config, mailer } = setup();
  verifySource(db, 'ted');
  for (const e of ['one@example.com', 'two@example.com']) {
    db.prepare("INSERT INTO subscribers (email, status, consent_text_version, consented_at, last_submitted_at, created_at, updated_at) VALUES (?, 'confirmed', 'v', 'x', 'x', 'x', 'x')").run(e);
  }
  const issue = publishIssue(db, createDraft(db, issueInput()).slug);
  const original = mailer.send;
  mailer.send = async (m) => {
    if (m.to === 'one@example.com') throw new Error('mailbox full');
    return original(m);
  };
  const first = await sendIssue(db, mailer, config, issue.slug);
  assert.deepEqual([first.sent, first.failed], [1, 1]);
  assert.equal(getIssue(db, issue.slug).sent_at, null);
  mailer.send = original;
  const second = await sendIssue(db, mailer, config, issue.slug);
  assert.deepEqual([second.sent, second.failed], [1, 0]);
  assert.ok(getIssue(db, issue.slug).sent_at);
});

test('the email lists the same links the issue records', () => {
  const { db, config } = setup();
  verifySource(db, 'ted');
  const issue = getIssue(db, createDraft(db, issueInput({ links: [{ url: TED_LINK, label: 'One' }, { url: 'https://www.base.gov.pt/Base4/x', label: 'Two' }] })).slug);
  const { text } = renderIssueEmail(issue, config, 'https://www.tendrelark.eu/newsletter/unsubscribe?token=t');
  const found = [...text.matchAll(/https:\/\/(?:ted\.europa\.eu|www\.base\.gov\.pt)\S*/g)].map((m) => m[0]);
  assert.deepEqual(found, issue.links.map((l) => l.url));
});
