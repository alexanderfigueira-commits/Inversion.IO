import { getMeta, schemaVersion } from '../../db/index.js';
import { LAST_CYCLE_KEY } from '../../jobs/daily-ted.js';
import { xml } from '../../lib/html.js';
import { listPublicIssues } from '../../newsletter/issues.js';
import { WATERMARK_KEY, lastSuccessfulRun, latestRuns } from '../../ted/ingest.js';
import { tedStats } from '../../tenders.js';
import { listSources, effectiveStatus } from '../../sources/verify.js';

/**
 * Everything /healthz reports is already public (notice counts, source status) or harmless. It carries
 * no subscriber data and no file paths. `npm run check:production` reads it to prove that TED
 * notices are being stored and are still there after a redeploy.
 */
function parseCycle(text) {
  try {
    return JSON.parse(text || 'null');
  } catch {
    return null;
  }
}

export function buildHealth(db, config, now = new Date()) {
  const stats = tedStats(db);
  const last = latestRuns(db, 1)[0] ?? null;
  const lastOk = lastSuccessfulRun(db);
  const hoursSince = (iso) => (iso ? Math.round(((now - Date.parse(iso)) / 3_600_000) * 10) / 10 : null);
  return {
    status: 'ok',
    time: now.toISOString(),
    database: {
      schemaVersion: schemaVersion(db),
      createdAt: getMeta(db, 'db_created_at'),
      startCount: Number(getMeta(db, 'boot_count') || 0),
      lastStartAt: getMeta(db, 'last_boot_at'),
    },
    ted: {
      noticesStored: stats.notices,
      byCountry: Object.fromEntries(stats.byCountry.map((c) => [c.country, c.n])),
      newestPublicationDate: stats.latest_publication,
      oldestFirstSeenAt: stats.oldest_seen,
      watermark: getMeta(db, WATERMARK_KEY),
      lastRun: last && { id: last.id, status: last.status, startedAt: last.started_at, finishedAt: last.finished_at, fetched: last.fetched, inserted: last.inserted, updated: last.updated, unchanged: last.unchanged, failed: last.failed },
      lastSuccessAt: lastOk?.finished_at ?? null,
      hoursSinceLastSuccess: hoursSince(lastOk?.finished_at),
      schedulerEnabled: config.scheduler.enabled,
      dailyCycle: parseCycle(getMeta(db, LAST_CYCLE_KEY)),
    },
    sources: listSources(db).map((s) => ({ slug: s.slug, status: effectiveStatus(s), lastCheckedAt: s.last_checked_at, lastVerifiedAt: s.last_verified_at })),
  };
}

export function systemRoutes(app, { config, db, log }) {
  app.get('/healthz', (req, res) => {
    try {
      res.set('Cache-Control', 'no-store').json(buildHealth(db, config));
    } catch (err) {
      log.error?.(`Health check failed: ${err.message}`);
      res.status(503).set('Cache-Control', 'no-store').json({ status: 'error' });
    }
  });

  app.get('/robots.txt', (req, res) => {
    res.type('text/plain').send(
      ['User-agent: *', 'Allow: /', 'Disallow: /admin', 'Disallow: /newsletter/confirm', 'Disallow: /newsletter/unsubscribe', '', `Sitemap: ${config.siteUrl}/sitemap.xml`, ''].join('\n'),
    );
  });

  app.get('/sitemap.xml', (req, res) => {
    const pages = ['/', '/tender-intelligence', '/ai-automations', '/tenders', '/sources', '/newsletter', '/newsletter/archive', '/contact', '/privacy'];
    const issues = listPublicIssues(db);
    const entry = (loc, lastmod) => `<url><loc>${xml(config.siteUrl + loc)}</loc>${lastmod ? `<lastmod>${xml(lastmod.slice(0, 10))}</lastmod>` : ''}</url>`;
    res
      .type('application/xml')
      .send(
        `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${pages.map((p) => entry(p)).join('')}${issues.map((i) => entry(`/newsletter/archive/${i.slug}`, i.issue_date)).join('')}</urlset>`,
      );
  });
}
