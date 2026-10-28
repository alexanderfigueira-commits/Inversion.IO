import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { createBackup, isBackupDue, listBackups, pruneBackups, readBackupStatus, restoreBackup, runBackupJob, verifyBackup } from '../src/db/backup.js';
import { openDatabase } from '../src/db/index.js';
import { seedSources } from '../src/db/seed.js';
import { buildHealth } from '../src/web/routes/system.js';
import { upsertNotice } from '../src/ted/ingest.js';
import { normalizeNotice } from '../src/ted/normalize.js';
import { tedNotice, tempDbPath, testConfig } from './helpers.js';

const PASS = 'a long test passphrase';

/** A real file database with notices and one subscriber, the way production holds them. */
function liveDb(tmp, notices = 5) {
  const db = openDatabase(path.join(tmp.dir, 'live.db'));
  seedSources(db);
  for (let i = 1; i <= notices; i += 1) upsertNotice(db, normalizeNotice(tedNotice(i, { country: 'PRT' }), { queryCountry: 'PRT' }), null);
  db.prepare("INSERT INTO subscribers (email, status, consent_text_version, consented_at, last_submitted_at, created_at, updated_at) VALUES ('secret.person@example.com', 'confirmed', 'v', 'x', 'x', 'x', 'x')").run();
  return db;
}

const countIn = (file, table) => {
  const d = new DatabaseSync(file, { readOnly: true });
  const n = d.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
  d.close();
  return n;
};

test('an encrypted backup restores to an identical database and hides its contents', async () => {
  const tmp = tempDbPath();
  const db = liveDb(tmp);
  const dir = path.join(tmp.dir, 'backups');
  const b = await createBackup(db, { dir, passphrase: PASS, now: new Date('2026-10-28T03:00:00Z') });

  assert.equal(b.name, 'tendrelark-20261028-030000.db.gz.enc');
  assert.equal(b.encrypted, true);
  assert.deepEqual([b.notices, b.subscribers], [5, 1]);
  const bytes = fs.readFileSync(b.file);
  assert.ok(!bytes.includes('secret.person@example.com'), 'the subscriber email must not be readable in the file');
  assert.ok(!bytes.includes('SQLite format 3'), 'the database header must not be readable');
  assert.equal(fs.statSync(b.file).mode & 0o077, 0, 'only the owner can read the file');
  assert.deepEqual(fs.readdirSync(dir), [b.name], 'no scratch files are left behind');

  const target = path.join(tmp.dir, 'restored.db');
  const info = await restoreBackup({ file: b.file, to: target, passphrase: PASS });
  assert.deepEqual([info.notices, info.subscribers, info.schemaVersion], [5, 1, 2]);
  assert.equal(countIn(target, 'ted_notices'), 5);
  const restored = new DatabaseSync(target, { readOnly: true });
  assert.equal(restored.prepare("SELECT email FROM subscribers").get().email, 'secret.person@example.com');
  assert.equal(restored.prepare('SELECT COUNT(*) n FROM ted_notice_countries').get().n, 5);
  restored.close();
  assert.equal((await verifyBackup(b.file, PASS)).notices, 5);
  tmp.cleanup();
});

test('a backup without a passphrase still works and is labelled as not encrypted', async () => {
  const tmp = tempDbPath();
  const db = liveDb(tmp, 2);
  const b = await createBackup(db, { dir: path.join(tmp.dir, 'b'), now: new Date('2026-10-28T03:00:00Z') });
  assert.equal(b.name, 'tendrelark-20261028-030000.db.gz');
  assert.equal(b.encrypted, false);
  assert.equal((await verifyBackup(b.file)).notices, 2);
  assert.deepEqual(listBackups(path.join(tmp.dir, 'b')).map((x) => x.encrypted), [false]);
  tmp.cleanup();
});

test('data still in the write ahead log is included, and the live database keeps working', async () => {
  const tmp = tempDbPath();
  const db = liveDb(tmp, 0);
  db.exec('PRAGMA wal_autocheckpoint = 0'); // keep everything in the WAL file
  for (let i = 1; i <= 40; i += 1) upsertNotice(db, normalizeNotice(tedNotice(i, { country: 'BEL' }), { queryCountry: 'BEL' }), null);
  assert.ok(fs.statSync(path.join(tmp.dir, 'live.db-wal')).size > 0, 'the rows are in the WAL');
  const b = await createBackup(db, { dir: path.join(tmp.dir, 'b'), passphrase: PASS });
  assert.equal(b.notices, 40);
  upsertNotice(db, normalizeNotice(tedNotice(99, { country: 'BEL' }), { queryCountry: 'BEL' }), null); // the app carries on
  assert.equal(db.prepare('SELECT COUNT(*) n FROM ted_notices').get().n, 41);
  tmp.cleanup();
});

