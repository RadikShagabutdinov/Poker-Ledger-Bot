import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

import * as schema from './schema';

export type Db = BetterSQLite3Database<typeof schema>;
/** A transaction handle; repositories accept both. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type DbOrTx = Db | Tx;

export interface DatabaseHandle {
  readonly db: Db;
  /** The raw better-sqlite3 connection. */
  readonly sqlite: Database.Database;
  close(): void;
}

/**
 * Opens SQLite (`':memory:'` for tests) with WAL and foreign keys on (SPEC §9.2).
 */
export function openDatabase(path: string): DatabaseHandle {
  const sqlite = new Database(path);
  if (path !== ':memory:') {
    sqlite.pragma('journal_mode = WAL');
  }
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  const db = drizzle(sqlite, { schema });
  return { db, sqlite, close: () => sqlite.close() };
}

/** Applies pending drizzle-kit migrations from `migrationsFolder` (run on startup). */
export function runMigrations(db: Db, migrationsFolder: string): void {
  migrate(db, { migrationsFolder });
}
