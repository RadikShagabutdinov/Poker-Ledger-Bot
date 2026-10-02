import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';

import type { Logger } from '../logger';
import type { ServiceDeps } from '../services';
import { initDataAuth } from './auth';
import type { AppEnv } from './env';
import { errorResponse, handleError } from './errors';
import { rateLimit, type ApiRateLimiter } from './rateLimit';
import { chatRoutes } from './routes/chats';
import { gameRoutes } from './routes/games';
import { meRoutes } from './routes/me';
import { settlementRoutes } from './routes/settlement';

export interface HttpOptions {
  readonly services: ServiceDeps;
  readonly logger: Logger;
  readonly rateLimiter: ApiRateLimiter;
  readonly botToken: string;
  /** Dev only: accept unsigned initData (SPEC §16.6). */
  readonly skipInitDataCheck: boolean;
  /** The Mini App origin allowed by CORS (SEC-05). */
  readonly miniAppOrigin: string | undefined;
  /** Also allow `http://localhost:*` (development). */
  readonly allowLocalhost: boolean;
}

const LOCALHOST_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/;

/** The HTTP API under `/api` (SPEC §11), served in the bot's process. */
export function createApp(options: HttpOptions): Hono<AppEnv> {
  const { services, logger } = options;
  const app = new Hono<AppEnv>().basePath('/api');

  // One JSON line per request: no headers, bodies or query strings (SEC-09).
  app.use(async (c, next) => {
    const started = performance.now();
    await next();
    logger.info(
      {
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        ms: Math.round(performance.now() - started),
        userId: (c.var.actor as AppEnv['Variables']['actor'] | undefined)?.tgUserId,
      },
      'request',
    );
  });
  app.use(
    cors({
      origin: (origin) =>
        origin === options.miniAppOrigin ||
        (options.allowLocalhost && LOCALHOST_ORIGIN.test(origin))
          ? origin
          : null,
      allowMethods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
      allowHeaders: ['Authorization', 'Content-Type'],
      maxAge: 600,
    }),
  );
  app.use(
    bodyLimit({
      maxSize: 64 * 1024,
      onError: (c) => errorResponse(c, 'VALIDATION', { reason: 'BODY_TOO_LARGE' }),
    }),
  );
  app.use(
    initDataAuth(services, {
      botToken: options.botToken,
      skipCheck: options.skipInitDataCheck,
    }),
  );
  app.use(rateLimit(options.rateLimiter));

  app.route('/', meRoutes(services));
  app.route('/', chatRoutes(services));
  app.route('/', gameRoutes(services));
  app.route('/', settlementRoutes(services));

  app.notFound((c) => errorResponse(c, 'NOT_FOUND'));
  app.onError(handleError(logger));
  return app;
}
