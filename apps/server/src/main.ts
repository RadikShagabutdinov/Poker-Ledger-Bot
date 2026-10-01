import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { CORE_PACKAGE } from '@pokerledger/core';
import { SHARED_PACKAGE } from '@pokerledger/shared';

import { openDatabase, runMigrations, type DatabaseHandle } from './db/client';

/** drizzle-kit migrations; `main` lives one level below the package root in `src/` and `dist/`. */
export const MIGRATIONS_FOLDER = path.resolve(import.meta.dirname, '../drizzle');

// Bot (grammY) and HTTP API (Hono) are wired here in stages 3–4.
export function describeServer(): string {
  return `poker-ledger server (${CORE_PACKAGE}, ${SHARED_PACKAGE})`;
}

/** Opens the database and applies pending migrations (SPEC §16.2). */
export function startDatabase(databasePath: string): DatabaseHandle {
  if (databasePath !== ':memory:') {
    mkdirSync(path.dirname(databasePath), { recursive: true });
  }
  const database = openDatabase(databasePath);
  runMigrations(database.db, MIGRATIONS_FOLDER);
  return database;
}

export function main(): void {
  const database = startDatabase(process.env.DATABASE_PATH ?? './data/poker.db');
  console.log(`${describeServer()} started`);
  const shutdown = () => {
    database.close();
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
