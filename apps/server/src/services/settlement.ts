import {
  checkManualSettlement,
  computeSettlement,
  validateTransfers,
  type SettlementWarning,
  type Transfer,
} from '@pokerledger/core';
import { transferSchema } from '@pokerledger/shared';
import { z } from 'zod';

import { findChatPlayersWithUsers } from '../db/repositories/chatPlayers';
import { insertGameEvent } from '../db/repositories/gameEvents';
import { listGamePlayers } from '../db/repositories/gamePlayers';
import { listGameResults } from '../db/repositories/gameResults';
import { findGame, updateGame } from '../db/repositories/games';
import { listSettlement, replaceSettlement } from '../db/repositories/settlements';
import type { DbOrTx } from '../db/client';
import type { GameRow } from '../db/schema';
import type { Actor } from './context';
import type { ServiceDeps } from './deps';
import { ServiceError, parseInput } from './errors';
import { mutateGame, type MutationContext } from './mutate';
import {
  assertAllowed,
  canEditSettlement,
  canSeePaymentDetails,
  type GameAccess,
} from './permissions';
import { loadViewableGame } from './state';

/** Payment details of a recipient (V1-PROF-02). Only for players of the game (SEC-04). */
export interface PaymentDetails {
  readonly phone: string | null;
  readonly bank: string | null;
  readonly note: string | null;
}

export interface SettlementView {
  readonly version: number;
  readonly isManual: boolean;
  readonly transfers: readonly (Transfer & {
    /** Present only for players of the game and recipients who filled them in. */
    readonly recipientPayment?: PaymentDetails;
  })[];
  /** Balance mismatches of a manual settlement (V1-SETL-04). */
  readonly warnings: readonly SettlementWarning[];
}

function assertFinished(game: GameRow): void {
  if (game.status !== 'finished') {
    throw new ServiceError('INVALID_GAME_STATUS', { status: game.status });
  }
}

function moneyResults(db: DbOrTx, gameId: string) {
  return listGameResults(db, gameId).map((r) => ({ playerId: r.playerId, money: r.moneyResult }));
}

function storedTransfers(db: DbOrTx, gameId: string): Transfer[] {
  return listSettlement(db, gameId).map((s) => ({
    from: s.fromPlayerId,
    to: s.toPlayerId,
    amount: s.amount,
  }));
}

function paymentDetailsOf(db: DbOrTx, playerIds: readonly string[]): Map<string, PaymentDetails> {
  const details = new Map<string, PaymentDetails>();
  for (const { player, user } of findChatPlayersWithUsers(db, playerIds)) {
    if (user && (user.payPhone || user.payBank || user.payNote)) {
      details.set(player.id, { phone: user.payPhone, bank: user.payBank, note: user.payNote });
    }
  }
  return details;
}

/**
 * Settlement of a finished game. Payment details are included only when
 * `withPaymentDetails` is set; callers decide by `canSeePaymentDetails`.
 */
export function buildSettlementView(
  db: DbOrTx,
  game: GameRow,
  withPaymentDetails: boolean,
): SettlementView {
  const transfers = storedTransfers(db, game.id);
  const payments = withPaymentDetails
    ? paymentDetailsOf(db, [...new Set(transfers.map((t) => t.to))])
    : new Map<string, PaymentDetails>();
  return {
    version: game.version,
    isManual: game.settlementIsManual,
    transfers: transfers.map((t) => {
      const payment = payments.get(t.to);
      return payment ? { ...t, recipientPayment: payment } : t;
    }),
    warnings: checkManualSettlement(transfers, moneyResults(db, game.id)),
  };
}

/**
 * `GET /games/:gameId/settlement` (V1-SETL-02). The only place that returns payment
 * details, and only to players of the game (SEC-04).
 */
export async function getSettlement(
  deps: ServiceDeps,
  actor: Actor,
  gameId: string,
): Promise<SettlementView> {
  const { game, access } = await loadViewableGame(deps, actor, gameId);
  assertFinished(game);
  return buildSettlementView(deps.db, game, canSeePaymentDetails(access));
}

function settlementEditor(game: GameRow, access: GameAccess): void {
  assertAllowed(access, canEditSettlement(access));
  assertFinished(game);
}

const transfersSchema = z.array(transferSchema).max(1000);

function afterEdit(ctx: MutationContext, payload: Record<string, unknown>): SettlementView {
  const { tx, game, actor, now } = ctx;
  insertGameEvent(tx, {
    gameId: game.id,
    playerId: null,
    type: 'settlement_edited',
    payload,
    createdBy: actor.tgUserId,
    createdAt: now,
  });
  const updated = findGame(tx, game.id) as GameRow;
  return buildSettlementView(tx, { ...updated, version: ctx.nextVersion }, false);
}

/**
 * `PUT /games/:gameId/settlement` (V1-SETL-03..05, V1-SETL-07). Rejects only
 * non-positive amounts and self-transfers; balance mismatches are returned as
 * warnings and do not block saving.
 */
export async function saveSettlement(
  deps: ServiceDeps,
  actor: Actor,
  gameId: string,
  input: { readonly transfers: readonly Transfer[]; readonly expectedVersion: number },
): Promise<SettlementView> {
  const transfers = parseInput(transfersSchema, input.transfers);
  const errors = validateTransfers(transfers);
  if (errors.length > 0) {
    throw new ServiceError('VALIDATION', { transfers: errors });
  }
  return mutateGame(
    deps,
    actor,
    gameId,
    { expectedVersion: input.expectedVersion, authorize: settlementEditor },
    (ctx) => {
      const players = new Set(listGamePlayers(ctx.tx, ctx.game.id).map((p) => p.playerId));
      const unknown = transfers.flatMap((t) => [t.from, t.to]).filter((id) => !players.has(id));
      if (unknown.length > 0) {
        throw new ServiceError('VALIDATION', {
          reason: 'UNKNOWN_PLAYER',
          playerIds: [...new Set(unknown)],
        });
      }
      replaceSettlement(ctx.tx, ctx.game.id, transfers);
      updateGame(ctx.tx, ctx.game.id, { settlementIsManual: true });
      return afterEdit(ctx, { manual: true, transfers: transfers.length });
    },
  );
}

/** `POST /games/:gameId/settlement/reset`: back to the automatic settlement (V1-SETL-03). */
export async function resetSettlement(
  deps: ServiceDeps,
  actor: Actor,
  gameId: string,
  input: { readonly expectedVersion?: number | undefined } = {},
): Promise<SettlementView> {
  return mutateGame(
    deps,
    actor,
    gameId,
    { expectedVersion: input.expectedVersion, authorize: settlementEditor },
    (ctx) => {
      const seats = new Map(
        listGamePlayers(ctx.tx, ctx.game.id).map((p) => [p.playerId, p.seatOrder]),
      );
      const transfers = computeSettlement(
        listGameResults(ctx.tx, ctx.game.id).map((r) => ({
          playerId: r.playerId,
          seatOrder: seats.get(r.playerId) ?? 0,
          amount: r.moneyResult,
        })),
      );
      replaceSettlement(ctx.tx, ctx.game.id, transfers);
      updateGame(ctx.tx, ctx.game.id, { settlementIsManual: false });
      return afterEdit(ctx, { manual: false, reset: true });
    },
  );
}
