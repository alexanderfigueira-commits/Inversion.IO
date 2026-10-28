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
export function startScheduler({ config, db, mailer, log = console }) {
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
    } finally {
      tedRunning = false;
    }
  };
  timers.push(setTimeout(tedTick, 30_000).unref(), setInterval(tedTick, 60_000).unref());

  const sourceTick = async () => {
    try {
      await verifySources(db, { log: (m) => log.info?.(`[sources] ${m}`) });
    } catch (err) {
      log.error?.(`[scheduler] source checks failed: ${err.message}`);
    }
  };
  timers.push(setTimeout(sourceTick, 60_000).unref(), setInterval(sourceTick, config.scheduler.sourceIntervalMinutes * 60_000).unref());

  return () => timers.forEach((t) => {
    clearTimeout(t);
    clearInterval(t);
  });
}