test('a wrong passphrase is refused and a damaged file is detected, and nothing is replaced', async () => {
  const tmp = tempDbPath();
  const db = liveDb(tmp);
  const b = await createBackup(db, { dir: path.join(tmp.dir, 'b'), passphrase: PASS });
  const target = path.join(tmp.dir, 'keep.db');
  fs.writeFileSync(target, 'precious existing data');

  await assert.rejects(restoreBackup({ file: b.file, to: target, passphrase: 'not the passphrase', force: true }), /Wrong passphrase, or the backup file is damaged/);
  await assert.rejects(restoreBackup({ file: b.file, to: target, force: true }), /encrypted.*BACKUP_PASSPHRASE/);
  assert.equal(fs.readFileSync(target, 'utf8'), 'precious existing data');
  assert.ok(!fs.existsSync(`${target}.restoring`));

  const bad = Buffer.from(fs.readFileSync(b.file));
  bad[Math.floor(bad.length / 2)] ^= 0xff; // flip one byte in the middle
  const damaged = path.join(tmp.dir, 'b', 'tendrelark-20200101-000000.db.gz.enc');
  fs.writeFileSync(damaged, bad);
  await assert.rejects(verifyBackup(damaged, PASS), /damaged|Wrong passphrase/);
  await assert.rejects(restoreBackup({ file: path.join(tmp.dir, 'nope.enc'), to: target, passphrase: PASS, force: true }), /not found/);
  const junk = path.join(tmp.dir, 'junk.db.gz');
  fs.writeFileSync(junk, 'this is not a backup');
  await assert.rejects(restoreBackup({ file: junk, to: path.join(tmp.dir, 'x.db') }), /damaged or is not a Tendrelark backup/);
  tmp.cleanup();
});

test('restore refuses to overwrite without force, and replaces cleanly with it', async () => {
  const tmp = tempDbPath();
  const db = liveDb(tmp, 3);
  const b = await createBackup(db, { dir: path.join(tmp.dir, 'b'), passphrase: PASS });
  const target = path.join(tmp.dir, 'target.db');
  fs.writeFileSync(target, 'old');
  fs.writeFileSync(`${target}-wal`, 'stale wal that would corrupt the restore');
  await assert.rejects(restoreBackup({ file: b.file, to: target, passphrase: PASS }), /already exists.*--force/);
  assert.equal(fs.readFileSync(target, 'utf8'), 'old');
  const info = await restoreBackup({ file: b.file, to: target, passphrase: PASS, force: true });
  assert.equal(info.notices, 3);
  assert.ok(!fs.existsSync(`${target}-wal`));
  assert.equal(countIn(target, 'ted_notices'), 3);
  tmp.cleanup();
});

test('old backups are pruned by the time in their name, keeping the newest few and ignoring other files', () => {
  const tmp = tempDbPath();
  const names = ['20261028-030000', '20261027-030000', '20261026-030000', '20261001-030000', '20260901-030000', '20260801-030000'];
  for (const n of names) fs.writeFileSync(path.join(tmp.dir, `tendrelark-${n}.db.gz.enc`), 'x');
  fs.writeFileSync(path.join(tmp.dir, 'notes.txt'), 'keep me');
  fs.writeFileSync(path.join(tmp.dir, 'tendrelark-garbage.db.gz'), 'keep me too');

  const now = new Date('2026-10-28T12:00:00Z');
  assert.deepEqual(listBackups(tmp.dir).map((b) => b.name.slice(11, 26)), names);
  const removed = pruneBackups(tmp.dir, { keepDays: 14, minKeep: 3, now });
  assert.deepEqual(removed.map((n) => n.slice(11, 26)), ['20261001-030000', '20260901-030000', '20260801-030000']);
  assert.ok(fs.existsSync(path.join(tmp.dir, 'notes.txt')));
  assert.ok(fs.existsSync(path.join(tmp.dir, 'tendrelark-garbage.db.gz')));

  // Even when everything is old, the newest minKeep survive.
  assert.equal(pruneBackups(tmp.dir, { keepDays: 1, minKeep: 2, now: new Date('2027-06-01T00:00:00Z') }).length, 1);
  assert.equal(listBackups(tmp.dir).length, 2);
  tmp.cleanup();
});

