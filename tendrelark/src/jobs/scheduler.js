import { isBackupDue, runBackupJob } from '../db/backup.js';
import { noAlerts } from '../lib/alerts.js';
import { purgeOldEmailLogs } from '../privacy.js';
import { verifySources } from '../sources/verify.js';
import { isDailyRunDue, runDailyTedImport } from './daily-ted.js';

/**
 * Background jobs inside the web process, both unref'd so they never hold the process open.
 *
 * Daily TED import: a once a minute check starts the cycle when today's scheduled time has passed and
 * no cycle has run today. Because it keys off the stored date and not a timer, a restart or a late
 * start catches up instead of skipping the day, and a second cycle can never start while one runs.
 * Source checks run on a plain interval.
 */
export function startScheduler({ config, db, mailer, log = console, alerter = noAlerts }) {
  const timers = [];
  let tedRunning = false;

  const tedTick = async () => {
    if (tedRunning || !isDailyRunDue(db, config)) return;
    tedRunning = true;
    try {
      log.info?.('[scheduler] starting the daily TED import');
      const r = await runDailyTedImport({ db, config, mailer, log: (m) => log.info?.(`[ted] ${m}`) });
      log.info?.(`[scheduler] daily TED import ${r.done ? 'done' : 'NOT done'} after ${r.attempts.length} attempt(s). Report ${r.emailed ? 'emailed' : 'not emailed'}.`);
    } catch (err) {
      log.error?.(`[scheduler] daily TED import crashed: ${err.stack || err.message}`);
      alerter.alert('ted-crash', 'The daily TED import crashed', err.stack || err.message);
    } finally {
      tedRunning = false;
    }
  };
  timers.push(setTimeout(tedTick, 30_000).unref(), setInterval(tedTick, 60_000).unref());

  let backupRunning = false;
  const backupTick = async () => {
    if (backupRunning || !isBackupDue(db, config)) return;
    backupRunning = true;
    try {
      const result = await runBackupJob({ db, config, log: (m) => log.info?.(`[backup] ${m}`) });
      if (!result.ok) alerter.alert('backup-failed', 'The nightly backup failed', `${result.error}\n\nIt will be retried every 30 minutes, up to four times today.`);
    } finally {
      backupRunning = false;
    }
  };
  timers.push(setTimeout(backupTick, 45_000).unref(), setInterval(backupTick, 60_000).unref());

  const purgeTick = () => {
    try {
      const n = purgeOldEmailLogs(db, config.retention.emailLogDays);
      if (n) log.info?.(`[privacy] removed ${n} email log rows older than ${config.retention.emailLogDays} days`);
    } catch (err) {
      log.error?.(`[scheduler] email log purge failed: ${err.message}`);
    }
  };
  timers.push(setTimeout(purgeTick, 90_000).unref(), setInterval(purgeTick, 6 * 3_600_000).unref());

  const sourceTick = async () => {
    try {
      await verifySources(db, { log: (m) => log.info?.(`[sources] ${m}`) });
    } catch (err) {
      log.error?.(`[scheduler] source checks failed: ${err.message}`);
      alerter.alert('source-check-crash', 'The source checks crashed', err.stack || err.message);
    }
  };
  timers.push(setTimeout(sourceTick, 60_000).unref(), setInterval(sourceTick, config.scheduler.sourceIntervalMinutes * 60_000).unref());

  return () => timers.forEach((t) => {
    clearTimeout(t);
    clearInterval(t);
  });
}
