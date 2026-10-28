import crypto from 'node:crypto';
import fs from 'node:fs';
import { once } from 'node:events';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import zlib from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';
import { getMeta, schemaVersion, setMeta } from './index.js';

// File layout of an encrypted backup:  "TLBK1\n" | salt (16) | iv (12) | AES-256-GCM ciphertext of the gzipped
// database | auth tag (16). The tag at the end means a wrong passphrase or any damaged byte is detected.
const MAGIC = Buffer.from('TLBK1\n');
const HEADER = MAGIC.length + 16 + 12;
const TAG = 16;
const NAME = /^tendrelark-(\d{8})-(\d{6})\.db\.gz(\.enc)?$/;

export const LAST_BACKUP_KEY = 'last_backup';
export const LAST_BACKUP_OK_KEY = 'last_backup_ok_at';

const stamp = (d) => d.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
const fromStamp = (date, time) => `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4, 6)}.000Z`;

function deriveKey(passphrase, salt) {
  return crypto.scryptSync(passphrase, salt, 32);
}

/** Opens a database copy read only and reports whether it is sound and what it holds. */
function inspectCopy(file) {
  const copy = new DatabaseSync(file, { readOnly: true });
  try {
    const integrity = copy.prepare('PRAGMA integrity_check').get().integrity_check;
    if (integrity !== 'ok') throw new Error(`The copy failed its integrity check: ${integrity}`);
    const count = (table) => {
      try {
        return copy.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
      } catch {
        return 0;
      }
    };
    return { schemaVersion: schemaVersion(copy), notices: count('ted_notices'), subscribers: count('subscribers'), issues: count('newsletter_issues') };
  } finally {
    copy.close();
  }
}

/** Writes gzip (and optionally encryption) of `source` to `target`. */
async function pack(source, target, passphrase) {
  const out = fs.createWriteStream(target, { mode: 0o600 });
  if (!passphrase) {
    await pipeline(fs.createReadStream(source), zlib.createGzip({ level: 9 }), out);
    return;
  }
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveKey(passphrase, salt), iv);
  out.write(Buffer.concat([MAGIC, salt, iv]));
  await pipeline(fs.createReadStream(source), zlib.createGzip({ level: 9 }), cipher, out, { end: false });
  out.end(cipher.getAuthTag());
  await once(out, 'finish');
}

/** Reverses pack() into `target`. Throws a plain message for a wrong passphrase or a damaged file. */
async function unpack(file, target, passphrase) {
  const encrypted = isEncrypted(file);
  const dest = fs.createWriteStream(target, { mode: 0o600 });
  try {
    if (!encrypted) {
      await pipeline(fs.createReadStream(file), zlib.createGunzip(), dest);
      return;
    }
    if (!passphrase) throw new Error('This backup is encrypted. Set BACKUP_PASSPHRASE to the passphrase it was made with.');
    const size = fs.statSync(file).size;
    if (size < HEADER + TAG + 1) throw new Error('The backup file is too short to be valid.');
    const fd = fs.openSync(file, 'r');
    const head = Buffer.alloc(HEADER);
    const tag = Buffer.alloc(TAG);
    fs.readSync(fd, head, 0, HEADER, 0);
    fs.readSync(fd, tag, 0, TAG, size - TAG);
    fs.closeSync(fd);
    const decipher = crypto.createDecipheriv('aes-256-gcm', deriveKey(passphrase, head.subarray(MAGIC.length, MAGIC.length + 16)), head.subarray(MAGIC.length + 16));
    decipher.setAuthTag(tag);
    await pipeline(fs.createReadStream(file, { start: HEADER, end: size - TAG - 1 }), decipher, zlib.createGunzip(), dest);
  } catch (err) {
    dest.destroy();
    fs.rmSync(target, { force: true });
    if (/unable to authenticate|Unsupported state/i.test(err.message)) throw new Error('Wrong passphrase, or the backup file is damaged.');
    if (/incorrect header check|unexpected end of file|invalid/i.test(err.message)) throw new Error('The backup file is damaged or is not a Tendrelark backup.');
    throw err;
  }
}

export function isEncrypted(file) {
  if (file.endsWith('.enc')) return true;
  try {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(MAGIC.length);
    fs.readSync(fd, buf, 0, MAGIC.length, 0);
    fs.closeSync(fd);
    return buf.equals(MAGIC);
  } catch {
    return false;
  }
}

/**
 * Proves a backup file works the way a real restore would: unpack it to a scratch file, open it, run the
 * integrity check and count what it holds. Leaves nothing behind.
 */
export async function verifyBackup(file, passphrase = '') {
  const scratch = path.join(path.dirname(file), `.verify-${process.pid}-${Date.now()}.db`);
  try {
    await unpack(file, scratch, passphrase);
    return inspectCopy(scratch);
  } finally {
    fs.rmSync(scratch, { force: true });
  }
}

/**
 * Takes a consistent snapshot of the live database (safe while the app is running), compresses it,
 * encrypts it when a passphrase is given, and then restores it to a scratch file to prove it is good.
 * A backup that cannot be restored is reported as a failure, not a success.
 */
