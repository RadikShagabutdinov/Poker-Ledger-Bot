import { validate } from '@tma.js/init-data-node';
import type { MiddlewareHandler } from 'hono';
import { z } from 'zod';

import { ServiceError, touchActor, type Actor, type ServiceDeps } from '../services';
import type { AppEnv } from './env';

/** initData is accepted for 24 hours after `auth_date` (SEC-01). */
export const INIT_DATA_MAX_AGE_S = 24 * 60 * 60;

const userSchema = z.object({
  id: z.number().int().positive(),
  first_name: z.string(),
  last_name: z.string().optional(),
  username: z.string().optional(),
  language_code: z.string().optional(),
});

/** The Telegram user of an initData string, or `undefined`. */
export function actorFromInitData(raw: string): Actor | undefined {
  const json = new URLSearchParams(raw).get('user');
  if (json === null) {
    return undefined;
  }
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return undefined;
  }
  const user = userSchema.safeParse(value);
  if (!user.success) {
    return undefined;
  }
  return {
    tgUserId: user.data.id,
    firstName: user.data.first_name,
    lastName: user.data.last_name,
    username: user.data.username,
    languageCode: user.data.language_code,
  };
}

export interface AuthOptions {
  readonly botToken: string;
  /** Dev only (SPEC §16.6): skip the signature and age check, still read the user. */
  readonly skipCheck: boolean;
}

/**
 * `Authorization: tma <initDataRaw>` (SEC-01). A valid request gets `c.var.actor`
 * and refreshes the user's name (V1-PROF-04); anything else is `401 UNAUTHORIZED`.
 * initData is never logged.
 */
export function initDataAuth(
  services: ServiceDeps,
  options: AuthOptions,
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const match = /^tma (.+)$/.exec(c.req.header('authorization') ?? '');
    const raw = match?.[1];
    if (raw === undefined) {
      throw new ServiceError('UNAUTHORIZED');
    }
    if (!options.skipCheck) {
      try {
        validate(raw, options.botToken, { expiresIn: INIT_DATA_MAX_AGE_S });
      } catch {
        throw new ServiceError('UNAUTHORIZED');
      }
    }
    const actor = actorFromInitData(raw);
    if (!actor) {
      throw new ServiceError('UNAUTHORIZED');
    }
    touchActor(services, actor);
    c.set('actor', actor);
    await next();
  };
}
