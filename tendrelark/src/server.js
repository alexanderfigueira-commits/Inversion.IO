import { loadConfig } from './config.js';
import { openDatabase, recordBoot, schemaVersion } from './db/index.js';
import { seedSources } from './db/seed.js';
import { createMailer } from './lib/mailer.js';
import { startScheduler } from './jobs/scheduler.js';
import { createApp } from './web/app.js';

const log = {
  info: (m) => console.log(`${new Date().toISOString()} ${m}`),
  error: (m) => console.error(`${new Date().toISOString()} ${m}`),
};

let config;
try {
  config = loadConfig();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

const db = openDatabase(config.databasePath);
seedSources(db);
const boot = recordBoot(db);
const mailer = createMailer(config, db, { log });

log.info(`Database: ${config.databasePath} (schema v${schemaVersion(db)}, created ${boot.dbCreatedAt}, start #${boot.bootCount})`);
if (config.production && (config.databasePath.startsWith('/tmp') || config.databasePath.startsWith(process.cwd()))) {
  log.error(`WARNING: the database is inside the app directory or /tmp (${config.databasePath}). On most hosts that disk is wiped on every deploy. Mount a persistent volume and point DATABASE_PATH at it.`);
}
if (mailer.mode === 'console') log.error('WARNING: SMTP_URL is not set. Confirmation emails, newsletters and the daily TED report are logged, not delivered.');
if (!config.admin.password) log.info('Admin area is off (set ADMIN_PASSWORD to enable /admin).');

const app = createApp({ config, db, mailer, log });
const server = app.listen(config.port, () => log.info(`Tendrelark listening on port ${config.port} (${config.siteUrl})`));

const stopScheduler = config.scheduler.enabled ? startScheduler({ config, db, mailer, log }) : null;
log.info(
  config.scheduler.enabled
    ? `Scheduler on: daily TED import at ${config.tedDaily.dailyAtUtc} UTC (retry every ${config.tedDaily.retryIntervalMinutes} min for up to ${config.tedDaily.retryWindowMinutes} min), report to ${config.tedDaily.reportTo}.`
    : 'Scheduler off: run `npm run ted:daily` and `npm run sources:verify` yourself, or set ENABLE_SCHEDULER=true.',
);

function shutdown(signal) {
  log.info(`${signal} received, shutting down.`);
  stopScheduler?.();
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