export async function createBackup(db, { dir, passphrase = '', now = new Date() }) {
  if (!dir) throw new Error('No backup folder given. Set BACKUP_DIR or pass --dir.');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const snapshot = path.join(dir, `.snapshot-${process.pid}-${Date.now()}.db`);
  const name = `tendrelark-${stamp(now)}.db.gz${passphrase ? '.enc' : ''}`;
  const final = path.join(dir, name);
  const partial = `${final}.partial`;
  try {
    db.prepare('VACUUM INTO ?').run(snapshot);
    const before = inspectCopy(snapshot);
    await pack(snapshot, partial, passphrase);
    fs.renameSync(partial, final);
    const restored = await verifyBackup(final, passphrase);
    if (restored.notices !== before.notices || restored.subscribers !== before.subscribers || restored.schemaVersion !== before.schemaVersion) {
      throw new Error('The backup restored with different contents from the database it was taken from.');
    }
    return { file: final, name, bytes: fs.statSync(final).size, encrypted: Boolean(passphrase), ...restored };
  } catch (err) {
    fs.rmSync(final, { force: true });
    throw err;
  } finally {
    fs.rmSync(snapshot, { force: true });
    fs.rmSync(partial, { force: true });
  }
}

/** Backups in a folder, newest first. Only files named like our own are considered. */
export function listBackups(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .map((name) => ({ name, m: NAME.exec(name) }))
    .filter((x) => x.m)
    .map(({ name, m }) => ({ name, file: path.join(dir, name), takenAt: fromStamp(m[1], m[2]), bytes: fs.statSync(path.join(dir, name)).size, encrypted: Boolean(m[3]) }))
    .sort((a, b) => b.takenAt.localeCompare(a.takenAt));
}

/** Deletes backups older than keepDays, going by the time in the file name. The newest minKeep are always kept. */
export function pruneBackups(dir, { keepDays = 14, minKeep = 3, now = new Date() } = {}) {
  const cutoff = now.getTime() - keepDays * 86_400_000;
  const removed = [];
  listBackups(dir).forEach((b, i) => {
    if (i >= minKeep && Date.parse(b.takenAt) < cutoff) {
      fs.rmSync(b.file, { force: true });
      removed.push(b.name);
    }
  });
  return removed;
}

/**
 * Restores a backup to `to`. It unpacks to a scratch file next to it, checks the result, and only then moves it
 * into place, so a bad backup never replaces a good database. Stop the app before restoring over a live database.
 */
export async function restoreBackup({ file, to, passphrase = '', force = false }) {
  if (!fs.existsSync(file)) throw new Error(`Backup file not found: ${file}`);
  if (fs.existsSync(to) && !force) throw new Error(`${to} already exists. Stop the app and pass --force to replace it, or restore to a new path.`);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  const scratch = `${to}.restoring`;
  try {
    await unpack(file, scratch, passphrase);
    const info = inspectCopy(scratch);
    for (const suffix of ['', '-wal', '-shm']) fs.rmSync(`${to}${suffix}`, { force: true }); // leftovers would corrupt the restored file
    fs.renameSync(scratch, to);
    return info;
  } finally {
    fs.rmSync(scratch, { force: true });
  }
}

/** Records the outcome in the database so /healthz and the production check can report it. */
export function recordBackupResult(db, { ok, file = null, bytes = null, error = null, attempts = 1, now = new Date() }) {
  const at = now.toISOString();
  setMeta(db, LAST_BACKUP_KEY, JSON.stringify({ date: at.slice(0, 10), at, ok, file: file ? path.basename(file) : null, bytes, error: error ? String(error).slice(0, 300) : null, attempts }));
  if (ok) setMeta(db, LAST_BACKUP_OK_KEY, at);
}

export function readBackupStatus(db, config, now = new Date()) {
  let last = null;
  try {
    last = JSON.parse(getMeta(db, LAST_BACKUP_KEY) || 'null');
  } catch {
    last = null;
  }
  const okAt = getMeta(db, LAST_BACKUP_OK_KEY);
  return {
    configured: Boolean(config.backup.dir),
    encrypted: Boolean(config.backup.passphrase),
    last,
    lastSuccessAt: okAt,
    hoursSinceLastSuccess: okAt ? Math.round(((now - Date.parse(okAt)) / 3_600_000) * 10) / 10 : null,
  };
}

/** True when today's backup time has passed and today has no good backup yet. A failure is retried a few times. */
export function isBackupDue(db, config, now = new Date()) {
  if (!config.backup.dir) return false;
  const [h, m] = config.backup.atUtc.split(':').map(Number);
  if (now.getUTCHours() * 60 + now.getUTCMinutes() < h * 60 + m) return false;
  const { last } = readBackupStatus(db, config, now);
  if (!last || last.date !== now.toISOString().slice(0, 10)) return true;
  return !last.ok && last.attempts < 4 && now - Date.parse(last.at) >= 30 * 60_000;
}

/** One scheduled run: back up, prune, record. Never throws, so a failed backup cannot take the app down. */
export async function runBackupJob({ db, config, log = () => {}, now = new Date() }) {
  const { last } = readBackupStatus(db, config, now);
  const attempts = last && last.date === now.toISOString().slice(0, 10) && !last.ok ? last.attempts + 1 : 1;
  try {
    const result = await createBackup(db, { dir: config.backup.dir, passphrase: config.backup.passphrase, now });
    const removed = pruneBackups(config.backup.dir, { keepDays: config.backup.keepDays, now });
    recordBackupResult(db, { ok: true, file: result.file, bytes: result.bytes, attempts, now });
    log(`Backup ${result.name} (${Math.round(result.bytes / 1024)} KB, ${result.notices} notices, ${result.subscribers} subscribers) verified by restoring it.${removed.length ? ` Removed ${removed.length} old.` : ''}`);
    return { ok: true, ...result, removed };
  } catch (err) {
    recordBackupResult(db, { ok: false, error: err.message, attempts, now });
    log(`Backup FAILED: ${err.message}`);
    return { ok: false, error: err.message };
  }
}
