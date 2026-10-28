import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAlerter } from '../src/lib/alerts.js';
import { getMeta } from '../src/db/index.js';
import { countPersonalData, erasePersonalData, exportPersonalData, findPersonalData, purgeOldEmailLogs } from '../src/privacy.js';
import { requestSignup } from '../src/newsletter/subscribers.js';
import { createEnquiry } from '../src/enquiries.js';
import { freshDb, memoryMailer, startApp, testConfig } from './helpers.js';

async function populated() {
  const config = testConfig();
  const db = freshDb(config);
  const mailer = memoryMailer(config, db);
  await requestSignup(db, mailer, config, { email: 'Ana.Silva@example.com', role: 'bid_consultant' });
  await requestSignup(db, mailer, config, { email: 'other@example.com' });
  await createEnquiry(db, mailer, config, { name: 'Ana Silva', email: 'ana.silva@example.com', company: 'Acme', interest: 'both', message: 'We bid on IT tenders.' });
  await createEnquiry(db, mailer, config, { name: 'Someone Else', email: 'other@example.com', message: 'Hello there friend.' });
  const ana = db.prepare("SELECT id FROM subscribers WHERE email = 'ana.silva@example.com'").get().id;
  db.prepare("INSERT INTO newsletter_issues (slug, title, issue_date, country, status, created_at, updated_at) VALUES ('2026-11-02-prt', 'T', '2026-11-02', 'PRT', 'published', 'x', 'x')").run();
  db.prepare("INSERT INTO newsletter_deliveries (issue_id, subscriber_id, status, attempted_at) VALUES (1, ?, 'sent', 'x')").run(ana);
  return { db, config, mailer };
}

test('an access request returns everything held for the address, in any capitalisation, and no secrets', async () => {
  const { db } = await populated();
  const data = exportPersonalData(db, '  ANA.silva@Example.com ');
  assert.equal(data.subscriber.length, 1);
  assert.equal(data.subscriber[0].role, 'bid_consultant');
  assert.equal(data.enquiries.length, 1);
  assert.equal(data.enquiries[0].message, 'We bid on IT tenders.');
  assert.equal(data.newsletterDeliveries.length, 1);
  assert.ok(data.emailLog.length >= 1);
  assert.ok(data.emailLog.every((r) => r.to_email.toLowerCase() === 'ana.silva@example.com'));
  assert.doesNotMatch(JSON.stringify(data), /confirm_token_hash/);
  assert.ok(!JSON.stringify(data).includes('other@example.com'), 'nothing about anyone else');
  assert.equal(exportPersonalData(db, 'not an email'), null);
  assert.deepEqual(countPersonalData(findPersonalData(db, 'nobody@example.com')), { subscribers: 0, enquiries: 0, emailLog: 0, deliveries: 0 });
});

test('erasure removes one person completely and leaves everyone else alone', async () => {
  const { db } = await populated();
  const counts = erasePersonalData(db, 'ana.silva@example.com');
  assert.deepEqual([counts.subscribers, counts.enquiries, counts.deliveries], [1, 1, 1]);

  assert.equal(db.prepare("SELECT COUNT(*) n FROM subscribers WHERE email = 'ana.silva@example.com'").get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM enquiries WHERE email = 'ana.silva@example.com'").get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM email_log WHERE lower(to_email) = 'ana.silva@example.com'").get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM newsletter_deliveries').get().n, 0);
  // Searching every text column in every table for the name or address finds nothing.
  for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all()) {
    const rows = JSON.stringify(db.prepare(`SELECT * FROM ${name}`).all()).toLowerCase();
    assert.ok(!rows.includes('ana.silva'), `${name} still mentions the address`);
    assert.ok(!rows.includes('ana silva'), `${name} still mentions the name`);
  }
  // The other person is untouched, and only a count of requests remains.
  assert.equal(db.prepare("SELECT COUNT(*) n FROM subscribers WHERE email = 'other@example.com'").get().n, 1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM enquiries WHERE email = 'other@example.com'").get().n, 1);
  assert.equal(getMeta(db, 'erasure_requests_handled'), '1');
  assert.deepEqual(countPersonalData(findPersonalData(db, 'ana.silva@example.com')), { subscribers: 0, enquiries: 0, emailLog: 0, deliveries: 0 });
  assert.equal(erasePersonalData(db, 'broken'), null);
});

test('enquiry notifications keep no name in the email log subject', async () => {
  const { db } = await populated();
  const subjects = db.prepare("SELECT subject FROM email_log WHERE kind = 'enquiry_notification'").all().map((r) => r.subject);
  assert.ok(subjects.length >= 1);
  assert.ok(subjects.every((s) => s === 'New website enquiry'));
});