test('the nightly job records success and failure, never throws, and schedules retries', async () => {
  const tmp = tempDbPath();
  const db = liveDb(tmp);
  const config = testConfig({ BACKUP_DIR: path.join(tmp.dir, 'nightly'), BACKUP_PASSPHRASE: PASS, BACKUP_AT_UTC: '03:00', BACKUP_KEEP_DAYS: '7' });
  const at = (h, m, day = 28) => new Date(Date.UTC(2026, 9, day, h, m));

  assert.equal(isBackupDue(db, config, at(2, 59)), false); // before the time
  assert.equal(isBackupDue(db, config, at(3, 0)), true);
  assert.equal(isBackupDue(db, testConfig(), at(5, 0)), false); // no BACKUP_DIR: switched off

  const ok = await runBackupJob({ db, config, now: at(3, 0) });
  assert.equal(ok.ok, true);
  assert.equal(isBackupDue(db, config, at(9, 0)), false); // done for today
  assert.equal(isBackupDue(db, config, at(3, 0, 29)), true); // tomorrow
  const status = readBackupStatus(db, config, at(15, 0));
  assert.equal(status.last.ok, true);
  assert.equal(status.hoursSinceLastSuccess, 12);
  assert.equal(JSON.stringify(status).includes(PASS), false, 'the passphrase must never be reported');

  // A failure (the folder cannot be created) is recorded and retried after 30 minutes, up to four times a day.
  const blocker = path.join(tmp.dir, 'a-file');
  fs.writeFileSync(blocker, 'x');
  const broken = testConfig({ BACKUP_DIR: path.join(blocker, 'sub'), BACKUP_PASSPHRASE: PASS });
  const lines = [];
  const bad = await runBackupJob({ db, config: broken, now: at(3, 0, 30), log: (m) => lines.push(m) });
  assert.equal(bad.ok, false);
  assert.ok(lines.some((l) => /Backup FAILED/.test(l)));
  assert.equal(isBackupDue(db, broken, at(3, 10, 30)), false); // too soon
  assert.equal(isBackupDue(db, broken, at(3, 30, 30)), true); // retry
  for (const m of [30, 60, 90]) await runBackupJob({ db, config: broken, now: at(3, m, 30) });
  assert.equal(readBackupStatus(db, broken, at(6, 0, 30)).last.attempts, 4);
  assert.equal(isBackupDue(db, broken, at(8, 0, 30)), false); // gave up for today
  tmp.cleanup();
});

test('the health report shows backups without any secret', async () => {
  const tmp = tempDbPath();
  const db = liveDb(tmp, 1);
  const config = testConfig({ BACKUP_DIR: path.join(tmp.dir, 'n'), BACKUP_PASSPHRASE: PASS });
  assert.deepEqual(buildHealth(db, config).backup, { configured: true, encrypted: true, last: null, lastSuccessAt: null, hoursSinceLastSuccess: null });
  await runBackupJob({ db, config });
  const h = buildHealth(db, config).backup;
  assert.equal(h.last.ok, true);
  assert.match(h.last.file, /^tendrelark-\d{8}-\d{6}\.db\.gz\.enc$/);
  assert.equal(JSON.stringify(h).includes(tmp.dir), false, 'no file system paths');
  assert.equal(buildHealth(db, testConfig()).backup.configured, false);
  tmp.cleanup();
});

test('backup settings are validated', () => {
  assert.throws(() => testConfig({ BACKUP_PASSPHRASE: 'short' }), /at least 12 characters/);
  assert.throws(() => testConfig({ BACKUP_AT_UTC: '3am' }), /BACKUP_AT_UTC/);
  const c = testConfig({ BACKUP_DIR: 'backups', BACKUP_KEEP_DAYS: '30' });
  assert.ok(path.isAbsolute(c.backup.dir));
  assert.equal(c.backup.keepDays, 30);
  assert.equal(testConfig().backup.dir, '');
});
