import type { CoreEvent, CorePlayer } from '@pokerledger/core';

import type { DbOrTx } from '../db/client';
import { findChatPlayerByUser } from '../db/repositories/chatPlayers';
import { findChat } from '../db/repositories/chats';
import { listGameEvents } from '../db/repositories/gameEvents';
import { findGamePlayer, listGamePlayers } from '../db/repositories/gamePlayers';
import { findGame } from '../db/repositories/games';
import type { ChatRow, GameEventRow, GamePlayerRow, GameRow, StoredEventType } from '../db/schema';
import type { Actor } from './context';
import type { ServiceDeps } from './deps';
import { ServiceError } from './errors';
import { resolveChatAccess, type GameAccess } from './permissions';

export type ChipEventType = 'buy_in' | 'rebuy' | 'cash_out';

export function isChipEventType(type: StoredEventType): type is ChipEventType {
  return type === 'buy_in' || type === 'rebuy' || type === 'cash_out';
}

/** A game with its players (seat order) and all events (`id` order). */
export interface GameData {
  readonly game: GameRow;
  readonly players: readonly GamePlayerRow[];
  readonly events: readonly GameEventRow[];
}

export function loadGameData(db: DbOrTx, game: GameRow): GameData {
  return {
    game,
    players: listGamePlayers(db, game.id),
    events: listGameEvents(db, game.id),
  };
}

/**
 * Game data in the form core works with. Events are put in calculation order:
 * an event that replaces another one (`payload.replaces`, a finished-game edit)
 * takes the place of the replaced event. Core ids are renumbered in this order;
 * `toCore` / `fromCore` translate between stored and core ids.
 */
export interface CoreView {
  readonly players: CorePlayer[];
  readonly events: CoreEvent[];
  toCore(eventId: number): number | undefined;
  fromCore(coreId: number): number;
}

export function toCoreView(data: GameData): CoreView {
  const byId = new Map(data.events.map((e) => [e.id, e]));
  const rootOf = (event: GameEventRow): number => {
    let current = event;
    const seen = new Set<number>();
    while (current.payload?.replaces !== undefined && !seen.has(current.id)) {
      seen.add(current.id);
      const replaced = byId.get(current.payload.replaces);
      if (!replaced) {
        break;
      }
      current = replaced;
    }
    return current.id;
  };
  const ordered = data.events
    .map((e) => ({ event: e, root: rootOf(e) }))
    .sort((a, b) => a.root - b.root || a.event.id - b.event.id)
    .map((x) => x.event);

  const toCore = new Map<number, number>();
  const fromCore = new Map<number, number>();
  const events = ordered.map((e, index): CoreEvent => {
    const coreId = index + 1;
    toCore.set(e.id, coreId);
    fromCore.set(coreId, e.id);
    return {
      id: coreId,
      playerId: e.playerId,
      type: e.type,
      chips: e.chips,
      cancelled: e.cancelledAt !== null,
    };
  });
  return {
    players: data.players.map((p) => ({ id: p.playerId, seatOrder: p.seatOrder })),
    events,
    toCore: (id) => toCore.get(id),
    fromCore: (id) => fromCore.get(id) ?? id,
  };
}

/** Stored events in calculation order (see `toCoreView`). */
export function eventsInCalculationOrder(data: GameData, view: CoreView): GameEventRow[] {
  const byId = new Map(data.events.map((e) => [e.id, e]));
  return view.events.map((e) => byId.get(view.fromCore(e.id)) as GameEventRow);
}

/** Loads a non-deleted game and its chat, or throws `NOT_FOUND`. */
export function findVisibleGame(db: DbOrTx, gameId: string): { game: GameRow; chat: ChatRow } {
  const game = findGame(db, gameId);
  if (!game || game.status === 'deleted') {
    throw new ServiceError('NOT_FOUND');
  }
  const chat = findChat(db, game.chatId) as ChatRow;
  return { game, chat };
}

/** Whether the Telegram user is linked to one of the game's players. */
export function isUserInGame(db: DbOrTx, game: GameRow, tgUserId: number): boolean {
  const player = findChatPlayerByUser(db, game.chatId, tgUserId);
  return player !== undefined && findGamePlayer(db, game.id, player.id) !== undefined;
}

export async function resolveGameAccess(
  deps: ServiceDeps,
  actor: Actor,
  game: GameRow,
  chat: ChatRow,
): Promise<GameAccess> {
  const chatAccess = await resolveChatAccess(deps, chat, actor);
  return {
    ...chatAccess,
    isCreator: game.createdBy === actor.tgUserId,
    isGamePlayer: isUserInGame(deps.db, game, actor.tgUserId),
  };
}
