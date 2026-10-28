# Tendrelark

The website for https://www.tendrelark.eu: public tender intelligence and custom AI automations for IT
consultancies, engineering and professional services firms, and independent bid consultants in Portugal,
Luxembourg and Belgium. Every tender links to its official source, and every bid decision stays with the client.

It is a small Node app with its own database. No framework to learn, no build step, and no JavaScript sent
to the browser.

- Node 22.13 or newer (it uses the built in `node:sqlite`)
- SQLite database in one file
- Two dependencies: `express` and `nodemailer`

## Run it

```bash
npm install
cp .env.example .env   # then edit it, or export the variables yourself
npm start
```

Open http://localhost:3000. The database is created on first start. Run the tests with `npm test`.

## What is on the site

| Page | What it does |
| --- | --- |
| `/` | Home page with the signup form and the latest stored TED notices |
| `/tender-intelligence`, `/ai-automations` | The two offerings |
| `/tenders` | Search the TED notices we have stored, each linked to its official notice |
| `/sources` | Official platforms for Portugal, Luxembourg and Belgium, with reachability, automated retrieval status and import feasibility |
| `/newsletter` | Weekly newsletter signup (double opt in, no account needed) |
| `/newsletter/archive`, `/newsletter/archive/:slug` | Public archive of published issues, filterable by country |
| `/contact`, `/privacy` | Contact form and privacy notice |
| `/healthz` | Operator health check (no personal data) |
| `/admin` | Password protected: TED runs, sources, subscribers, issue editor |

## The two questions behind the sources page

Every source answers two separate questions, and the page never mixes them up.

1. **Is it reachable?** Set only by `npm run sources:verify` (or the scheduler), which makes a real request and
   records the result and date. Nothing is seeded as verified.
2. **Can its notices be retrieved automatically?** One of three labels:
   - *Retrieval verified*: an importer exists and has stored records. Only TED can ever show this today, and
     only after a run has really stored notices. It is derived from the ingestion log, not typed in.
   - *Retrieval unavailable*: researched, and no documented automated interface exists.
   - *Retrieval unverified*: not tested, or the research could not confirm it.

The national findings (Portugal, Luxembourg, Belgium) live in `src/db/seed.js`. They come from the research note
dated 27 October 2026. **They have not been re-checked against the live portals**, because the build
environment cannot reach them. Re-check before you change a finding. Nothing is imported from a national
platform, and the page says so.

A country has **verified coverage** when at least one source in the directory serving it passed its last
reachability check. National sources serve their own country. TED serves all three. This is reachability, not
completeness, and the sources page says that in plain words. Newsletter issues can only use countries with
verified coverage.

## TED import

Notices come from the public TED search API (`POST https://api.ted.europa.eu/v3/notices/search`, anonymous).

- **Idempotent.** The publication number is the key. Running the same import twice never creates a second
  row. Corrected notices are updated in place and keep their first seen time.
- **Windows.** Each run re-reads from the saved watermark minus `TED_OVERLAP_DAYS`, so late or corrected
  notices are caught. Dates are sent to TED as `YYYYMMDD`. The watermark only moves forward after a complete run.
- **An empty answer is not a success.** If every day is read but TED returns nothing, the run is recorded as
  `empty`, the watermark stays put, and the command exits with code 3.
- **Field fallback.** If TED rejects one of the optional fields, the run continues with the core fields and
  records `fields: core`. `npm run ted:probe` shows which fields TED really accepts.

### The daily cycle

With `ENABLE_SCHEDULER=true`, the server runs one cycle a day at `TED_DAILY_AT_UTC` (default 06:00 UTC):

1. Run the import.
2. If it did not complete (a failed day, an empty answer, another run in progress), try again every
   `TED_RETRY_INTERVAL_MINUTES` (10) until `TED_RETRY_WINDOW_MINUTES` (60) have passed. That is the first attempt
   plus up to six retries.
3. Email the log of every attempt to `TED_REPORT_EMAIL` (default `support@tendrelark.eu`), whatever the outcome.
   The subject starts with `[Tendrelark] TED import DONE` or `NOT DONE`.

The cycle is remembered in the database, so a restart does not run it twice and a late start catches up
instead of skipping the day. Run it by hand with `npm run ted:daily` (add `--no-email` to skip the report).
The report needs `SMTP_URL`. Without it the report is logged, `/healthz` says it was not emailed, and
`npm run check:production` flags it.

