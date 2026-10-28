import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { migrations } from './migrations.js';

export const nowIso = () => new Date().toISOString();

/**
 * Opens the database, applies pragmas and runs any pending migrations.
 * Durability first: WAL for concurrent readers, synchronous=FULL so a committed
 * notice is on disk before we report it as stored.
 */
export function openDatabase(databasePath) {
  if (databasePath !== ':memory:') {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  }
  const db = new DatabaseSync(databasePath);
  if (databasePath !== ':memory:') db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA synchronous = FULL');
  migrate(db);
  return db;
}

export function schemaVersion(db) {
  return db.prepare('PRAGMA user_version').get().user_version;
}

export function migrate(db) {
  const current = schemaVersion(db);
  const latest = migrations.at(-1).version;
  if (current > latest) {
    throw new Error(
      `Database schema is version ${current} but this code only knows up to ${latest}. Refusing to start.`,
    );
  }
  for (const m of migrations.filter((x) => x.version > current)) {
    tx(db, () => {
      db.exec(m.sql);
      db.exec(`PRAGMA user_version = ${m.version}`);
    });
  }
  return schemaVersion(db);
}

/** Runs fn inside a transaction. Not re-entrant: do not nest calls. */
export function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function getMeta(db, key) {
  return db.prepare('SELECT value FROM meta WHERE key = ?').get(key)?.value ?? null;
}

export function setMeta(db, key, value) {
  db.prepare(
    'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, String(value));
}

/**
 * Persistence canary. db_created_at is written once and never changes; boot_count goes up on
 * every start. If a deploy resets db_created_at or boot_count, the disk is not persistent.
 */
export function recordBoot(db) {
  const now = nowIso();
  tx(db, () => {
    if (!getMeta(db, 'db_created_at')) setMeta(db, 'db_created_at', now);
    setMeta(db, 'boot_count', Number(getMeta(db, 'boot_count') || 0) + 1);
    setMeta(db, 'last_boot_at', now);
  });
  return {
    dbCreatedAt: getMeta(db, 'db_created_at'),
    bootCount: Number(getMeta(db, 'boot_count')),
    lastBootAt: getMeta(db, 'last_boot_at'),
  };
}
