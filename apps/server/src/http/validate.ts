import { gameIdSchema } from '@pokerledger/shared';
import type { Context } from 'hono';
import type { z } from 'zod';

import { ServiceError } from '../services';
import { parseInput } from '../services/errors';

/**
 * Parses the JSON body with a shared schema. An empty body counts as `{}`, so
 * endpoints with optional fields accept a bare POST.
 */
export async function readJson<S extends z.ZodType>(c: Context, schema: S): Promise<z.output<S>> {
  const text = await c.req.text();
  let value: unknown = {};
  if (text.trim() !== '') {
    try {
      value = JSON.parse(text);
    } catch {
      throw new ServiceError('VALIDATION', { reason: 'INVALID_JSON' });
    }
  }
  return parseInput(schema, value);
}

export function readQuery<S extends z.ZodType>(c: Context, schema: S): z.output<S> {
  return parseInput(schema, c.req.query());
}

/** A malformed game id cannot exist: `NOT_FOUND`, like an unknown one. */
export function gameIdParam(c: Context): string {
  const gameId = c.req.param('gameId');
  if (!gameIdSchema.safeParse(gameId).success) {
    throw new ServiceError('NOT_FOUND');
  }
  return gameId as string;
}

export function eventIdParam(c: Context): number {
  const eventId = Number(c.req.param('eventId'));
  if (!Number.isSafeInteger(eventId) || eventId <= 0) {
    throw new ServiceError('NOT_FOUND');
  }
  return eventId;
}

export function param(c: Context, name: string): string {
  return c.req.param(name) ?? '';
}
