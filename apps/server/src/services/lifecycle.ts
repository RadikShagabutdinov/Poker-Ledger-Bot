import { canCancelEvent } from '@pokerledger/core';

import { insertGameEvent, markEventCancelled } from '../db/repositories/gameEvents';
import { deleteGameResults } from '../db/repositories/gameResults';
import { updateGame } from '../db/repositories/games';
import { deleteSettlement } from '../db/repositories/settlements';
import type { GameRow } from '../db/schema';
import type { Actor } from './context';
import type { ServiceDeps } from './deps';
import { loadGameData, toCoreView } from './gameData';
import { assertCanHaveAnotherActiveGame } from './games';
import { finishedGameEditor, mutateGame } from './mutate';
import { assertAllowed, canEditFinished, type GameAccess } from './permissions';

/**
 * `POST /games/:gameId/reopen`: creator or admin, only if the chat has
 * no other active game in V1. The `cash_out` events written by finishing are
 * cancelled, so those players are seated again with their chips; results and the
 * settlement are dropped until the next finish.
 */
export async function reopenGame(
  deps: ServiceDeps,
  actor: Actor,
  gameId: string,
  input: { readonly expectedVersion?: number | undefined } = {},
): Promise<void> {
  await mutateGame(
    deps,
    actor,
    gameId,
    { expectedVersion: input.expectedVersion, authorize: finishedGameEditor },
    ({ tx, game, now }) => {
      assertCanHaveAnotherActiveGame(tx, game.chatId);
      // Latest first, skipping any whose cancel would break the sequence (e.g. the
      // player re-entered in a later edit).
      const finishCashOuts = loadGameData(tx, game)
        .events.filter(
          (e) => e.type === 'cash_out' && e.cancelledAt === null && e.payload?.source === 'finish',
        )
        .reverse();
      for (const event of finishCashOuts) {
        const view = toCoreView(loadGameData(tx, game));
        if (canCancelEvent(view.players, view.events, view.toCore(event.id) as number).ok) {
          markEventCancelled(tx, game.id, event.id, actor.tgUserId, now);
        }
      }
      deleteGameResults(tx, game.id);
      deleteSettlement(tx, game.id);
      updateGame(tx, game.id, {
        status: 'active',
        finishedAt: null,
        mismatchMode: null,
        mismatchPlayerId: null,
        mismatchChips: null,
        settlementIsManual: false,
      });
      insertGameEvent(tx, {
        gameId: game.id,
        playerId: null,
        type: 'game_reopened',
        createdBy: actor.tgUserId,
        createdAt: now,
      });
    },
  );
}

function gameDeleter(_game: GameRow, access: GameAccess): void {
  assertAllowed(access, canEditFinished(access));
}

/**
 * `DELETE /games/:gameId`: soft delete by the creator or an admin, for
 * active (e.g. empty) and finished games. Deleted games disappear from
 * history and statistics.
 */
export async function deleteGame(deps: ServiceDeps, actor: Actor, gameId: string): Promise<void> {
  await mutateGame(deps, actor, gameId, { authorize: gameDeleter }, ({ tx, game, now }) => {
    updateGame(tx, game.id, { status: 'deleted', deletedAt: now });
    insertGameEvent(tx, {
      gameId: game.id,
      playerId: null,
      type: 'game_deleted',
      payload: { previousStatus: game.status },
      createdBy: actor.tgUserId,
      createdAt: now,
    });
  });
}
