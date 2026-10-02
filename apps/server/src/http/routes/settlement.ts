import { settlementPutBodySchema, versionBodySchema } from '@pokerledger/shared';
import { Hono } from 'hono';

import { getSettlement, resetSettlement, saveSettlement, type ServiceDeps } from '../../services';
import type { AppEnv } from '../env';
import { gameIdParam, readJson } from '../validate';

/**
 * Settlement. The only responses with payment details, and only for
 * players of the game: edits answer like `GET`, so the editor keeps them.
 */
export function settlementRoutes(services: ServiceDeps): Hono<AppEnv> {
  return new Hono<AppEnv>()
    .get('/games/:gameId/settlement', async (c) =>
      c.json(await getSettlement(services, c.var.actor, gameIdParam(c))),
    )
    .put('/games/:gameId/settlement', async (c) => {
      const gameId = gameIdParam(c);
      const body = await readJson(c, settlementPutBodySchema);
      await saveSettlement(services, c.var.actor, gameId, body);
      return c.json(await getSettlement(services, c.var.actor, gameId));
    })
    .post('/games/:gameId/settlement/reset', async (c) => {
      const gameId = gameIdParam(c);
      const body = await readJson(c, versionBodySchema);
      await resetSettlement(services, c.var.actor, gameId, body);
      return c.json(await getSettlement(services, c.var.actor, gameId));
    });
}
