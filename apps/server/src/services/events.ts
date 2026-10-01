import { canCancelEvent, inferBuyType, validateNewEvent } from '@pokerledger/core';
import { buyChipsSchema, chipsSchema } from '@pokerledger/shared';

import { insertGameEvent, markEventCancelled } from '../db/repositories/gameEvents';
import { findGamePlayer } from '../db/repositories/gamePlayers';
import type { GameEventRow } from '../db/schema';
import type { Actor } from './context';
import type { ServiceDeps } from './deps';
import { ServiceError, parseInput } from './errors';
import {
  eventsInCalculationOrder,
  isChipEventType,
  loadGameData,
  toCoreView,
  type ChipEventType,
  type CoreView,
} from './gameData';
import { seatPlayer } from './games';
import { activeGameMember, mutateGame, type MutationContext } from './mutate';
import { ensureChatPlayer } from './players';

/** «Undo mine» in the chat reaches back this far (V1-MSG-03, SPEC §19.6). */
export const UNDO_MINE_WINDOW_MS = 15 * 60 * 1000;

export interface RecordedEvent {
  readonly eventId: number;
  readonly playerId: string;
  readonly type: ChipEventType;
  readonly chips: number;
}

export function sequenceError(
  view: CoreView,
  error: { eventId: number; reason: string },
): ServiceError {
  return new ServiceError('INVALID_EVENT_SEQUENCE', {
    eventId: view.fromCore(error.eventId),
    reason: error.reason,
  });
}

function assertPlayerInGame(ctx: MutationContext, playerId: string): void {
  if (!findGamePlayer(ctx.tx, ctx.game.id, playerId)) {
    throw new ServiceError('NOT_FOUND', { playerId });
  }
}

function appendChipEvent(
  ctx: MutationContext,
  playerId: string,
  type: ChipEventType | 'buy',
  chips: number,
  expect?: 'buy_in' | 'rebuy',
): RecordedEvent {
  const { tx, game, actor, now } = ctx;
  const view = toCoreView(loadGameData(tx, game));
  const resolved = type === 'buy' ? inferBuyType(view.players, view.events, playerId) : type;
  if (expect !== undefined && resolved !== expect) {
    throw new ServiceError('INVALID_EVENT_SEQUENCE', {
      reason: resolved === 'rebuy' ? 'ALREADY_SEATED' : 'NOT_SEATED',
    });
  }
  const check = validateNewEvent(view.players, view.events, { playerId, type: resolved, chips });
  if (!check.ok) {
    // The new event has no stored id yet.
    throw new ServiceError('INVALID_EVENT_SEQUENCE', { reason: check.error.reason });
  }
  const row = insertGameEvent(tx, {
    gameId: game.id,
    playerId,
    type: resolved,
    chips,
    createdBy: actor.tgUserId,
    createdAt: now,
  });
  return { eventId: row.id, playerId, type: resolved, chips };
}

export interface RecordBuyInput {
  readonly playerId: string;
  readonly chips: number;
}

/**
 * `POST /games/:gameId/events` with `type: "buy"`: a buy-in if the player is not
 * seated, otherwise a rebuy (V1-PLAY-05).
 */
export async function recordBuy(
  deps: ServiceDeps,
  actor: Actor,
  gameId: string,
  input: RecordBuyInput,
): Promise<RecordedEvent> {
  const chips = parseInput(buyChipsSchema, input.chips);
  return mutateGame(deps, actor, gameId, { authorize: activeGameMember }, (ctx) => {
    assertPlayerInGame(ctx, input.playerId);
    return appendChipEvent(ctx, input.playerId, 'buy', chips);
  });
}

/** `POST /games/:gameId/events` with `type: "cash_out"` (V1-PLAY-03). */
export async function recordCashOut(
  deps: ServiceDeps,
  actor: Actor,
  gameId: string,
  input: RecordBuyInput,
): Promise<RecordedEvent> {
  const chips = parseInput(chipsSchema, input.chips);
  return mutateGame(deps, actor, gameId, { authorize: activeGameMember }, (ctx) => {
    assertPlayerInGame(ctx, input.playerId);
    return appendChipEvent(ctx, input.playerId, 'cash_out', chips);
  });
}

/**
 * Chat buttons «I'm in» (`expect: 'buy_in'`) and «Rebuy» (`expect: 'rebuy'`)
 * (V1-MSG-03): the actor buys one stack (or `chips`) for themselves, joining the
 * chat and the game if needed. A wrong state gives `INVALID_EVENT_SEQUENCE` with
 * `reason: 'ALREADY_SEATED' | 'NOT_SEATED'` and nothing is written.
 */
