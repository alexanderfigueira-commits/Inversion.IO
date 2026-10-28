import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { recordBoot, setMeta } from '../src/db/index.js';
import { runDailyTedImport } from '../src/jobs/daily-ted.js';
import { addDays, todayIso } from '../src/lib/dates.js';
import { LAST_BACKUP_KEY, LAST_BACKUP_OK_KEY } from '../src/db/backup.js';
import { startApp, startFakeTed, tedNotice, tempDbPath } from './helpers.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const run = (args) =>
  new Promise((resolve) => {
    execFile(process.execPath, ['bin/check-production.js', ...args], { cwd: ROOT, timeout: 30_000 }, (err, stdout, stderr) => resolve({ code: err ? (err.code ?? 1) : 0, stdout, stderr }));
  });

// A mailer that claims delivery, so the daily report counts as emailed.
const deliveringMailer = { mode: 'smtp', send: async () => ({ delivered: true }) };

async function healthyApp(t, overrides = {}) {
  const ted = await startFakeTed([tedNotice(1, { country: 'PRT', date: addDays(todayIso(), -1) }), tedNotice(2, { country: 'BEL', date: addDays(todayIso(), -1) })]);
  const app = await startApp({ TED_API_URL: ted.url, ...overrides });
  t.after(async () => {
    await app.close();
    await ted.close();
  });
  recordBoot(app.db); // the real server records its first start at boot
  const cycle = await runDailyTedImport({ db: app.db, config: app.config, mailer: deliveringMailer, sleep: async () => {} });
  assert.equal(cycle.done, true);
  return app;
}

test('an empty site fails the check and says why', async (t) => {
  const app = await startApp();
  t.after(() => app.close());
  const r = await run([app.base]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /No TED notices are stored/);
  assert.match(r.stderr, /No ingestion run has ever finished successfully/);
});

test('a site with stored notices, a finished daily cycle and an emailed report passes', async (t) => {
  const app = await healthyApp(t);
  const r = await run([app.base]);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /TED notices stored:\s+2/);
  assert.match(r.stdout, /Daily import cycle:\s+\d{4}-\d{2}-\d{2} done, 1 attempt\(s\), report emailed/);
  assert.match(r.stdout, /Looks healthy/);
  assert.match(r.stdout, /no backups are configured/);
});

test('an import that returned nothing or a report that was never emailed is flagged', async (t) => {
  const ted = await startFakeTed([]);
  const app = await startApp({ TED_API_URL: ted.url });
  t.after(async () => {
    await app.close();
    await ted.close();
  });
  await runDailyTedImport({ db: app.db, config: app.config, mailer: app.mailer, sleep: async () => {} });
  const r = await run([app.base]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /returned no notices/);
  assert.match(r.stderr, /did not complete after 7 attempt/);
  assert.match(r.stderr, /was not emailed/);
});

test('persistence is proven only by the same database, no lost notices, and a restart in between', async (t) => {
  const app = await healthyApp(t);
  const tmp = tempDbPath();
  const baseline = path.join(tmp.dir, 'before.json');

  assert.equal((await run([app.base, '--save', baseline])).code, 0);
  const saved = JSON.parse(fs.readFileSync(baseline, 'utf8'));
  assert.equal(saved.noticesStored, 2);

  const noRestart = await run([app.base, '--compare', baseline]);
  assert.equal(noRestart.code, 1);
  assert.match(noRestart.stderr, /start counter did not increase/);

  recordBoot(app.db); // the service restarts
  const ok = await run([app.base, '--compare', baseline]);
  assert.equal(ok.code, 0, ok.stderr);
  assert.match(ok.stdout, /Persistence confirmed/);
  assert.match(ok.stdout, /Restarts since baseline: 1/);

  app.db.prepare("DELETE FROM ted_notices WHERE publication_number = '1-2026'").run(); // a notice vanishes
  recordBoot(app.db);
  const lost = await run([app.base, '--compare', baseline]);
  assert.equal(lost.code, 1);
  assert.match(lost.stderr, /Notices went down from 2 to 1/);

  setMeta(app.db, 'db_created_at', '2030-01-01T00:00:00.000Z'); // a brand new database appeared
  recordBoot(app.db);
  const replaced = await run([app.base, '--compare', baseline]);
  assert.match(replaced.stderr, /different one/);
  tmp.cleanup();
});

test('configured backups that are stale or failing are flagged, and healthy ones pass', async (t) => {
  const tmp = tempDbPath();
  const app = await healthyApp(t, { BACKUP_DIR: tmp.dir, BACKUP_PASSPHRASE: 'a long test passphrase' });

  assert.match((await run([app.base])).stderr, /Backups are configured but none has succeeded yet/);

  setMeta(app.db, LAST_BACKUP_OK_KEY, new Date(Date.now() - 50 * 3_600_000).toISOString());
  assert.match((await run([app.base])).stderr, /last good backup was 50 hours ago/);

  const now = new Date().toISOString();
  setMeta(app.db, LAST_BACKUP_OK_KEY, now);
  setMeta(app.db, LAST_BACKUP_KEY, JSON.stringify({ date: now.slice(0, 10), at: now, ok: false, error: 'disk full', attempts: 1 }));
  assert.match((await run([app.base])).stderr, /latest backup attempt failed: disk full/);

  setMeta(app.db, LAST_BACKUP_KEY, JSON.stringify({ date: now.slice(0, 10), at: now, ok: true, error: null, attempts: 1 }));
  const good = await run([app.base]);
  assert.equal(good.code, 0, good.stderr);
  assert.match(good.stdout, /Backups:\s+encrypted, last good/);
  tmp.cleanup();
});

test('an unreachable site and a missing address are reported plainly', async () => {
  const down = await run(['http://127.0.0.1:1']);
  assert.equal(down.code, 1);
  assert.match(down.stderr, /Could not read http:\/\/127\.0\.0\.1:1\/healthz/);
  const usage = await run([]);
  assert.equal(usage.code, 2);
  assert.match(usage.stderr, /Usage: node bin\/check-production\.js/);
});
