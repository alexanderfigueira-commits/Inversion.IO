import { getMeta } from '../../db/index.js';
import { hmac, safeEqual } from '../../lib/security.js';
import { retrievalState, verifiedCountries } from '../../sources/coverage.js';
import {
  ISSUE_SLUG, IssueError, MAX_LINKS, buildDraftIssue, createDraft, getIssue, listAllIssues, previousWeekSlug, publishIssue, unpublishIssue, updateDraft,
} from '../../newsletter/issues.js';
import { sendIssue } from '../../newsletter/send.js';
import { listSubscribers, subscriberCounts } from '../../newsletter/subscribers.js';
import { ingestTed, latestRuns } from '../../ted/ingest.js';
import { listSources, verifySources } from '../../sources/verify.js';
import { tedStats } from '../../tenders.js';
import { adminDashboard, adminIssueForm, adminSubscribers } from '../views/admin.js';
import { notFoundPage } from '../views/pages.js';
import { str } from './public.js';

const NOTICES = {
  ingest: 'Ingestion started. Refresh in a minute to see the run.',
  verify: 'Source checks started. Refresh in a moment to see the results.',
  built: 'Draft built from stored TED notices. Review it, edit it, then publish.',
  created: 'Draft saved. It stays private until you publish it.',
  saved: 'Draft saved.',
  published: 'Published. The issue is now in the public archive.',
  unpublished: 'Unpublished. The issue is a private draft again.',
};

/** Reads the issue form: fixed fields plus numbered link rows. */
function readIssueForm(body) {
  const links = [];
  for (let n = 1; n <= MAX_LINKS + 2; n += 1) {
    links.push({ url: str(body[`link_url_${n}`]), label: str(body[`link_label_${n}`]), detail: str(body[`link_detail_${n}`]) });
  }
  return { title: str(body.title), issue_date: str(body.issue_date), country: str(body.country), content: str(body.content), links };
}

