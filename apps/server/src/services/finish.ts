import { computePlayerTotals, type CashGameResult, type MismatchMode } from '@pokerledger/core';
import { mismatchModeSchema } from '@pokerledger/shared';
import { z } from 'zod';

import { insertGameEvent } from '../db/repositories/gameEvents';
import { updateGame } from '../db/repositories/games';
import type { GameRow } from '../db/schema';
import type { Actor } from './context';
import type { ServiceDeps } from './deps';
import { ServiceError, parseInput } from './errors';
import { isChipEventType, loadGameData, toCoreView, type GameData } from './gameData';
import { activeGameMember, mutateGame } from './mutate';
import { computeResult, storeFinishedResults } from './results';
import { loadViewableGame } from './state';

export interface FinishInput {
  /** Chips counted for every player still seated. */
  readonly finalChips: Readonly<Record<string, number>>;
  readonly mismatch: MismatchMode;
}

// Values are checked by core (`INVALID_FINAL_CHIPS`); here only the shape.
const finalChipsSchema = z.record(z.string(), z.number());

export interface FinishPreview {
  readonly mismatchChips: number;
  readonly summary: CashGameResult['summary'];
  readonly players: readonly {
    readonly playerId: string;
    readonly inChips: number;
    readonly outChips: number;
    readonly adjustmentChips: { readonly num: number; readonly den: number };
    readonly moneyResult: number;
  }[];
  readonly transfers: CashGameResult['transfers'];
}

function toPreview(result: CashGameResult): FinishPreview {
  return {
    mismatchChips: result.mismatchChips,
    summary: result.summary,
    players: result.players.map((p) => ({
      playerId: p.playerId,
      inChips: p.in,
      outChips: p.out,
      adjustmentChips: p.adjustmentChips,
      moneyResult: p.moneyResult,
    })),
    transfers: result.transfers,
  };
}

function parseFinishInput(input: FinishInput): FinishInput {
  parseInput(finalChipsSchema, input.finalChips);
  return { finalChips: input.finalChips, mismatch: parseInput(mismatchModeSchema, input.mismatch) };
}

/** A game without chip events can only be deleted. */
function assertNotEmpty(data: GameData): void {
  if (!data.events.some((e) => isChipEventType(e.type) && e.cancelledAt === null)) {
    throw new ServiceError('EMPTY_GAME');
  }
}

/**
 * `POST /games/:gameId/finish/preview`: results, mismatch and the
 * automatic settlement. Writes nothing.
 */
export async function previewFinish(
  deps: ServiceDeps,
  actor: Actor,
  gameId: string,
  rawInput: FinishInput,
): Promise<FinishPreview> {
  const input = parseFinishInput(rawInput);
  const { game, access } = await loadViewableGame(deps, actor, gameId);
  activeGameMember(game, access);
  const data = loadGameData(deps.db, game);
  assertNotEmpty(data);
  return toPreview(computeResult(data, input.mismatch, input.finalChips));
}

/**
 * `POST /games/:gameId/finish` with `expectedVersion`. The counted
 * chips of seated players are stored as their `cash_out` events
 * (`payload.source = 'finish'`); then results, mismatch and the automatic settlement
 * are stored and the game becomes finished.
 */
export async function finishGame(
  deps: ServiceDeps,
  actor: Actor,
  gameId: string,
  rawInput: FinishInput & { readonly expectedVersion: number },
): Promise<FinishPreview> {
  const input = parseFinishInput(rawInput);
  return mutateGame(
    deps,
    actor,
    gameId,
    { expectedVersion: rawInput.expectedVersion, authorize: activeGameMember },
    ({ tx, game, now }) => {
      const data = loadGameData(tx, game);
      assertNotEmpty(data);
      // Validates everything (missing chips, mismatch player) before writing.
      computeResult(data, input.mismatch, input.finalChips);

      const view = toCoreView(data);
      const seated = computePlayerTotals(view.players, view.events)
        .filter((t) => t.status === 'seated')
        .sort((a, b) => a.seatOrder - b.seatOrder);
      for (const t of seated) {
        const chips = input.finalChips[t.playerId];
        if (chips === undefined) {
          throw new Error(`Final chips of ${t.playerId} passed validation but are missing`);
        }
        insertGameEvent(tx, {
          gameId: game.id,
          playerId: t.playerId,
          type: 'cash_out',
          chips,
          payload: { source: 'finish' },
          createdBy: actor.tgUserId,
          createdAt: now,
        });
      }
      const finished: GameRow = updateGame(tx, game.id, {
        status: 'finished',
        finishedAt: now,
        mismatchMode: input.mismatch.mode,
        mismatchPlayerId: input.mismatch.mode === 'single_player' ? input.mismatch.playerId : null,
      });
      const result = storeFinishedResults(tx, finished);
      insertGameEvent(tx, {
        gameId: game.id,
        playerId: null,
        type: 'game_finished',
        payload: {
          mismatchChips: result.mismatchChips,
          mismatchMode: input.mismatch.mode,
        },
        createdBy: actor.tgUserId,
        createdAt: now,
      });
      return toPreview(result);
    },
  );
}
