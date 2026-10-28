import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadConfig } from '../src/config.js';
import { getMeta, migrate, openDatabase, recordBoot, schemaVersion, setMeta } from '../src/db/index.js';
import { migrations } from '../src/db/migrations.js';
import { tempDbPath } from './helpers.js';

const prod = (over = {}) => ({ NODE_ENV: 'production', DATABASE_PATH: '/data/tendrelark.db', APP_SECRET: 'a'.repeat(40), SITE_URL: 'https://www.tendrelark.eu', ...over });

test('production refuses to start with a database that could be wiped on deploy', () => {
  assert.throws(() => loadConfig({ NODE_ENV: 'production', APP_SECRET: 'a'.repeat(40) }), /DATABASE_PATH is required in production/);
  assert.throws(() => loadConfig(prod({ DATABASE_PATH: ':memory:' })), /cannot be :memory:/);
  assert.throws(() => loadConfig(prod({ APP_SECRET: 'short' })), /APP_SECRET/);
  assert.throws(() => loadConfig(prod({ SITE_URL: 'http://www.tendrelark.eu' })), /https/);
  const ok = loadConfig(prod());
  assert.equal(ok.production, true);
  assert.equal(ok.databasePath, '/data/tendrelark.db');
  assert.equal(ok.tedDaily.reportTo, 'support@tendrelark.eu');
  assert.equal(ok.tedDaily.dailyAtUtc, '06:00');
  assert.equal(ok.tedDaily.retryIntervalMinutes, 10);
  assert.equal(ok.tedDaily.retryWindowMinutes, 60);
  assert.equal(ok.scheduler.enabled, false);
});

test('development works with sensible defaults, and settings are parsed', () => {
  const dev = loadConfig({ NODE_ENV: 'development' });
  assert.equal(dev.siteUrl, 'http://localhost:3000');
  assert.deepEqual(dev.ted.countries, ['PRT', 'LUX', 'BEL']);
  assert.equal(loadConfig({ TRUST_PROXY: '1' }).trustProxy, 1);
  assert.equal(loadConfig({ ENABLE_SCHEDULER: 'true' }).scheduler.enabled, true);
  assert.deepEqual(loadConfig({ TED_COUNTRIES: 'prt, bel' }).ted.countries, ['PRT', 'BEL']);
});

test('migrations are idempotent and the schema version is recorded', () => {
  const tmp = tempDbPath();
  const db = openDatabase(tmp.file);
  assert.equal(schemaVersion(db), migrations.at(-1).version);
  assert.equal(migrate(db), migrations.at(-1).version); // running again changes nothing
  assert.equal(db.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
  assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
  db.exec(`PRAGMA user_version = ${migrations.at(-1).version + 1}`);
  assert.throws(() => migrate(db), /Refusing to start/); // a newer database than this code understands
  db.close();
  tmp.cleanup();
});

test('the persistence canary survives a restart and counts every start', () => {
  const tmp = tempDbPath();
  let db = openDatabase(tmp.file);
  const first = recordBoot(db);
  assert.equal(first.bootCount, 1);
  setMeta(db, 'marker', 'still here');
  db.close();

  db = openDatabase(tmp.file); // the next deploy opens the same file
  const second = recordBoot(db);
  assert.equal(second.bootCount, 2);
  assert.equal(second.dbCreatedAt, first.dbCreatedAt); // creation time never changes
  assert.equal(getMeta(db, 'marker'), 'still here');
  db.close();
  tmp.cleanup();
});