### Does it persist in production?

Do this once before you trust it, and again after every deploy:

```bash
npm run check:production -- https://www.tendrelark.eu --save before.json
# deploy or restart the site
npm run check:production -- https://www.tendrelark.eu --compare before.json
```

`--compare` fails unless it is the same database (same creation time), no notices were lost, the oldest notice
is unchanged, and the start counter went up. It also fails if the last import was empty or failed, or if the
daily report was not emailed. `npm run ted:reconcile` asks TED how many notices exist for the last N days and
compares that with what is stored, which is the check that catches missed days.

## Newsletter

- **Signup.** `/newsletter` and the home page post to the same handler. A visitor gives an email and ticks a
  consent box. No account or profile is created and no cookie is set. They confirm by email first, and the
  confirmation page needs a button press, so mail scanners that open every link cannot subscribe anyone.
- **No misleading duplicates.** The address is the identity. Signing up again, in any capitalisation, never adds
  a row. It only raises the submission count. Unconfirmed addresses are shown separately from subscribers.
- **Issues.** One issue covers one country. In `/admin` write one (title, issue date, country, content, official
  source links) or start a draft from the TED notices stored for a week. Drafts are private.
- **Official source links.** Every link must be https and sit on a source from the directory that serves the
  issue's country. Deep links to a notice are fine. The database also refuses a link that is not https or has
  no source.
- **Publishing.** Needs a country with verified coverage right now, content, and at least one official source
  link. Published issues are frozen. Unpublish to edit.
- **What the public sees.** Only published issues for countries with verified coverage. If coverage lapses, the
  issue is hidden and the admin dashboard says so. The detail page shows exactly the links recorded on the issue.
- **Emailing.** `/admin` or `npm run newsletter:send -- --issue 2026-11-02-prt`. It refuses to run without
  `SMTP_URL`, only reaches confirmed subscribers, and never sends the same issue twice to the same person.

## Deploying

The one thing that goes wrong quietly is the database living on a disk that is wiped on every deploy.
In production the app refuses to start unless `DATABASE_PATH` is set, and it warns if the path is inside the
app directory or `/tmp`. Mount a persistent volume and point `DATABASE_PATH` at it.

```bash
docker build -t tendrelark .
docker run -p 3000:3000 -v tendrelark-data:/data --env-file .env tendrelark
```

Set at least `NODE_ENV=production`, `SITE_URL`, `APP_SECRET`, `DATABASE_PATH`, `SMTP_URL`, `ADMIN_PASSWORD`,
`ENABLE_SCHEDULER=true` and `TRUST_PROXY` (the number of proxies in front of the app). Terminate HTTPS in front of
the app. The app sends HSTS and does not redirect HTTP itself. Run one instance only: the rate limiter and the
scheduler live in memory.

All settings are in `.env.example`.

## Things only you can supply or confirm

- **The brand photo.** Put the paper bird photo at `public/img/logo-photo.webp` (or `.jpg`, `.jpeg`, `.png`).
  It appears at the lower left of the home page, under the newsletter text. Until the file exists, the page shows
  the Tendrelark mark in the same frame.
- **SMTP.** Nothing is emailed without `SMTP_URL`: signup confirmations, the daily TED report and the newsletter.
- **Legal details.** Set `LEGAL_ENTITY_NAME` and `LEGAL_ENTITY_DETAILS`. Have the privacy page reviewed by a
  lawyer. It is a plain language draft, not legal advice.
- **Contact and sender address.** `CONTACT_EMAIL` and the "From" address in `MAIL_FROM` both default to `support@tendrelark.eu`. Your SMTP provider must be allowed to send as that address.
- **A live check of the TED API.** The client follows TED's published request and response shape, and the tests
  run against a stand in server for it. Run `npm run ted:probe` once from a machine that can reach TED to
  confirm the real thing agrees.

## Layout

```
src/config.js            settings, with fail fast checks for production
src/db/                  connection, migrations, source directory seed
src/ted/                 API client, normalisation, ingestion, reconcile, probe
src/jobs/                daily TED cycle and the scheduler
src/sources/             reachability checks, coverage rules, link validation
src/newsletter/          subscribers, issues, emailing
src/web/                 app, routes, views, stylesheet lives in public/
bin/cli.js               operator commands (npm run ... shows them)
bin/check-production.js  outside check of a running site
test/                    node:test suite
```
