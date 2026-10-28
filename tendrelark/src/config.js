import path from 'node:path';

const COUNTRY_NAMES = {
  PRT: 'Portugal',
  LUX: 'Luxembourg',
  BEL: 'Belgium',
  EU: 'European Union',
};

export { COUNTRY_NAMES };

const truthy = (v) => ['1', 'true', 'yes', 'on'].includes(String(v ?? '').toLowerCase());

const int = (v, fallback) => {
  const n = Number.parseInt(v ?? '', 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

/**
 * Reads settings from the environment. Pass `overrides` to build a config for tests.
 * In production we fail fast on anything that would quietly lose data or weaken security.
 */
export function loadConfig(overrides = {}) {
  const e = { ...process.env, ...overrides };
  const production = e.NODE_ENV === 'production';
  const problems = [];

  const databasePath = e.DATABASE_PATH || (production ? '' : './data/tendrelark.db');
  if (production && !e.DATABASE_PATH) {
    problems.push(
      'DATABASE_PATH is required in production and must point at a persistent volume. ' +
        'Without it the database would sit on the container disk and be wiped on every deploy.',
    );
  }
  if (production && databasePath === ':memory:') {
    problems.push('DATABASE_PATH cannot be :memory: in production.');
  }

  const appSecret = e.APP_SECRET || (production ? '' : 'dev-only-secret-dev-only-secret-dev-only');
  if (production && appSecret.length < 32) {
    problems.push('APP_SECRET is required in production and must be at least 32 characters.');
  }

  const siteUrl = (e.SITE_URL || (production ? 'https://www.tendrelark.eu' : 'http://localhost:3000')).replace(/\/+$/, '');
  if (production && !siteUrl.startsWith('https://')) {
    problems.push('SITE_URL must start with https:// in production.');
  }

  const backupAt = e.BACKUP_AT_UTC || '03:00';
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(backupAt)) problems.push('BACKUP_AT_UTC must look like 03:00 (24 hour clock, UTC).');
  if (e.BACKUP_PASSPHRASE && e.BACKUP_PASSPHRASE.length < 12) problems.push('BACKUP_PASSPHRASE must be at least 12 characters. Backups contain subscriber email addresses.');

  const dailyAt = e.TED_DAILY_AT_UTC || '06:00';
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(dailyAt)) problems.push('TED_DAILY_AT_UTC must look like 06:00 (24 hour clock, UTC).');

  if (problems.length) {
    throw new Error(`Invalid configuration:\n - ${problems.join('\n - ')}`);
  }

  const countries = (e.TED_COUNTRIES || 'PRT,LUX,BEL')
    .split(',')
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean);

  return {
    production,
    port: int(e.PORT, 3000),
    siteUrl,
    databasePath: databasePath === ':memory:' ? databasePath : path.resolve(databasePath),
    appSecret,
    trustProxy: e.TRUST_PROXY ? (Number.isNaN(Number(e.TRUST_PROXY)) ? e.TRUST_PROXY : Number(e.TRUST_PROXY)) : 0,
    admin: {
      user: e.ADMIN_USER || 'editor',
      password: e.ADMIN_PASSWORD || '',
    },
    contact: {
      email: e.CONTACT_EMAIL || 'support@tendrelark.eu',
      legalName: e.LEGAL_ENTITY_NAME || 'Tendrelark',
      legalDetails: e.LEGAL_ENTITY_DETAILS || '',
    },
    mail: {
      smtpUrl: e.SMTP_URL || '',
      from: e.MAIL_FROM || 'Tendrelark <support@tendrelark.eu>',
      // 'memory' is used by tests so nothing is printed or sent.
      transport: e.MAIL_TRANSPORT || '',
    },
    ted: {
      apiUrl: e.TED_API_URL || 'https://api.ted.europa.eu/v3/notices/search',
      countries,
      fields: e.TED_FIELDS ? e.TED_FIELDS.split(',').map((f) => f.trim()).filter(Boolean) : null,
      overlapDays: int(e.TED_OVERLAP_DAYS, 3),
      backfillDays: int(e.TED_BACKFILL_DAYS, 30),
      pageSize: int(e.TED_PAGE_SIZE, 100),
      retryBaseMs: int(e.TED_RETRY_BASE_MS, 1000),
    },
    scheduler: {
      enabled: truthy(e.ENABLE_SCHEDULER),
      sourceIntervalMinutes: int(e.SOURCE_CHECK_INTERVAL_MINUTES, 1440),
    },
    retention: {
      emailLogDays: Math.max(7, int(e.EMAIL_LOG_RETENTION_DAYS, 90)),
      unconfirmedSignupDays: Math.max(3, int(e.RETENTION_UNCONFIRMED_DAYS, 30)),
      enquiryDays: Math.max(30, int(e.RETENTION_ENQUIRY_DAYS, 365)),
    },
    // Where operational alerts go, and how long to wait before sending another of the same kind.
    alerts: {
      to: e.ALERT_EMAIL || e.TED_REPORT_EMAIL || 'support@tendrelark.eu',
      throttleMinutes: Math.max(1, int(e.ALERT_THROTTLE_MINUTES, 15)),
    },
    // Nightly backups of the database. Off unless BACKUP_DIR is set. With a passphrase they are encrypted.
    backup: {
      dir: e.BACKUP_DIR ? path.resolve(e.BACKUP_DIR) : '',
      passphrase: e.BACKUP_PASSPHRASE || '',
      keepDays: Math.max(1, int(e.BACKUP_KEEP_DAYS, 30)),
      atUtc: backupAt,
    },
    // The daily TED import: one scheduled run a day at dailyAtUtc, retried every retryIntervalMinutes
    // for up to retryWindowMinutes until a run completes, then a log email to reportTo.
    tedDaily: {
      dailyAtUtc: dailyAt,
      retryIntervalMinutes: Math.max(1, int(e.TED_RETRY_INTERVAL_MINUTES, 10)),
      retryWindowMinutes: int(e.TED_RETRY_WINDOW_MINUTES, 60),
      reportTo: e.TED_REPORT_EMAIL || 'support@tendrelark.eu',
    },
  };
}
