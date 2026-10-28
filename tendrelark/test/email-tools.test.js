import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkEmailDns, judgeDkim, judgeDmarc, judgeSpf } from '../src/lib/dns-check.js';
import { createMailer, explainMailError } from '../src/lib/mailer.js';
import { buildSmtpUrl, describeSmtpUrl, redactSmtpUrl } from '../src/lib/smtp-url.js';
import { freshDb, startSmtpStub, testConfig } from './helpers.js';

const mailerFor = (smtpUrl) => {
  const config = testConfig({ MAIL_TRANSPORT: '', SMTP_URL: smtpUrl });
  const db = freshDb(config);
  return { db, mailer: createMailer(config, db, { log: { info() {} } }) };
};

test('the SMTP URL builder encodes awkward characters and picks the right scheme', () => {
  const url = buildSmtpUrl({ host: 'Mail.Example.com', port: '465', user: 'support@tendrelark.eu', password: 'p@ss:w/rd#1?%' });
  assert.equal(url, 'smtps://support%40tendrelark.eu:p%40ss%3Aw%2Frd%231%3F%25@mail.example.com:465');
  assert.deepEqual(describeSmtpUrl(url), { secureFromStart: true, host: 'mail.example.com', port: 465, user: 'support@tendrelark.eu', hasPassword: true });
  assert.ok(buildSmtpUrl({ host: 'smtp.example.com', port: 587, user: 'u', password: 'p' }).startsWith('smtp://'));
  assert.equal(redactSmtpUrl(url), 'smtps://support%40tendrelark.eu:*****@mail.example.com:465');
  assert.equal(redactSmtpUrl('garbage'), '(not a valid SMTP_URL)');
  for (const bad of [
    { host: 'https://mail.example.com', port: 465, user: 'u', password: 'p' },
    { host: 'mail', port: 465, user: 'u', password: 'p' },
    { host: 'mail.example.com', port: 'x', user: 'u', password: 'p' },
    { host: 'mail.example.com', port: 70000, user: 'u', password: 'p' },
    { host: 'mail.example.com', port: 465, user: '', password: 'p' },
    { host: 'mail.example.com', port: 465, user: 'u', password: '' },
  ]) assert.throws(() => buildSmtpUrl(bad), undefined, JSON.stringify(bad));
});

test('the mailer really connects, logs in and delivers over SMTP', async (t) => {
  const smtp = await startSmtpStub();
  t.after(() => smtp.close());
  const { db, mailer } = mailerFor(buildSmtpUrl({ host: 'localhost', port: smtp.port, user: 'support@tendrelark.eu', password: 'secret' }).replace('@localhost', '@127.0.0.1'));
  assert.equal(mailer.mode, 'smtp');
  assert.equal(await mailer.verify(), true);

  const r = await mailer.send({ to: 'visitor@example.com', kind: 'test', subject: 'Hello from the stub', text: 'Plain body line.', html: '<p>Html body</p>' });
  assert.equal(r.delivered, true);
  assert.equal(smtp.messages.length, 1);
  assert.match(smtp.messages[0], /Subject: Hello from the stub/);
  assert.match(smtp.messages[0], /To: visitor@example\.com/);
  assert.match(smtp.messages[0], /From: Tendrelark <support@tendrelark\.eu>/);
  assert.match(smtp.messages[0], /Plain body line\./);
  assert.equal(db.prepare('SELECT status FROM email_log').get().status, 'sent');
});

test('a password with special characters survives the round trip through the URL', async (t) => {
  const tricky = 'p@ss:w/rd#1?%';
  const smtp = await startSmtpStub({ pass: tricky });
  t.after(() => smtp.close());
  const url = buildSmtpUrl({ host: 'localhost', port: smtp.port, user: 'support@tendrelark.eu', password: tricky }).replace('@localhost', '@127.0.0.1');
  const { mailer } = mailerFor(url);
  assert.equal(await mailer.verify(), true);
});

test('a wrong password fails clearly, and the failure is logged', async (t) => {
  const smtp = await startSmtpStub();
  t.after(() => smtp.close());
  const { db, mailer } = mailerFor(`smtp://support%40tendrelark.eu:wrong@127.0.0.1:${smtp.port}`);
  await assert.rejects(mailer.verify(), (err) => {
    assert.equal(err.code, 'EAUTH');
    assert.match(explainMailError(err), /username or password/);
    return true;
  });
  await assert.rejects(mailer.send({ to: 'a@example.com', kind: 'test', subject: 's', text: 't' }));
  const row = db.prepare('SELECT status, error FROM email_log').get();
  assert.equal(row.status, 'failed');
  assert.ok(row.error);
});

test('a server that is not there gives a message about the name and port', async (t) => {
  const smtp = await startSmtpStub();
  const { port } = smtp;
  await smtp.close();
  const { mailer } = mailerFor(`smtp://u:p@127.0.0.1:${port}`);
  await assert.rejects(mailer.verify(), (err) => {
    assert.match(explainMailError(err), /server name and port/);
    return true;
  });
});

