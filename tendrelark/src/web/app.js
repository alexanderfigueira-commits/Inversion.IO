import express from 'express';
import { describeRequestError, noAlerts } from '../lib/alerts.js';
import { createRateLimiter } from '../lib/security.js';
import { publicRoutes } from './routes/public.js';
import { newsletterRoutes } from './routes/newsletter.js';
import { adminRoutes } from './routes/admin.js';
import { systemRoutes } from './routes/system.js';
import { PUBLIC_DIR } from './assets.js';
import { errorPage, notFoundPage } from './views/pages.js';

const CSP = [
  "default-src 'self'",
  "script-src 'none'",
  "style-src 'self'",
  "img-src 'self' data:",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
].join('; ');

/** Builds the Express app. Everything it needs is passed in, so tests can run it on a temp database. */
export function createApp({ config, db, mailer, log = console, alerter = noAlerts }) {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', config.trustProxy);

  const ctx = {
    config,
    db,
    mailer,
    log,
    limits: {
      signup: createRateLimiter({ windowMs: 3600_000, max: 10 }),
      contact: createRateLimiter({ windowMs: 3600_000, max: 5 }),
      adminFailures: createRateLimiter({ windowMs: 15 * 60_000, max: 10 }),
    },
  };

  app.use((req, res, next) => {
    res.set({
      'Content-Security-Policy': CSP,
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
      'Cross-Origin-Opener-Policy': 'same-origin',
    });
    if (config.production) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    // Log path only. Query strings can carry confirmation and unsubscribe tokens.
    if (log.info && !config.quietLogs) {
      const started = Date.now();
      res.on('finish', () => log.info(`${req.method} ${req.path} ${res.statusCode} ${Date.now() - started}ms`));
    }
    next();
  });

  app.use(express.static(PUBLIC_DIR, { maxAge: config.production ? '1h' : 0, index: false }));
  app.use(express.urlencoded({ extended: false, limit: '20kb' }));
  app.use((req, res, next) => {
    res.set('Cache-Control', 'no-cache');
    next();
  });

  publicRoutes(app, ctx);
  newsletterRoutes(app, ctx);
  systemRoutes(app, ctx);
  adminRoutes(app, ctx);

  app.use((req, res) => {
    res.status(404).type('html').send(notFoundPage({ config, path: req.path }).toString());
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status && err.status < 500 ? err.status : 500;
    log.error?.(`Unhandled error on ${req.method} ${req.path}: ${err.stack || err}`);
    if (status >= 500) alerter.alert('http-500', `Server error on ${req.method} ${req.path}`, describeRequestError(req, err));
    if (res.headersSent) return;
    res.status(status).type('html').send(errorPage({ config, path: req.path }).toString());
  });

  return app;
}
