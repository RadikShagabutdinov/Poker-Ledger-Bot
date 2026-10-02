import {
  addGamePlayerBodySchema,
  cancelEventBodySchema,
  editFinishedBodySchema,
  finishBodySchema,
  finishPreviewBodySchema,
  gameEventBodySchema,
  undoBodySchema,
  updateGameBodySchema,
  versionBodySchema,
  type FinishPreviewBody,
} from '@pokerledger/shared';
import type { MismatchMode } from '@pokerledger/core';
import { Hono, type Context } from 'hono';

import {
  ServiceError,
  addPlayerToGame,
  cancelGameEvent,
  deleteGame,
  editFinishedEvents,
  finishGame,
  getGameLog,
  getGameState,
  previewFinish,
  recordGameEvent,
  reopenGame,
  undoLast,
  updateFinishedMismatch,
  updateGame,
  type ServiceDeps,
} from '../../services';
import type { AppEnv } from '../env';
import { eventIdParam, gameIdParam, readJson } from '../validate';

/** The flat mismatch fields of SPEC §11 in the services' form. */
function mismatchOf(
  body: Pick<FinishPreviewBody, 'mismatchMode' | 'mismatchPlayerId'>,
): MismatchMode {
  if (body.mismatchMode === 'proportional') {
    return { mode: 'proportional' };
  }
  if (body.mismatchPlayerId === undefined) {
    throw new ServiceError('VALIDATION', { reason: 'MISMATCH_PLAYER_REQUIRED' });
  }
  return { mode: 'single_player', playerId: body.mismatchPlayerId };
}

/**
 * Game routes (SPEC §11). Mutations answer with the fresh game state so the Mini App
 * can update its cache without another request.
 */
export function gameRoutes(services: ServiceDeps): Hono<AppEnv> {
  const state = (c: Context<AppEnv>, gameId: string) => getGameState(services, c.var.actor, gameId);

  return new Hono<AppEnv>()
    .get('/games/:gameId', async (c) => c.json(await state(c, gameIdParam(c))))
    .patch('/games/:gameId', async (c) => {
      const gameId = gameIdParam(c);
      const body = await readJson(c, updateGameBodySchema);
      const { expectedVersion, settlementPolicy } = body;
      if (body.mismatchMode !== undefined) {
        // The mismatch adjustment of a finished game is a separate change (V1-EDIT-01).
        if (body.name !== undefined || body.stack !== undefined) {
          throw new ServiceError('VALIDATION', { reason: 'MISMATCH_WITH_OTHER_FIELDS' });
        }
        await updateFinishedMismatch(services, c.var.actor, gameId, {
          mismatch: mismatchOf({
            mismatchMode: body.mismatchMode,
            mismatchPlayerId: body.mismatchPlayerId,
          }),
          expectedVersion,
          settlementPolicy,
        });
      } else {
        await updateGame(services, c.var.actor, gameId, {
          name: body.name,
          stack: body.stack,
          expectedVersion,
          settlementPolicy,
        });
      }
      return c.json({ game: await state(c, gameId) });
    })
    .delete('/games/:gameId', async (c) => {
      await deleteGame(services, c.var.actor, gameIdParam(c));
      return c.body(null, 204);
    })
    .post('/games/:gameId/players', async (c) => {
      const gameId = gameIdParam(c);
      const body = await readJson(c, addGamePlayerBodySchema);
      const added = await addPlayerToGame(services, c.var.actor, gameId, body);
      return c.json({ ...added, game: await state(c, gameId) });
    })
    .post('/games/:gameId/events', async (c) => {
      const gameId = gameIdParam(c);
      const body = await readJson(c, gameEventBodySchema);
      const event = await recordGameEvent(services, c.var.actor, gameId, body);
      return c.json({ ...(event ? { event } : {}), game: await state(c, gameId) });
    })
    .post('/games/:gameId/events/:eventId/cancel', async (c) => {
      const gameId = gameIdParam(c);
      const eventId = eventIdParam(c);
      const body = await readJson(c, cancelEventBodySchema);
      const event = await cancelGameEvent(services, c.var.actor, gameId, eventId, body);
      return c.json({ ...(event ? { event } : {}), game: await state(c, gameId) });
    })
    .post('/games/:gameId/undo', async (c) => {
      const gameId = gameIdParam(c);
      const body = await readJson(c, undoBodySchema);
      const event = await undoLast(services, c.var.actor, gameId, body);
      return c.json({ event, game: await state(c, gameId) });
    })
    .post('/games/:gameId/edit', async (c) => {
      const gameId = gameIdParam(c);
      const body = await readJson(c, editFinishedBodySchema);
      await editFinishedEvents(services, c.var.actor, gameId, body);
      return c.json({ game: await state(c, gameId) });
    })
    .get('/games/:gameId/log', async (c) => {
      const entries = await getGameLog(services, c.var.actor, gameIdParam(c));
      return c.json({ entries });
    })
    .post('/games/:gameId/finish/preview', async (c) => {
      const gameId = gameIdParam(c);
      const body = await readJson(c, finishPreviewBodySchema);
      return c.json(
        await previewFinish(services, c.var.actor, gameId, {
          finalChips: body.finalChips,
          mismatch: mismatchOf(body),
        }),
      );
    })
    .post('/games/:gameId/finish', async (c) => {
      const gameId = gameIdParam(c);
      const body = await readJson(c, finishBodySchema);
      const result = await finishGame(services, c.var.actor, gameId, {
        finalChips: body.finalChips,
        mismatch: mismatchOf(body),
        expectedVersion: body.expectedVersion,
      });
      return c.json({ result, game: await state(c, gameId) });
    })
    .post('/games/:gameId/reopen', async (c) => {
      const gameId = gameIdParam(c);
      const body = await readJson(c, versionBodySchema);
      await reopenGame(services, c.var.actor, gameId, body);
      return c.json({ game: await state(c, gameId) });
    });
}
