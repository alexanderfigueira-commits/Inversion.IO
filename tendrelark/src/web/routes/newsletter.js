import { checkFormToken, formToken } from '../../lib/security.js';
import { confirmSignup, requestSignup, unsubscribe } from '../../newsletter/subscribers.js';
import { getPublicIssue, listPublicIssues } from '../../newsletter/issues.js';
import { COVERED_COUNTRIES, verifiedCountries } from '../../sources/coverage.js';
import { actionPage, archivePage, issuePage, newsletterPage, rssFeed } from '../views/newsletter.js';
import { notFoundPage } from '../views/pages.js';
import { str } from './public.js';

export function newsletterRoutes(app, { config, db, mailer, limits }) {
  const send = (res, page) => res.type('html').send(page.toString());

  app.get('/newsletter', (req, res) => {
    const recent = listPublicIssues(db).slice(0, 3);
    send(res, newsletterPage({ config, token: formToken(config.appSecret), status: str(req.query.status), recent }));
  });

  app.post('/newsletter/subscribe', async (req, res) => {
    const b = req.body ?? {};
    const back = (status) => res.redirect(303, `/newsletter?status=${status}`);
    if (!limits.signup.take(req.ip)) return back('limit');
    if (str(b.website)) return back('check'); // spam trap filled in: look successful, store nothing
    if (!checkFormToken(config.appSecret, b.t)) return back('slow');
    if (b.consent !== 'yes') return back('consent');
    const source = /^[a-z0-9_-]{1,60}$/i.test(str(b.source)) ? str(b.source) : 'website';
    const result = await requestSignup(db, mailer, config, { email: str(b.email), role: str(b.role), source });
    return back(result.ok ? 'check' : 'invalid');
  });

  // Confirm and unsubscribe show a button on GET and act on POST. Mail scanners that open every
  // link in an email would otherwise confirm or unsubscribe people without them doing anything.
  app.get('/newsletter/confirm', (req, res) => {
    send(res, actionPage({ config, path: '/newsletter/confirm', title: 'Confirm your subscription', token: str(req.query.token), action: '/newsletter/confirm', button: 'Yes, send me the newsletter' }));
  });

  app.post('/newsletter/confirm', (req, res) => {
    const outcome = confirmSignup(db, str(req.body?.token));
    const messages = {
      confirmed: ['ok', 'You are subscribed', 'Thank you. You will get the next weekly issue by email.'],
      already: ['ok', 'You are already subscribed', 'Nothing more to do. The next issue will arrive by email.'],
      expired: ['error', 'That link has expired', 'Confirmation links work for 48 hours. Please sign up again to get a fresh one.'],
      invalid: ['error', 'We could not use that link', 'It may be mistyped or already used. You can sign up again at any time.'],
    };
    const [tone, title, message] = messages[outcome];
    send(res.status(outcome === 'invalid' || outcome === 'expired' ? 400 : 200), actionPage({ config, path: '/newsletter/confirm', title, message, tone, hideForm: true }));
  });

  app.get('/newsletter/unsubscribe', (req, res) => {
    send(res, actionPage({ config, path: '/newsletter/unsubscribe', title: 'Unsubscribe from the newsletter', token: str(req.query.token), action: '/newsletter/unsubscribe', button: 'Unsubscribe me' }));
  });

  // Also the target of the one click List-Unsubscribe header, which posts here with the token in the URL.
  app.post('/newsletter/unsubscribe', (req, res) => {
    const token = str(req.body?.token) || str(req.query.token);
    const ok = unsubscribe(db, config, token);
    send(
      res.status(ok ? 200 : 400),
      actionPage({
        config,
        path: '/newsletter/unsubscribe',
        title: ok ? 'You are unsubscribed' : 'We could not use that link',
        message: ok ? 'You will not get any more newsletters from us.' : 'The link may be mistyped. Write to us and we will remove you by hand.',
        tone: ok ? 'ok' : 'error',
        hideForm: true,
      }),
    );
  });

  app.get('/newsletter/archive', (req, res) => {
    const countries = verifiedCountries(db);
    const asked = str(req.query.country).toUpperCase();
    const selected = COVERED_COUNTRIES.includes(asked) ? asked : '';
    // A country filter for a country without verified coverage simply shows the empty state.
    send(res, archivePage({ config, issues: listPublicIssues(db, { country: selected }), countries, selected }));
  });

  app.get('/newsletter/archive.xml', (req, res) => {
    res.type('application/rss+xml').send(rssFeed({ config, issues: listPublicIssues(db).slice(0, 30) }));
  });

  app.get('/newsletter/archive/:slug', (req, res) => {
    const issue = getPublicIssue(db, req.params.slug);
    if (!issue) return res.status(404).type('html').send(notFoundPage({ config, path: req.path }).toString());
    return send(res, issuePage({ config, issue, token: formToken(config.appSecret) }));
  });
}