test('old email log rows are purged and recent ones stay', async () => {
  const { db } = await populated();
  db.prepare("UPDATE email_log SET created_at = '2025-01-01T00:00:00.000Z' WHERE id = 1").run();
  const before = db.prepare('SELECT COUNT(*) n FROM email_log').get().n;
  assert.equal(purgeOldEmailLogs(db, 90, new Date()), 1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM email_log').get().n, before - 1);
  assert.equal(purgeOldEmailLogs(db, 90, new Date()), 0);
  assert.equal(testConfig().retention.emailLogDays, 90);
});

test('the admin data request screens look up, export and erase, with the usual protections', async (t) => {
  const app = await startApp();
  t.after(() => app.close());
  await requestSignup(app.db, app.mailer, app.config, { email: 'ana.silva@example.com' });

  assert.equal((await app.get('/admin/privacy')).status, 401);
  assert.equal((await app.post('/admin/privacy/erase', { email: 'ana.silva@example.com', confirm: 'yes' })).status, 401);

  const look = await app.get('/admin/privacy?email=ANA.silva@example.com', { admin: true });
  assert.match(look.text, /Held for ana\.silva@example\.com/);
  assert.match(look.text, /Newsletter record<\/dt><dd>1/);
  assert.match((await app.get('/admin/privacy?email=nobody@example.com', { admin: true })).text, /Nothing is held for this address/);
  assert.match((await app.get('/admin/privacy?email=oops', { admin: true })).text, /does not look like an email address/);

  const exp = await app.post('/admin/privacy/export', { csrf: app.csrf(), email: 'ana.silva@example.com' }, { admin: true });
  assert.equal(exp.status, 200);
  assert.match(exp.headers.get('content-disposition'), /attachment; filename="?personal-data\.json"?/);
  assert.equal(JSON.parse(exp.text).subscriber[0].email, 'ana.silva@example.com');
  assert.equal(exp.headers.get('cache-control'), 'no-store');

  assert.equal((await app.post('/admin/privacy/erase', { csrf: 'forged', email: 'ana.silva@example.com', confirm: 'yes' }, { admin: true })).status, 403);
  const unconfirmed = await app.post('/admin/privacy/erase', { csrf: app.csrf(), email: 'ana.silva@example.com' }, { admin: true });
  assert.equal(unconfirmed.status, 303);
  assert.equal(app.db.prepare('SELECT COUNT(*) n FROM subscribers').get().n, 1, 'nothing deleted without the box ticked');

  const done = await app.post('/admin/privacy/erase', { csrf: app.csrf(), email: 'ana.silva@example.com', confirm: 'yes' }, { admin: true });
  assert.equal(done.status, 303);
  assert.equal(app.db.prepare('SELECT COUNT(*) n FROM subscribers').get().n, 0);
  assert.match((await app.get(done.headers.get('location'), { admin: true })).text, /Erased: 1 newsletter record/);
});

// ---- alerts -------------------------------------------------------------------------------------

test('alerts are throttled per kind, and the next one says how many were held back', async () => {
  const config = testConfig();
  const db = freshDb(config);
  const mailer = memoryMailer(config, db);
  let t = 1_000_000;
  const alerter = createAlerter({ config, mailer, log: { error() {} }, now: () => t });

  assert.equal((await alerter.alert('x', 'First problem', 'details')).sent, true);
  assert.equal((await alerter.alert('x', 'First problem again', 'details')).throttled, true);
  assert.equal((await alerter.alert('x', 'And again', 'details')).throttled, true);
  assert.equal((await alerter.alert('y', 'A different problem', 'details')).sent, true); // other kinds are independent
  assert.equal(mailer.outbox.length, 2);

  t += 16 * 60_000;
  assert.equal((await alerter.alert('x', 'Back again', 'details')).sent, true);
  const mail = mailer.outbox.at(-1);
  assert.equal(mail.to, 'support@tendrelark.eu');
  assert.match(mail.subject, /^\[Tendrelark ALERT\] Back again/);
  assert.match(mail.text, /2 similar alerts were held back/);
});

test('a failing mailer never makes alerting throw', async () => {
  const config = testConfig();
  const lines = [];
  const alerter = createAlerter({ config, mailer: { send: async () => { throw new Error('smtp down'); } }, log: { error: (m) => lines.push(m) } });
  const r = await alerter.alert('x', 'Problem', 'details');
  assert.equal(r.sent, false);
  assert.ok(lines.some((l) => /smtp down/.test(l)));
});

test('a server error sends one alert with the path but no query string, and the visitor still sees an error page', async (t) => {
  const app = await startApp();
  t.after(() => app.close());
  const real = app.db.prepare.bind(app.db);
  app.db.prepare = (sql) => {
    if (/FROM ted_notices t/.test(sql)) throw new Error('boom: database exploded');
    return real(sql);
  };
  const first = await app.get('/tenders?q=secret-search-term');
  assert.equal(first.status, 500);
  assert.match(first.text, /Something went wrong on our side/);
  assert.doesNotMatch(first.text, /boom|exploded|secret-search-term/);
  await new Promise((r) => setTimeout(r, 20));

  const alerts = app.mailer.outbox.filter((m) => /ALERT/.test(m.subject));
  assert.equal(alerts.length, 1);
  assert.match(alerts[0].subject, /Server error on GET \/tenders/);
  assert.match(alerts[0].text, /boom: database exploded/);
  assert.doesNotMatch(alerts[0].text, /secret-search-term/);

  await app.get('/tenders');
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(app.mailer.outbox.filter((m) => /ALERT/.test(m.subject)).length, 1, 'a second error within the window is held back');
});
