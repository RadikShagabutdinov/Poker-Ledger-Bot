import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { CORE_PACKAGE } from '@pokerledger/core';
import { SHARED_PACKAGE } from '@pokerledger/shared';

import { autoRetry } from '@grammyjs/auto-retry';
import { serve } from '@hono/node-server';
import { Bot } from 'grammy';

import {
  ALLOWED_UPDATES,
  BotMessageUpdater,
  PressRateLimiter,
  TelegramMembershipChecker,
  installBotHandlers,
  miniAppLinks,
  setBotCommands,
} from './bot';
import { loadConfig } from './config';
import { ApiRateLimiter, createApp } from './http';
import { openDatabase, runMigrations, type DatabaseHandle } from './db/client';
import { createLogger } from './logger';
import { DEFAULT_TIME_ZONE, type ServiceDeps } from './services';

/** drizzle-kit migrations; `main` lives one level below the package root in `src/` and `dist/`. */
export const MIGRATIONS_FOLDER = path.resolve(import.meta.dirname, '../drizzle');

// One process: the grammY bot and the Hono HTTP API share the services.
export function describeServer(): string {
  return `poker-ledger server (${CORE_PACKAGE}, ${SHARED_PACKAGE})`;
}

/** Opens the database and applies pending migrations. */
export function startDatabase(databasePath: string): DatabaseHandle {
  if (databasePath !== ':memory:') {
    mkdirSync(path.dirname(databasePath), { recursive: true });
  }
  const database = openDatabase(databasePath);
  runMigrations(database.db, MIGRATIONS_FOLDER);
  return database;
}

export async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);
  const database = startDatabase(config.databasePath);
  const now = () => Date.now();

  const bot = new Bot(config.botToken);
  // Retries after `retry_after` on 429.
  bot.api.config.use(autoRetry());
  const links = miniAppLinks(config);
  const updater = new BotMessageUpdater({ db: database.db, api: bot.api, links, logger, now });
  const services: ServiceDeps = {
    db: database.db,
    membership: new TelegramMembershipChecker(bot.api, now),
    messageUpdater: updater,
    now,
    timeZone: DEFAULT_TIME_ZONE,
  };
  installBotHandlers(bot, {
    services,
    updater,
    links,
    logger,
    rateLimiter: new PressRateLimiter(now),
    miniAppUrl: config.miniAppUrl,
  });
  const app = createApp({
    services,
    logger,
    rateLimiter: new ApiRateLimiter(now),
    botToken: config.botToken,
    skipInitDataCheck: config.devSkipInitDataCheck,
    miniAppOrigin: config.miniAppOrigin,
    allowLocalhost: config.nodeEnv !== 'production',
  });
  if (config.devSkipInitDataCheck) {
    logger.warn('DEV_SKIP_INIT_DATA_CHECK: initData signatures are not checked');
  }

  // Fails fast on a wrong token (getMe).
  await bot.init();
  const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
    logger.info({ port: info.port }, 'http api listening');
  });

  let stopping = false;
  const shutdown = async () => {
    if (stopping) {
      return;
    }
    stopping = true;
    logger.info('shutting down');
    await new Promise((resolve) => server.close(resolve));
    await bot.stop();
    await updater.flush();
    database.close();
  };
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());

  await setBotCommands(bot.api, logger);
  await bot.start({
    allowed_updates: [...ALLOWED_UPDATES],
    onStart: (info) => {
      logger.info({ bot: info.username }, `${describeServer()} started`);
    },
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
