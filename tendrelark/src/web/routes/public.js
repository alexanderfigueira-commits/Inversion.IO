import { checkFormToken, formToken } from '../../lib/security.js';
import { createEnquiry } from '../../enquiries.js';
import { searchNotices, tedStats } from '../../tenders.js';
import { retrievalState } from '../../sources/coverage.js';
import { listSources } from '../../sources/verify.js';
import { findLogoPhoto } from '../assets.js';
import { homePage } from '../views/home.js';
import { aiAutomationsPage, contactPage, privacyPage, tenderIntelligencePage } from '../views/pages.js';
import { tendersPage } from '../views/tenders.js';
import { sourcesPage } from '../views/sources.js';

export const str = (v) => (typeof v === 'string' ? v : '');

export function publicRoutes(app, { config, db, mailer, limits }) {
  const send = (res, page) => res.type('html').send(page.toString());

  app.get('/', (req, res) => {
    const { rows } = searchNotices(db, { pageSize: 5 }, config.ted.countries);
    send(res, homePage({ config, latest: rows, stats: tedStats(db), token: formToken(config.appSecret), logoPhoto: findLogoPhoto() }));
  });

  app.get('/tender-intelligence', (req, res) => send(res, tenderIntelligencePage({ config })));
  app.get('/ai-automations', (req, res) => send(res, aiAutomationsPage({ config })));
  app.get('/privacy', (req, res) => send(res, privacyPage({ config })));

  app.get('/tenders', (req, res) => {
    const query = {
      q: str(req.query.q).trim().slice(0, 100),
      country: str(req.query.country),
      sector: str(req.query.sector),
      open: str(req.query.open) === '1' ? '1' : '',
    };
    const result = searchNotices(db, { ...query, openOnly: Boolean(query.open), page: str(req.query.page) }, config.ted.countries);
    send(res, tendersPage({ config, result, query, stats: tedStats(db), countries: config.ted.countries }));
  });

  app.get('/sources', (req, res) => {
    const sources = listSources(db);
    const retrieval = Object.fromEntries(sources.map((s) => [s.slug, retrievalState(db, s)]));
    send(res, sourcesPage({ config, sources, retrieval }));
  });

  app.get('/contact', (req, res) => {
    send(res, contactPage({ config, token: formToken(config.appSecret), status: str(req.query.status), interest: str(req.query.interest) }));
  });

  app.post('/contact', async (req, res) => {
    const b = req.body ?? {};
    const back = (status) => res.redirect(303, `/contact?status=${status}`);
    if (!limits.contact.take(req.ip)) return back('limit');
    if (str(b.website)) return back('sent'); // spam trap filled in: look successful, store nothing
    if (!checkFormToken(config.appSecret, b.t)) return back('slow');
    if (b.consent !== 'yes') return back('invalid');
    const result = await createEnquiry(db, mailer, config, {
      name: str(b.name),
      email: str(b.email),
      company: str(b.company),
      interest: str(b.interest),
      message: str(b.message),
    });
    return back(result.ok ? 'sent' : 'invalid');
  });
}
