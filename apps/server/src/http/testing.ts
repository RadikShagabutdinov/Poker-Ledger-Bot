// Test helpers: the API over in-memory services, signed initData, captured logs.
import { Writable } from 'node:stream';

import { sign } from '@tma.js/init-data-node';
import type { Hono } from 'hono';
import { pino } from 'pino';

import type { Actor, MembershipChecker } from '../services';
import { createTestDeps, type TestDeps } from '../services/testing';
import { createApp } from './app';
import type { AppEnv } from './env';
import { ApiRateLimiter } from './rateLimit';

export const BOT_TOKEN = '123456:TEST-TOKEN';
export const MINIAPP_ORIGIN = 'https://example.github.io';

/** initData signed with `token` at `authDate`, as Telegram would send it. */
export function initDataFor(
  actor: Actor,
  options: { authDate?: Date; token?: string; startParam?: string } = {},
): string {
  return sign(
    {
      user: {
        id: actor.tgUserId,
        first_name: actor.firstName,
        ...(actor.lastName ? { last_name: actor.lastName } : {}),
        ...(actor.languageCode ? { language_code: actor.languageCode } : {}),
      },
      ...(options.startParam ? { start_param: options.startParam } : {}),
    },
    options.token ?? BOT_TOKEN,
    options.authDate ?? new Date(),
  );
}

export interface CallOptions {
  readonly body?: unknown;
  /** Raw body text instead of `body`. */
  readonly rawBody?: string;
  readonly headers?: Record<string, string>;
}

export interface TestApp {
  readonly deps: TestDeps;
  readonly app: Hono<AppEnv>;
  /** Every log line the app wrote, raw JSON. */
  readonly logs: string[];
  /** A request as `actor` (signed initData), or without auth when `actor` is `null`. */
  call(actor: Actor | null, method: string, path: string, options?: CallOptions): Promise<Response>;
  /** `call` that expects `status` and returns the parsed JSON body. */
  json<T = Record<string, unknown>>(
    actor: Actor,
    method: string,
    path: string,
    body?: unknown,
    status?: number,
  ): Promise<T>;
}

export function createTestApp(
  options: { membership?: MembershipChecker; skipInitDataCheck?: boolean; dev?: boolean } = {},
): TestApp {
  const deps = createTestDeps();
  const services = options.membership ? { ...deps, membership: options.membership } : deps;
  const logs: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, done) {
      logs.push(chunk.toString());
      done();
    },
  });
  const app = createApp({
    services,
    logger: pino({ level: 'info' }, stream),
    rateLimiter: new ApiRateLimiter(deps.now),
    botToken: BOT_TOKEN,
    skipInitDataCheck: options.skipInitDataCheck ?? false,
    miniAppOrigin: MINIAPP_ORIGIN,
    allowLocalhost: options.dev ?? false,
  });

  const call: TestApp['call'] = (actor, method, path, callOptions = {}) => {
    const headers: Record<string, string> = { ...callOptions.headers };
    if (actor) {
      headers.Authorization = `tma ${initDataFor(actor)}`;
    }
    let body: string | undefined = callOptions.rawBody;
    if (callOptions.body !== undefined) {
      body = JSON.stringify(callOptions.body);
      headers['Content-Type'] = 'application/json';
    }
    return Promise.resolve(
      app.request(`/api${path}`, { method, headers, ...(body === undefined ? {} : { body }) }),
    );
  };

  return {
    deps,
    app,
    logs,
    call,
    async json<T>(actor: Actor, method: string, path: string, body?: unknown, status = 200) {
      const response = await call(actor, method, path, body === undefined ? {} : { body });
      const text = await response.text();
      if (response.status !== status) {
        throw new Error(
          `${method} ${path}: expected ${String(status)}, got ${String(response.status)} ${text}`,
        );
      }
      return JSON.parse(text) as T;
    },
  };
}