export async function buySelf(
  deps: ServiceDeps,
  actor: Actor,
  gameId: string,
  input: { readonly expect: 'buy_in' | 'rebuy'; readonly chips?: number | undefined },
): Promise<RecordedEvent> {
  return mutateGame(deps, actor, gameId, { authorize: activeGameMember }, (ctx) => {
    const player = ensureChatPlayer(ctx.tx, ctx.chat.id, actor.tgUserId, ctx.now);
    if (input.expect === 'rebuy' && !findGamePlayer(ctx.tx, ctx.game.id, player.id)) {
      throw new ServiceError('INVALID_EVENT_SEQUENCE', { reason: 'NOT_SEATED' });
    }
    seatPlayer(ctx, player.id);
    const chips = parseInput(buyChipsSchema, input.chips ?? ctx.game.stackChips);
    return appendChipEvent(ctx, player.id, 'buy', chips, input.expect);
  });
}

export interface CancelledEvent {
  readonly eventId: number;
  readonly playerId: string;
  readonly type: ChipEventType;
  readonly chips: number;
}

/**
 * Cancels a chip event (V1-LOG-02). Rejects a cancel that would break the sequence
 * with `INVALID_EVENT_SEQUENCE` and `blockingEventId`, the event to cancel first
 * (V1-LOG-04). Game-level events are not cancellable.
 */
export function cancelChipEvent(ctx: MutationContext, eventId: number): CancelledEvent {
  const { tx, game, actor, now } = ctx;
  const data = loadGameData(tx, game);
  const row = data.events.find((e) => e.id === eventId);
  if (!row) {
    throw new ServiceError('NOT_FOUND', { eventId });
  }
  if (!isChipEventType(row.type) || row.playerId === null || row.chips === null) {
    throw new ServiceError('EVENT_NOT_CANCELLABLE', { eventId });
  }
  if (row.cancelledAt !== null) {
    throw new ServiceError('EVENT_NOT_CANCELLABLE', { eventId, reason: 'ALREADY_CANCELLED' });
  }
  const view = toCoreView(data);
  const check = canCancelEvent(view.players, view.events, view.toCore(eventId) as number);
  if (!check.ok) {
    if (check.error.code === 'INVALID_EVENT_SEQUENCE') {
      throw new ServiceError('INVALID_EVENT_SEQUENCE', {
        eventId,
        blockingEventId: view.fromCore(check.error.blockingEventId),
      });
    }
    throw new ServiceError('EVENT_NOT_CANCELLABLE', { eventId });
  }
  markEventCancelled(tx, game.id, eventId, actor.tgUserId, now);
  return { eventId, playerId: row.playerId, type: row.type, chips: row.chips };
}

/** `POST /games/:gameId/events/:eventId/cancel` in an active game. */
export async function cancelEvent(
  deps: ServiceDeps,
  actor: Actor,
  gameId: string,
  eventId: number,
): Promise<CancelledEvent> {
  return mutateGame(deps, actor, gameId, { authorize: activeGameMember }, (ctx) =>
    cancelChipEvent(ctx, eventId),
  );
}

/**
 * `POST /games/:gameId/undo` (V1-LOG-03): cancels the last non-cancelled chip event.
 * With `mineOnly` (chat button «Undo mine», V1-MSG-03) it is the actor's last event,
 * and only if it is at most 15 minutes old.
 */
export async function undoLast(
  deps: ServiceDeps,
  actor: Actor,
  gameId: string,
  options: { readonly mineOnly?: boolean | undefined } = {},
): Promise<CancelledEvent> {
  return mutateGame(deps, actor, gameId, { authorize: activeGameMember }, (ctx) => {
    const data = loadGameData(ctx.tx, ctx.game);
    const ordered = eventsInCalculationOrder(data, toCoreView(data));
    const candidates = ordered.filter(
      (e: GameEventRow) =>
        isChipEventType(e.type) &&
        e.cancelledAt === null &&
        (!options.mineOnly || e.createdBy === actor.tgUserId),
    );
    const last = candidates.at(-1);
    if (!last || (options.mineOnly && ctx.now - last.createdAt > UNDO_MINE_WINDOW_MS)) {
      throw new ServiceError('NOTHING_TO_UNDO');
    }
    return cancelChipEvent(ctx, last.id);
  });
}