export function adminRoutes(app, ctx) {
  const { config, db, mailer, limits, log } = ctx;
  if (!config.admin.password) return; // admin area is off until ADMIN_PASSWORD is set

  const csrfToken = hmac(config.appSecret, 'admin-csrf');

  function authenticate(req, res, next) {
    const [scheme, encoded] = (req.get('authorization') || '').split(' ');
    if (scheme === 'Basic' && encoded) {
      const decoded = Buffer.from(encoded, 'base64').toString('utf8');
      const i = decoded.indexOf(':');
      // Both comparisons always run, so timing does not reveal which half was wrong.
      const okUser = safeEqual(decoded.slice(0, i), config.admin.user);
      const okPass = safeEqual(decoded.slice(i + 1), config.admin.password);
      if (i >= 0 && okUser && okPass) return next();
    }
    // Only failures are counted, so a legitimate editor is never locked out by normal use.
    if (!limits.adminFailures.take(req.ip)) return res.status(429).type('text/plain').send('Too many failed attempts. Try again later.');
    return res.set('WWW-Authenticate', 'Basic realm="Tendrelark admin", charset="UTF-8"').status(401).type('text/plain').send('Sign in required.');
  }

  // Browsers send Basic credentials automatically, so state changes need a second proof that the
  // request came from our own pages: a secret form token plus a same-site fetch metadata check.
  function requireCsrf(req, res, next) {
    const site = req.get('sec-fetch-site');
    if (site && !['same-origin', 'none'].includes(site)) return res.status(403).type('text/plain').send('Cross-site request refused.');
    if (!safeEqual(str(req.body?.csrf), csrfToken)) return res.status(403).type('text/plain').send('Invalid form token. Go back, refresh the page and try again.');
    return next();
  }

  const guard = [authenticate];
  const post = [authenticate, requireCsrf];
  const send = (res, page, status = 200) => res.status(status).set('Cache-Control', 'no-store').type('html').send(page.toString());
  const background = (name, job) => job().catch((err) => log.error?.(`Admin job "${name}" failed: ${err.message}`));
  const missing = (req, res) => res.status(404).type('html').send(notFoundPage({ config, path: req.path }).toString());

  // Messages built at runtime are signed, so a crafted link cannot make the admin page say something we did not.
  const flashUrl = (base, kind, text) => {
    const t = text.slice(0, 300);
    return `${base}?k=${kind}&m=${encodeURIComponent(t)}&s=${hmac(config.appSecret, `flash:${kind}:${t}`)}`;
  };
  function readFlash(req) {
    const kind = str(req.query.k);
    const text = str(req.query.m).slice(0, 300);
    if (['ok', 'error'].includes(kind) && text && safeEqual(str(req.query.s), hmac(config.appSecret, `flash:${kind}:${text}`))) return { kind, text };
    if (Object.hasOwn(NOTICES, str(req.query.done))) return { kind: 'ok', text: NOTICES[str(req.query.done)] };
    return null;
  }

  const formView = (req, res, { issue = null, values, problems = [], status = 200 }) =>
    send(res, adminIssueForm({ config, csrf: csrfToken, issue, values, problems, flash: readFlash(req), mailMode: mailer.mode, verified: verifiedCountries(db), sources: listSources(db) }), status);

  app.get('/admin', guard, (req, res) => {
    const sources = listSources(db);
    send(
      res,
      adminDashboard({
        config,
        csrf: csrfToken,
        flash: readFlash(req),
        data: {
          stats: tedStats(db),
          runs: latestRuns(db, 8),
          canary: { dbCreatedAt: getMeta(db, 'db_created_at'), bootCount: Number(getMeta(db, 'boot_count') || 0), lastBootAt: getMeta(db, 'last_boot_at') },
          sources,
          retrieval: Object.fromEntries(sources.map((s) => [s.slug, retrievalState(db, s)])),
          subs: subscriberCounts(db),
          issues: listAllIssues(db),
          defaultWeek: previousWeekSlug(),
          mailMode: mailer.mode,
          verified: verifiedCountries(db),
        },
      }),
    );
  });

  app.post('/admin/ted/ingest', post, (req, res) => {
    background('ted ingest', () => ingestTed(db, config, { log: (m) => log.info?.(`[ted] ${m}`) }));
    res.redirect(303, '/admin?done=ingest');
  });

  app.post('/admin/sources/verify', post, (req, res) => {
    background('source verify', () => verifySources(db, { log: (m) => log.info?.(`[sources] ${m}`) }));
    res.redirect(303, '/admin?done=verify');
  });

  // Subscribers (everyone who used the newsletter form, one row per address).
  app.get('/admin/subscribers', guard, (req, res) => {
    send(res, adminSubscribers({ config, subscribers: listSubscribers(db), counts: subscriberCounts(db) }));
  });

  app.get('/admin/subscribers.csv', guard, (req, res) => {
    // Cells that start with = + - @ would run as formulas when opened in a spreadsheet, so they get a leading quote.
    const cell = (v) => {
      const t = String(v ?? '');
      return `"${(/^[=+\-@\t\r]/.test(t) ? `'${t}` : t).replaceAll('"', '""')}"`;
    };
    const header = ['email', 'status', 'role', 'signed_up_from', 'submissions', 'first_signed_up', 'confirmed_at', 'unsubscribed_at'];
    const rows = listSubscribers(db, { limit: 100_000 }).map((s) => [s.email, s.status, s.role, s.signup_source, s.submit_count, s.created_at, s.confirmed_at, s.unsubscribed_at].map(cell).join(','));
    res.set('Cache-Control', 'no-store').type('text/csv').attachment('tendrelark-subscribers.csv').send(`${header.join(',')}\n${rows.join('\n')}\n`);
  });

  // Newsletter issues. Drafts live here and only here until they are published.
  app.get('/admin/issues/new', guard, (req, res) => {
    formView(req, res, { values: { issue_date: new Date().toISOString().slice(0, 10), links: [] } });
  });

  app.post('/admin/issues', post, (req, res) => {
    const values = readIssueForm(req.body);
    try {
      const issue = createDraft(db, values);
      return res.redirect(303, `/admin/issues/${issue.slug}?done=created`);
    } catch (err) {
      if (!(err instanceof IssueError)) throw err;
      return formView(req, res, { values, problems: err.problems, status: 422 });
    }
  });

  app.post('/admin/issues/build', post, (req, res) => {
    try {
      const built = buildDraftIssue(db, { week: str(req.body.week).trim(), country: str(req.body.country), replace: false });
      return res.redirect(303, `/admin/issues/${built.slug}?done=built`);
    } catch (err) {
      if (err instanceof IssueError || /Invalid week|does not exist/.test(err.message)) return res.redirect(303, flashUrl('/admin', 'error', err.problems?.join(' ') ?? err.message));
      throw err;
    }
  });

  const loadIssue = (req) => (ISSUE_SLUG.test(req.params.slug) ? getIssue(db, req.params.slug) : null);

  app.get('/admin/issues/:slug', guard, (req, res) => {
    const issue = loadIssue(req);
    if (!issue) return missing(req, res);
    return formView(req, res, { issue, values: issue });
  });

  app.post('/admin/issues/:slug/save', post, (req, res) => {
    const issue = loadIssue(req);
    if (!issue) return missing(req, res);
    const values = readIssueForm(req.body);
    try {
      updateDraft(db, issue.slug, values);
      return res.redirect(303, `/admin/issues/${issue.slug}?done=saved`);
    } catch (err) {
      if (!(err instanceof IssueError)) throw err;
      return formView(req, res, { issue, values, problems: err.problems, status: 422 });
    }
  });

  // Saves what is on screen first, then publishes, so the published version is always what the editor saw.
  app.post('/admin/issues/:slug/publish', post, (req, res) => {
    const issue = loadIssue(req);
    if (!issue) return missing(req, res);
    const values = readIssueForm(req.body);
    try {
      if (issue.status === 'draft') updateDraft(db, issue.slug, values);
      publishIssue(db, issue.slug);
      return res.redirect(303, `/admin/issues/${issue.slug}?done=published`);
    } catch (err) {
      if (!(err instanceof IssueError)) throw err;
      return formView(req, res, { issue, values, problems: ['Not published.', ...err.problems], status: 422 });
    }
  });

  app.post('/admin/issues/:slug/unpublish', post, (req, res) => {
    const issue = loadIssue(req);
    if (!issue) return missing(req, res);
    unpublishIssue(db, issue.slug);
    return res.redirect(303, `/admin/issues/${issue.slug}?done=unpublished`);
  });

  app.post('/admin/issues/:slug/send', post, async (req, res) => {
    const issue = loadIssue(req);
    if (!issue) return missing(req, res);
    try {
      const r = await sendIssue(db, mailer, config, issue.slug, { log: (m) => log.error?.(m) });
      const text = `Emailed to ${r.sent} subscriber${r.sent === 1 ? '' : 's'}${r.failed ? `, ${r.failed} failed (run it again to retry them)` : ''}.`;
      return res.redirect(303, flashUrl(`/admin/issues/${issue.slug}`, r.failed ? 'error' : 'ok', text));
    } catch (err) {
      if (!(err instanceof IssueError)) throw err;
      return res.redirect(303, flashUrl(`/admin/issues/${issue.slug}`, 'error', err.problems.join(' ')));
    }
  });
}