test('without SMTP_URL there is nothing to verify, and sending only logs', async () => {
  const config = testConfig({ MAIL_TRANSPORT: '' });
  const db = freshDb(config);
  const mailer = createMailer(config, db, { log: { info() {} } });
  assert.equal(mailer.mode, 'console');
  await assert.rejects(mailer.verify(), /SMTP_URL is not set/);
  assert.equal((await mailer.send({ to: 'a@example.com', kind: 'x', subject: 's', text: 't' })).delivered, false);
  assert.equal(db.prepare('SELECT status FROM email_log').get().status, 'logged');
});

test('common mail errors are explained in plain words', () => {
  const cases = [
    [{ code: 'EAUTH', message: 'Invalid login' }, /username or password/],
    [{ code: 'ECONNREFUSED', message: 'x' }, /server name and port/],
    [{ code: 'ENOTFOUND', message: 'x' }, /server name was not found/],
    [{ code: 'ETIMEDOUT', message: 'x' }, /did not answer in time/],
    [{ code: 'ESOCKET', message: 'error:...:wrong version number' }, /smtps:\/\/ with port 465/],
    [{ code: 'ESOCKET', message: 'self-signed certificate' }, /certificate/],
    [{ code: 'EENVELOPE', message: '553 sender not allowed' }, /sender or the recipient/],
    [{ code: 'EMESSAGE', message: '550 mailbox unavailable' }, /refused the message/],
    [new Error('something odd'), /Sending failed: something odd/],
  ];
  for (const [err, re] of cases) assert.match(explainMailError(err), re, JSON.stringify(err));
});

// ---- DNS checks ----------------------------------------------------------------------------------

const resolverFor = (txtMap, cnameMap = {}) => ({
  resolveTxt: async (name) => {
    if (!(name in txtMap)) throw Object.assign(new Error('nx'), { code: 'ENOTFOUND' });
    return txtMap[name].map((r) => [r]);
  },
  resolveCname: async (name) => {
    if (!(name in cnameMap)) throw Object.assign(new Error('nx'), { code: 'ENODATA' });
    return cnameMap[name];
  },
});

test('SPF is judged on presence, count and ending', () => {
  assert.equal(judgeSpf([]).status, 'fail');
  assert.equal(judgeSpf(['v=spf1 include:_spf.mail.example ~all', 'v=spf1 -all']).status, 'fail'); // two records
  assert.equal(judgeSpf(['v=spf1 +all']).status, 'fail');
  assert.equal(judgeSpf(['v=spf1 include:_spf.mail.example']).status, 'warn');
  assert.equal(judgeSpf(['v=spf1 ~all']).status, 'warn'); // lists no senders
  assert.equal(judgeSpf(['v=spf1 include:_spf.mail.example ~all']).status, 'pass');
  assert.equal(judgeSpf(['google-site-verification=abc']).status, 'fail'); // unrelated TXT records are ignored
});

test('DMARC is judged on policy and reporting', () => {
  assert.equal(judgeDmarc([]).status, 'fail');
  assert.equal(judgeDmarc(['v=DMARC1; rua=mailto:a@b.eu']).status, 'fail'); // no policy
  assert.equal(judgeDmarc(['v=DMARC1; p=none; rua=mailto:a@b.eu']).status, 'warn');
  assert.equal(judgeDmarc(['v=DMARC1; p=quarantine']).status, 'warn'); // no reports
  assert.equal(judgeDmarc(['v=DMARC1; p=quarantine; rua=mailto:a@b.eu']).status, 'pass');
  assert.equal(judgeDmarc(['v=DMARC1; p=reject; rua=mailto:a@b.eu']).status, 'pass');
});

test('DKIM accepts a published key or a CNAME to the provider, and rejects a revoked key', () => {
  assert.equal(judgeDkim('s1', ['v=DKIM1; k=rsa; p=MIGfMA0GCSq'], []).status, 'pass');
  assert.equal(judgeDkim('s1', [], ['s1.domainkey.provider.example']).status, 'pass');
  assert.equal(judgeDkim('s1', ['v=DKIM1; p='], []).status, 'fail');
  assert.equal(judgeDkim('s1', [], []).status, 'fail');
});

test('the DNS check looks up all three records and reports an overall result', async () => {
  const good = resolverFor(
    { 'tendrelark.eu': ['v=spf1 include:_spf.mail.example ~all'], '_dmarc.tendrelark.eu': ['v=DMARC1; p=quarantine; rua=mailto:support@tendrelark.eu'], 's1._domainkey.tendrelark.eu': ['v=DKIM1; p=ABC'] },
  );
  const r = await checkEmailDns('tendrelark.eu', { resolver: good, dkimSelectors: ['s1'] });
  assert.equal(r.ok, true);
  assert.equal(r.allClear, true);

  const none = await checkEmailDns('tendrelark.eu', { resolver: resolverFor({}), dkimSelectors: ['s1'] });
  assert.equal(none.ok, false);
  assert.deepEqual([none.spf.status, none.dmarc.status, none.dkim[0].status], ['fail', 'fail', 'fail']);

  const noDkim = await checkEmailDns('tendrelark.eu', { resolver: good });
  assert.deepEqual(noDkim.dkim, []); // DKIM is only checked when a selector is given

  await assert.rejects(checkEmailDns('not a domain', { resolver: good }), /does not look like a domain/);
});
