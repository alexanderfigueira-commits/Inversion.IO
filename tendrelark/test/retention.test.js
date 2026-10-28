import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { createBackup, restoreBackup } from '../src/db/backup.js';
import { openDatabase } from '../src/db/index.js';
import { seedSources } from '../src/db/seed.js';
import { requestSignup, unsubscribe } from '../src/newsletter/subscribers.js';
import { erasePersonalData, purgeExpiredPersonalData, reapplyErasures } from '../src/privacy.js';
import { createEnquiry } from '../src/enquiries.js';
import { freshDb, memoryMailer, tempDbPath, testConfig } from './helpers.js';

const SECRET = 'test-secret-test-secret-test-secret-1234';
const daysAgo = (n) => new Date(Date.now() - n * 86_400_000).toISOString();

test('unconfirmed signups and old enquiries are purged on the proposed schedule, and nothing else', async () => {
  const config = testConfig();
  const db = freshDb(config);
  const mailer = memoryMailer(config, db);
  for (const e of ['old-pending@example.com', 'new-pending@example.com', 'old-confirmed@example.com']) await requestSignup(db, mailer, config, { email: e });
  db.prepare("UPDATE subscribers SET created_at = ? WHERE email IN ('old-pending@example.com','old-confirmed@example.com')").run(daysAgo(40));
  db.prepare("UPDATE subscribers SET status = 'confirmed' WHERE email = 'old-confirmed@example.com'").run();
  await createEnquiry(db, mailer, config, { name: 'Old', email: 'oldenq@example.com', message: 'Hello there old.' });
  await createEnquiry(db, mailer, config, { name: 'New', email: 'newenq@example.com', message: 'Hello there new.' });
  db.prepare("UPDATE enquiries SET created_at = ? WHERE email = 'oldenq@example.com'").run(daysAgo(400));

  const r = purgeExpiredPersonalData(db, config.retention);
  assert.equal(r.unconfirmedSignups, 1);
  assert.equal(r.enquiries, 1);
  assert.deepEqual(db.prepare('SELECT email FROM subscribers ORDER BY email').all().map((x) => x.email), ['new-pending@example.com', 'old-confirmed@example.com']);
  assert.deepEqual(db.prepare('SELECT email FROM enquiries').all().map((x) => x.email), ['newenq@example.com']);
  assert.deepEqual([config.retention.unconfirmedSignupDays, config.retention.enquiryDays, config.backup.keepDays], [30, 365, 30]);
});

test('unsubscribing keeps only the address and the date', async () => {
  const config = testConfig();
  const db = freshDb(config);
  const mailer = memoryMailer(config, db);
  await requestSignup(db, mailer, config, { email: 'a@example.com', role: 'it_consultancy', source: 'home' });
  const id = db.prepare('SELECT id FROM subscribers').get().id;
  const { unsubscribeToken } = await import('../src/lib/security.js');
  assert.equal(unsubscribe(db, config, unsubscribeToken(config.appSecret, id)), true);
  const row = db.prepare('SELECT * FROM subscribers').get();
  assert.equal(row.status, 'unsubscribed');
  assert.ok(row.unsubscribed_at);
  assert.deepEqual([row.role, row.signup_source, row.confirm_token_hash], [null, null, null]);
});

test('an erasure leaves only a keyed hash, never the address', async () => {
  const config = testConfig();
  const db = freshDb(config);
  await requestSignup(db, memoryMailer(config, db), config, { email: 'gone@example.com' });
  erasePersonalData(db, 'gone@example.com', SECRET);
  const rows = db.prepare('SELECT * FROM erasures').all();
  assert.equal(rows.length, 1);
  assert.match(rows[0].email_hash, /^[A-Za-z0-9_-]{43}$/);
  assert.ok(!JSON.stringify(rows).includes('gone'));
  assert.throws(() => erasePersonalData(db, 'gone@example.com'), /needs the app secret/);
});

test('restoring an old backup does not bring an erased person back, but a later re-signup survives', async () => {
  const tmp = tempDbPath();
  const config = testConfig();
  const live = openDatabase(path.join(tmp.dir, 'live.db'));
  seedSources(live);
  const mailer = memoryMailer(config, live);
  await requestSignup(live, mailer, config, { email: 'erased@example.com' });
  await requestSignup(live, mailer, config, { email: 'stays@example.com' });
  await createEnquiry(live, mailer, config, { name: 'Erased Person', email: 'erased@example.com', message: 'Old enquiry text.' });

  const backup = await createBackup(live, { dir: path.join(tmp.dir, 'b'), passphrase: 'a long test passphrase' }); // taken BEFORE the erasure
  erasePersonalData(live, 'erased@example.com', SECRET);
  assert.equal(live.prepare("SELECT COUNT(*) n FROM subscribers WHERE email = 'erased@example.com'").get().n, 0);
  const tombstones = live.prepare('SELECT * FROM erasures').all(); // these live in the current database, which is what survives
  live.close();

  // Restore the old backup: the erased person is back in it...
  const target = path.join(tmp.dir, 'restored.db');
  await restoreBackup({ file: backup.file, to: target, passphrase: 'a long test passphrase' });
  const restored = openDatabase(target);
  assert.equal(restored.prepare("SELECT COUNT(*) n FROM subscribers WHERE email = 'erased@example.com'").get().n, 1);
  // ...until the erasures are applied again. The tombstone table is carried over from the live database.
  for (const t of tombstones) restored.prepare('INSERT INTO erasures (email_hash, erased_at) VALUES (?, ?)').run(t.email_hash, t.erased_at);
  const removed = reapplyErasures(restored, SECRET);
  assert.equal(removed >= 2, true);
  assert.equal(restored.prepare("SELECT COUNT(*) n FROM subscribers WHERE email = 'erased@example.com'").get().n, 0);
  assert.equal(restored.prepare("SELECT COUNT(*) n FROM enquiries WHERE email = 'erased@example.com'").get().n, 0);
  assert.equal(restored.prepare("SELECT COUNT(*) n FROM subscribers WHERE email = 'stays@example.com'").get().n, 1);

  // Someone who signs up again after the erasure is not deleted by it.
  await new Promise((r) => setTimeout(r, 5));
  await requestSignup(restored, memoryMailer(config, restored), config, { email: 'erased@example.com' });
  assert.equal(reapplyErasures(restored, SECRET), 0);
  assert.equal(restored.prepare("SELECT COUNT(*) n FROM subscribers WHERE email = 'erased@example.com'").get().n, 1);
  assert.equal(reapplyErasures(restored, 'a different secret entirely, so no match'), 0);
  restored.close();
  tmp.cleanup();
});

test('databases at schema 1 upgrade to 2 and gain the erasures table', () => {
  const tmp = tempDbPath();
  const f = path.join(tmp.dir, 'x.db');
  let db = openDatabase(f);
  db.exec('DROP TABLE erasures; PRAGMA user_version = 1');
  db.close();
  db = openDatabase(f);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 2);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM erasures').get().n, 0);
  db.close();
  assert.ok(fs.existsSync(f));
  tmp.cleanup();
});
