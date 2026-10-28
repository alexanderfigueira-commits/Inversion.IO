#!/usr/bin/env node
// Checks a running Tendrelark site from the outside, using only its public /healthz endpoint.
//
//   node bin/check-production.js https://www.tendrelark.eu --save before.json
//   ... deploy or restart the site ...
//   node bin/check-production.js https://www.tendrelark.eu --compare before.json
//
// --save writes a baseline. --compare proves persistence: the database must be the same one
// (same creation time), no stored notice may have vanished (count not lower, oldest notice
// unchanged), and the start counter must have gone up. Exit code 1 means something needs attention.
import fs from 'node:fs';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const base = (args.find((a) => a.startsWith('http')) || process.env.SITE_URL || '').replace(/\/+$/, '');
const maxHours = Number(process.env.MAX_HOURS_SINCE_SUCCESS || 48);
const savePath = flag('--save');
const comparePath = flag('--compare');

if (!base.startsWith('http')) {
  console.error('Usage: node bin/check-production.js https://www.tendrelark.eu [--save file.json | --compare file.json]');
  process.exit(2);
}

const problems = [];
const fail = (msg) => problems.push(msg);

let health;
try {
  const res = await fetch(`${base}/healthz`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  health = await res.json();
} catch (err) {
  console.error(`Could not read ${base}/healthz: ${err.message}`);
  process.exit(1);
}

const { database, ted, sources } = health;
console.log(`Checked ${base} at ${health.time}`);
console.log(`Database created:      ${database.createdAt}`);
console.log(`Starts recorded:       ${database.startCount}`);
console.log(`TED notices stored:    ${ted.noticesStored}  ${JSON.stringify(ted.byCountry)}`);
console.log(`Newest publication:    ${ted.newestPublicationDate ?? 'none'}`);
console.log(`Oldest notice seen:    ${ted.oldestFirstSeenAt ?? 'none'}`);
console.log(`Last run:              ${ted.lastRun ? `#${ted.lastRun.id} ${ted.lastRun.status} (${ted.lastRun.fetched} fetched, ${ted.lastRun.inserted} new, ${ted.lastRun.failed} failed)` : 'none'}`);
console.log(`Last success:          ${ted.lastSuccessAt ?? 'never'}${ted.hoursSinceLastSuccess != null ? ` (${ted.hoursSinceLastSuccess} h ago)` : ''}`);
console.log(`Scheduler:             ${ted.schedulerEnabled ? 'on' : 'off'}`);
const cycle = ted.dailyCycle;
console.log(`Daily import cycle:    ${cycle ? `${cycle.date} ${cycle.outcome}, ${cycle.attempts} attempt(s), report ${cycle.reportEmailed ? 'emailed' : 'NOT emailed'}` : 'none recorded yet'}`);
console.log(`Sources:               ${sources.map((s) => `${s.slug}=${s.status}`).join(', ')}`);

if (ted.noticesStored === 0) fail('No TED notices are stored. Ingestion has not run, or its writes are not reaching the database.');
if (!ted.lastSuccessAt) fail('No ingestion run has ever finished successfully.');
else if (ted.hoursSinceLastSuccess > maxHours) fail(`The last successful ingestion was ${ted.hoursSinceLastSuccess} hours ago (limit ${maxHours}).`);
if (ted.lastRun && ['failed', 'empty'].includes(ted.lastRun.status)) fail(`The most recent ingestion run ${ted.lastRun.status === 'empty' ? 'returned no notices' : 'failed'}.`);
if (cycle && cycle.outcome !== 'done') fail(`The daily import on ${cycle.date} did not complete after ${cycle.attempts} attempt(s).`);
if (cycle && !cycle.reportEmailed) fail(`The daily TED report for ${cycle.date} was not emailed (SMTP not configured, or sending failed).`);
if (!ted.schedulerEnabled) console.log('Note: the in-process scheduler is off, so something else must run ingestion.');

if (comparePath) {
  const before = JSON.parse(fs.readFileSync(comparePath, 'utf8'));
  console.log(`\nComparing with baseline saved ${before.savedAt}:`);
  if (database.createdAt !== before.createdAt) fail(`The database is a different one (created ${database.createdAt}, baseline ${before.createdAt}). The previous data was lost.`);
  if (ted.noticesStored < before.noticesStored) fail(`Notices went down from ${before.noticesStored} to ${ted.noticesStored}.`);
  if (before.oldestFirstSeenAt && ted.oldestFirstSeenAt !== before.oldestFirstSeenAt) fail(`The oldest stored notice changed (${before.oldestFirstSeenAt} to ${ted.oldestFirstSeenAt}).`);
  if (database.startCount <= before.startCount) fail('The start counter did not increase, so the service has not restarted since the baseline. Deploy or restart, then compare again.');
  else console.log(`  Restarts since baseline: ${database.startCount - before.startCount}`);
  console.log(`  Notices: ${before.noticesStored} then, ${ted.noticesStored} now.`);
}

if (problems.length) {
  console.error(`\n${problems.length} problem${problems.length === 1 ? '' : 's'}:`);
  for (const p of problems) console.error(` - ${p}`);
  process.exit(1);
}

if (savePath) {
  fs.writeFileSync(savePath, JSON.stringify({ savedAt: health.time, createdAt: database.createdAt, startCount: database.startCount, noticesStored: ted.noticesStored, oldestFirstSeenAt: ted.oldestFirstSeenAt }, null, 2));
  console.log(`\nBaseline saved to ${savePath}. Deploy or restart, then run with --compare ${savePath}.`);
} else {
  console.log(comparePath ? '\nPersistence confirmed: the same database, no notices lost, service restarted.' : '\nLooks healthy.');
}
