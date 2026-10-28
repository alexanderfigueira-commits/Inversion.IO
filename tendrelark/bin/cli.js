#!/usr/bin/env node
import { loadConfig } from '../src/config.js';
import { checkEmailDns } from '../src/lib/dns-check.js';
import { buildSmtpUrl, describeSmtpUrl, redactSmtpUrl } from '../src/lib/smtp-url.js';
import { getMeta, openDatabase, recordBoot, schemaVersion } from '../src/db/index.js';
import { seedSources } from '../src/db/seed.js';
import { createMailer, explainMailError } from '../src/lib/mailer.js';
import { runDailyTedImport } from '../src/jobs/daily-ted.js';
import { IssueError, buildDraftIssue, previousWeekSlug, publishIssue } from '../src/newsletter/issues.js';
import { sendIssue } from '../src/newsletter/send.js';
import { ingestTed, latestRuns, probeTed, reconcileTed, WATERMARK_KEY } from '../src/ted/ingest.js';
import { verifySources } from '../src/sources/verify.js';
import { tedStats } from '../src/tenders.js';

const [command, ...rest] = process.argv.slice(2);

function flags(args) {
  const out = {};
  for (let i = 0; i < args.length; i += 1) {
    if (!args[i].startsWith('--')) continue;
    const key = args[i].slice(2);
    const next = args[i + 1];
    if (next && !next.startsWith('--')) {
      out[key] = next;
      i += 1;
    } else out[key] = true;
  }
  return out;
}

const HELP = `Tendrelark command line

  migrate                         Create or update the database schema and seed the source list
  db:check                        Print what the database holds (use after a deploy to prove persistence)
  mail:url --host H --port P --user U   Build a correctly encoded SMTP_URL (password from SMTP_PASSWORD or --password)
  mail:test [--to ADDRESS]        Connect to SMTP_URL, log in and send a test email, with plain language errors
  dns:check [--domain D] [--dkim-selector A,B]
                                  Check the SPF, DKIM and DMARC records that decide whether your email reaches inboxes
  ted:probe                       Confirm the TED API works from this machine and show which fields it accepts
  ted:daily [--no-email]          The daily cycle: import, retry every 10 min for up to 1 h until it completes, then email the log
  ted:ingest [--from D] [--to D]  One import attempt, no retries and no email (dates as YYYY-MM-DD)
  ted:reconcile [--days N]        Compare TED's own counts with what is stored. Exits 1 on any gap
  sources:verify                  Check that each tender source is reachable and record the result
  newsletter:build --country PRT|LUX|BEL [--week W] [--replace]
                                  Start a draft from stored TED notices for an ISO week such as 2026-W43 (default: last week)
  newsletter:publish --issue SLUG Publish a draft (needs verified coverage and at least one official source link)
  newsletter:send --issue SLUG    Email a published issue to confirmed subscribers (needs SMTP_URL)
`;

if (!command || command === 'help' || command === '--help') {
  console.log(HELP);
  process.exit(0);
}

