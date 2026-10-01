import type { MismatchMode } from '@pokerledger/core';
import { buyChipsSchema, chipsSchema, mismatchModeSchema } from '@pokerledger/shared';

import { insertGameEvent, markEventCancelled } from '../db/repositories/gameEvents';
import { findGamePlayer } from '../db/repositories/gamePlayers';
import { updateGame } from '../db/repositories/games';
import type { GameEventRow, GameRow } from '../db/schema';
import type { Actor } from './context';
import type { ServiceDeps } from './deps';
import { ServiceError, parseInput } from './errors';
import { isChipEventType, loadGameData, type ChipEventType } from './gameData';
import { finishedGameEditor, mutateGame, type MutationContext } from './mutate';
import { mismatchOf, recalculateFinishedGame, type SettlementPolicy } from './results';

export interface FinishedEventsEdit {
  /** Chip events to cancel. */
  readonly cancel?: readonly number[] | undefined;
  /** New chip events, appended after all existing ones. */
  readonly add?:
    | readonly { readonly playerId: string; readonly type: ChipEventType; readonly chips: number }[]
    | undefined;
  /** Chip amount corrections: the new event takes the place of the old one. */
  readonly replace?: readonly { readonly eventId: number; readonly chips: number }[] | undefined;
  readonly expectedVersion?: number | undefined;
  /** Required when a manual settlement exists and money results change (V1-SETL-07). */
  readonly settlementPolicy?: SettlementPolicy | undefined;
}

function parseChips(type: ChipEventType, chips: number): number {
  return parseInput(type === 'cash_out' ? chipsSchema : buyChipsSchema, chips);
}

function activeChipEvent(events: readonly GameEventRow[], eventId: number): GameEventRow {
  const row = events.find((e) => e.id === eventId);
  if (!row) {
    throw new ServiceError('NOT_FOUND', { eventId });
  }
  if (!isChipEventType(row.type) || row.cancelledAt !== null) {
    throw new ServiceError('EVENT_NOT_CANCELLABLE', { eventId });
  }
  return row;
}

/**
 * Edits events of a finished game in one atomic batch (V1-EDIT-01): cancel, replace
 * the chip amount of an event in place, add new events. After the batch the
 * sequence must be valid and nobody may be seated; then `game_results` and the
 * settlement are recalculated (V1-RES-03). Every change stays in the log (V1-EDIT-04).
 */
export async function editFinishedEvents(
  deps: ServiceDeps,
  actor: Actor,
  gameId: string,
  edit: FinishedEventsEdit,
): Promise<void> {
  const cancel = edit.cancel ?? [];
  const replace = edit.replace ?? [];
  const add = edit.add ?? [];
  if (cancel.length + replace.length + add.length === 0) {
    throw new ServiceError('VALIDATION', { reason: 'EMPTY_EDIT' });
  }
  const touched = [...cancel, ...replace.map((r) => r.eventId)];
  if (new Set(touched).size !== touched.length) {
    throw new ServiceError('VALIDATION', { reason: 'DUPLICATE_EVENT' });
  }

  await mutateGame(
    deps,
    actor,
    gameId,
    { expectedVersion: edit.expectedVersion, authorize: finishedGameEditor },
    (ctx: MutationContext) => {
      const { tx, game, now } = ctx;
      const { events } = loadGameData(tx, game);
      for (const eventId of cancel) {
        activeChipEvent(events, eventId);
        markEventCancelled(tx, game.id, eventId, actor.tgUserId, now);
      }
      for (const { eventId, chips } of replace) {
        const row = activeChipEvent(events, eventId);
        const type = row.type as ChipEventType;
        const value = parseChips(type, chips);
        markEventCancelled(tx, game.id, eventId, actor.tgUserId, now);
        insertGameEvent(tx, {
          gameId: game.id,
          playerId: row.playerId,
          type,
          chips: value,
          payload: {
            replaces: eventId,
            ...(row.payload?.source ? { source: row.payload.source } : {}),
          },
          createdBy: actor.tgUserId,
          createdAt: now,
        });
      }
      for (const event of add) {
        if (!isChipEventType(event.type)) {
          throw new ServiceError('VALIDATION', { reason: 'INVALID_EVENT_TYPE' });
        }
        if (!findGamePlayer(tx, game.id, event.playerId)) {
          throw new ServiceError('NOT_FOUND', { playerId: event.playerId });
        }
        insertGameEvent(tx, {
          gameId: game.id,
          playerId: event.playerId,
          type: event.type,
          chips: parseChips(event.type, event.chips),
          createdBy: actor.tgUserId,
          createdAt: now,
        });
      }
      recalculateFinishedGame(tx, game, edit.settlementPolicy);
    },
  );
}

/**
 * Changes how the chip mismatch of a finished game is adjusted (V1-EDIT-01,
 * V1-FIN-04) and recalculates the results.
 */
export async function updateFinishedMismatch(
  deps: ServiceDeps,
  actor: Actor,
  gameId: string,
  input: {
    readonly mismatch: MismatchMode;
    readonly expectedVersion?: number | undefined;
    readonly settlementPolicy?: SettlementPolicy | undefined;
  },
): Promise<void> {
  const mismatch = parseInput(mismatchModeSchema, input.mismatch);
  await mutateGame(
    deps,
    actor,
    gameId,
    { expectedVersion: input.expectedVersion, authorize: finishedGameEditor },
    ({ tx, game, now }) => {
      const updated: GameRow = updateGame(tx, game.id, {
        mismatchMode: mismatch.mode,
        mismatchPlayerId: mismatch.mode === 'single_player' ? mismatch.playerId : null,
      });
      insertGameEvent(tx, {
        gameId: game.id,
        playerId: null,
        type: 'settings_changed',
        payload: { mismatch: { from: mismatchOf(game), to: mismatch } },
        createdBy: actor.tgUserId,
        createdAt: now,
      });
      recalculateFinishedGame(tx, updated, input.settlementPolicy);
    },
  );
}