// These two never touch the database, so they run first and do not create one.
const earlyFlags = flags(rest);
if (command === 'mail:url') {
  try {
    const url = buildSmtpUrl({ host: earlyFlags.host, port: earlyFlags.port, user: earlyFlags.user, password: typeof earlyFlags.password === 'string' ? earlyFlags.password : process.env.SMTP_PASSWORD });
    console.log('Put this in your settings as SMTP_URL (keep it secret, it contains the password):\n');
    console.log(url);
    console.log(`\nWhat the app will use: ${JSON.stringify(describeSmtpUrl(url))}`);
    console.log(`Safe to share in logs: ${redactSmtpUrl(url)}`);
    process.exit(0);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
if (command === 'dns:check') {
  const domain = typeof earlyFlags.domain === 'string' ? earlyFlags.domain : 'tendrelark.eu';
  const selectors = typeof earlyFlags['dkim-selector'] === 'string' ? earlyFlags['dkim-selector'].split(',').map((x) => x.trim()).filter(Boolean) : [];
  try {
    const r = await checkEmailDns(domain, { dkimSelectors: selectors });
    const line = (label, x) => console.log(`${x.status.toUpperCase().padEnd(5)} ${label}: ${x.message}${x.record ? `\n        ${x.record}` : ''}`);
    console.log(`Email DNS for ${r.domain}\n`);
    line('SPF', r.spf);
    line('DMARC', r.dmarc);
    for (const d of r.dkim) line(`DKIM (${d.selector})`, d);
    if (!r.dkim.length) console.log('NOTE  DKIM was not checked. Your sending provider shows a selector name (for example "s1" or "mail"). Run again with --dkim-selector NAME.');
    process.exit(r.ok ? 0 : 1);
  } catch (err) {
    console.error(`Could not look up DNS: ${err.message}`);
    process.exit(1);
  }
}

const config = loadConfig();
const db = openDatabase(config.databasePath);
seedSources(db);
const f = flags(rest);
const log = (m) => console.log(m);

async function main() {
  switch (command) {
    case 'migrate': {
      console.log(`Database ${config.databasePath} is at schema v${schemaVersion(db)}.`);
      return 0;
    }

    case 'db:check': {
      const boot = recordBoot(db);
      const stats = tedStats(db);
      const runs = latestRuns(db, 3);
      console.log(`Database file:        ${config.databasePath}`);
      console.log(`Schema version:       ${schemaVersion(db)}`);
      console.log(`Created at:           ${boot.dbCreatedAt}`);
      console.log(`Starts recorded:      ${boot.bootCount}`);
      console.log(`TED notices stored:   ${stats.notices}`);
      for (const c of stats.byCountry) console.log(`  ${c.country}:                ${c.n}`);
      console.log(`Newest publication:   ${stats.latest_publication ?? 'none'}`);
      console.log(`Oldest first seen:    ${stats.oldest_seen ?? 'none'}`);
      console.log(`Ingestion watermark:  ${getMeta(db, WATERMARK_KEY) ?? 'none'}`);
      for (const r of runs) console.log(`Run #${r.id} ${r.status} ${r.started_at} fetched=${r.fetched} new=${r.inserted} changed=${r.updated} same=${r.unchanged} failed=${r.failed}`);
      const dupes = db.prepare('SELECT COUNT(*) AS n FROM (SELECT publication_number FROM ted_notices GROUP BY publication_number HAVING COUNT(*) > 1)').get().n;
      const integrity = db.prepare('PRAGMA integrity_check').get().integrity_check;
      console.log(`Duplicate notices:    ${dupes}`);
      console.log(`Integrity check:      ${integrity}`);
      return dupes === 0 && integrity === 'ok' ? 0 : 1;
    }

    case 'ted:probe': {
      const report = await probeTed(config);
      console.log(JSON.stringify(report, null, 2));
      const rejected = report.fields.filter((x) => !x.accepted).map((x) => x.field);
      if (rejected.length) console.log(`\nTED rejected: ${rejected.join(', ')}. Ingestion will fall back to core fields, or set TED_FIELDS to the accepted list.`);
      return 0;
    }

    case 'ted:ingest': {
      const result = await ingestTed(db, config, { from: typeof f.from === 'string' ? f.from : undefined, to: typeof f.to === 'string' ? f.to : undefined, log });
      console.log(JSON.stringify(result, null, 2));
      if (result.status === 'empty') console.error('\nTED returned no notices. Nothing was stored. Run `npm run ted:probe` to see what the API answers.');
      return result.status === 'failed' ? 1 : result.status === 'empty' ? 3 : 0;
    }

    case 'ted:reconcile': {
      const report = await reconcileTed(db, config, { days: Number(f.days) || 14 });
      for (const r of report.rows) console.log(`${r.country}  ${r.from} to ${r.to}  TED: ${r.tedCount}  stored: ${r.storedCount}  ${r.missing === 0 ? 'OK' : `MISSING ${r.missing}`}`);
      console.log(report.ok ? '\nEvery TED notice in the window is stored.' : '\nGaps found. Run `npm run ted:ingest -- --from <date>` for the affected period.');
      return report.ok ? 0 : 1;
    }

    case 'sources:verify': {
      const results = await verifySources(db, { log });
      return results.some((r) => r.status === 'unreachable') ? 1 : 0;
    }

    case 'mail:test': {
      const mailer = createMailer(config, db, { log: console });
      if (mailer.mode !== 'smtp') {
        console.error('SMTP_URL is not set, so there is nothing to test. Build it with: npm run mail:url -- --host mail.example.com --port 465 --user support@tendrelark.eu');
        return 1;
      }
      const to = typeof f.to === 'string' ? f.to : config.contact.email;
      const d = describeSmtpUrl(config.mail.smtpUrl);
      console.log(`Connecting to ${d.host}:${d.port} as ${d.user} (${d.secureFromStart ? 'encrypted from the start' : 'upgrades to encryption if offered'})...`);
      try {
        await mailer.verify();
        console.log('Connected and logged in.');
        await mailer.send({
          to,
          kind: 'mail_test',
          subject: 'Tendrelark test email',
          text: `This is a test email from the Tendrelark site.\n\nIf you can read it, sending works.\nSent from ${config.siteUrl} as ${config.mail.from}.\n`,
        });
        console.log(`Test email sent to ${to}. Check the inbox, and the spam folder, then run: npm run dns:check`);
        return 0;
      } catch (err) {
        console.error(`FAILED: ${explainMailError(err)}\n(technical detail: ${err.code ?? 'no code'}, ${String(err.message).slice(0, 200)})`);
        return 1;
      }
    }

    case 'ted:daily': {
      const mailer = createMailer(config, db, { log: console });
      const r = await runDailyTedImport({ db, config, mailer, log, sendReport: !f['no-email'] });
      console.log(`${r.done ? 'DONE' : 'NOT DONE'} after ${r.attempts.length} attempt(s). Report ${r.emailed ? `emailed to ${config.tedDaily.reportTo}` : 'not emailed'}.`);
      return r.done ? 0 : 3;
    }

    case 'newsletter:build': {
      const built = buildDraftIssue(db, { week: typeof f.week === 'string' ? f.week : previousWeekSlug(), country: typeof f.country === 'string' ? f.country.toUpperCase() : '', replace: Boolean(f.replace) });
      console.log(`Draft ${built.slug}: ${built.linkCount} source links chosen from ${built.totalNotices} stored notices. It stays private until it is published.`);
      if (!built.linkCount) console.log('No links found. Check that TED notices were ingested for that week.');
      return 0;
    }

    case 'newsletter:publish': {
      if (typeof f.issue !== 'string') throw new IssueError('Pass --issue 2026-11-02-prt.');
      const issue = publishIssue(db, f.issue);
      console.log(`Published ${issue.slug} with ${issue.links.length} official source link${issue.links.length === 1 ? '' : 's'}.`);
      return 0;
    }

    case 'newsletter:send': {
      if (typeof f.issue !== 'string') throw new IssueError('Pass --issue 2026-11-02-prt.');
      const mailer = createMailer(config, db, { log: console });
      const result = await sendIssue(db, mailer, config, f.issue, { log });
      console.log(JSON.stringify(result, null, 2));
      return result.failed ? 1 : 0;
    }

    default:
      console.error(`Unknown command "${command}".\n\n${HELP}`);
      return 2;
  }
}

try {
  process.exitCode = await main();
} catch (err) {
  console.error(err instanceof IssueError ? err.problems.join('\n') : err.stack || err.message);
  process.exitCode = 1;
} finally {
  db.close();
}
