import { gameNameSchema, localeOf, stackSchema, type Language } from '@pokerledger/shared';

import type { DbOrTx } from '../db/client';
import { findChatPlayer } from '../db/repositories/chatPlayers';
import { findChat, updateChat } from '../db/repositories/chats';
import { insertGameEvent } from '../db/repositories/gameEvents';
import { findGamePlayer, insertGamePlayer, nextSeatOrder } from '../db/repositories/gamePlayers';
import {
  insertGame,
  listGamesByStatus,
  updateGame as updateGameRow,
} from '../db/repositories/games';
import { newGameId } from '../db/ids';
import type { ChatRow, GameRow } from '../db/schema';
import { touchUser, type Actor } from './context';
import type { ServiceDeps } from './deps';
import { ServiceError, parseInput } from './errors';
import { activeGameMember, mutateGame, type MutationContext } from './mutate';
import {
  assertAllowed,
  assertChatMember,
  canEditFinished,
  canManageGame,
  resolveChatAccess,
  type GameAccess,
} from './permissions';
import { ensureChatPlayer, insertGuest } from './players';
import { recalculateFinishedGame, type SettlementPolicy } from './results';

/**
 * V1: one active game per chat (V1-GAME-03). The only place of this rule, so V2
 * can lift it (V2-MULTI-01). Throws `ACTIVE_GAME_EXISTS` with the active game id.
 */
export function assertCanHaveAnotherActiveGame(db: DbOrTx, chatId: string): void {
  const active = listGamesByStatus(db, chatId, 'active');
  if (active.length > 0) {
    throw new ServiceError('ACTIVE_GAME_EXISTS', { gameId: (active[0] as GameRow).id });
  }
}

/** Active games of a chat, oldest first; at most one in V1, several in V2. */
export function listActiveGames(deps: ServiceDeps, chatId: string): GameRow[] {
  return listGamesByStatus(deps.db, chatId, 'active');
}

/** Fills `{date}` (day and month in the chat locale) and `{n}` (V1-SET-03). */
export function renderGameName(
  template: string,
  values: { language: Language; timeZone: string; now: number; n: number },
): string {
  const date = new Intl.DateTimeFormat(localeOf(values.language), {
    day: '2-digit',
    month: '2-digit',
    timeZone: values.timeZone,
  }).format(values.now);
  return template.replaceAll('{date}', date).replaceAll('{n}', String(values.n));
}

export interface CreateGameInput {
  /** Defaults to the chat template. */
  readonly name?: string | undefined;
  /** Defaults to the chat setting. */
  readonly stack?: { readonly chips: number; readonly amount: number } | undefined;
  /** V1 supports cash games only. */
  readonly type?: 'cash' | 'tournament' | undefined;
}

/**
 * `/newgame` or `POST /chats/:chatId/games` (V1-GAME-01/02), any chat member. The
 * game copies the chat settings (V1-SET-07).
 */
export async function createGame(
  deps: ServiceDeps,
  actor: Actor,
  chatId: string,
  input: CreateGameInput = {},
): Promise<GameRow> {
  if (input.type !== undefined && input.type !== 'cash') {
    throw new ServiceError('VALIDATION', { reason: 'UNSUPPORTED_GAME_TYPE' });
  }
  const name = input.name === undefined ? undefined : parseInput(gameNameSchema, input.name);
  const stack = input.stack === undefined ? undefined : parseInput(stackSchema, input.stack);
  const snapshot = findChat(deps.db, chatId);
  if (!snapshot) {
    throw new ServiceError('NOT_FOUND');
  }
  assertChatMember(await resolveChatAccess(deps, snapshot, actor));

  const now = deps.now();
  const game = deps.db.transaction((tx) => {
    touchUser(tx, actor, now);
    const chat = findChat(tx, chatId) as ChatRow;
    assertCanHaveAnotherActiveGame(tx, chat.id);
    const n = chat.gameCounter + 1;
    updateChat(tx, chat.id, { gameCounter: n, updatedAt: now });
    const created = insertGame(tx, {
      id: newGameId(),
      chatId: chat.id,
      type: 'cash',
      name:
        name ??
        renderGameName(chat.gameNameTemplate, {
          language: chat.language,
          timeZone: deps.timeZone,
          now,
          n,
        }),
      status: 'active',
      currency: chat.currency,
      stackChips: stack?.chips ?? chat.stackChips,
      stackAmount: stack?.amount ?? chat.stackAmount,
      createdBy: actor.tgUserId,
      version: 1,
      startedAt: now,
    });
    insertGameEvent(tx, {
      gameId: created.id,
      playerId: null,
      type: 'game_created',
      payload: {
        name: created.name,
        stack: { chips: created.stackChips, amount: created.stackAmount },
        currency: created.currency,
      },
      createdBy: actor.tgUserId,
      createdAt: now,
    });
    return created;
  });
  deps.messageUpdater.schedule(game.id);
  return game;
}

export interface UpdateGameInput {
  readonly name?: string | undefined;
  readonly stack?: { readonly chips: number; readonly amount: number } | undefined;
  readonly expectedVersion?: number | undefined;
  /** For a finished game with a manual settlement whose results change (V1-SETL-07). */
  readonly settlementPolicy?: SettlementPolicy | undefined;
}

function canUpdateGame(game: GameRow, access: GameAccess): void {
  assertAllowed(
    access,
    game.status === 'finished' ? canEditFinished(access) : canManageGame(access),
  );
}

/**
 * `PATCH /games/:gameId`: name and stack value (V1-GAME-04). Active game: any chat
 * member; finished game: creator or admin, results are recalculated (V1-EDIT-01).
 */
export async function updateGame(
  deps: ServiceDeps,
  actor: Actor,
  gameId: string,
  input: UpdateGameInput,
): Promise<GameRow> {
  const name = input.name === undefined ? undefined : parseInput(gameNameSchema, input.name);
  const stack = input.stack === undefined ? undefined : parseInput(stackSchema, input.stack);
  return mutateGame(
    deps,
    actor,
    gameId,
    { expectedVersion: input.expectedVersion, authorize: canUpdateGame },
    ({ tx, game, now }) => {
      const changes: Record<string, { from: unknown; to: unknown }> = {};
      if (name !== undefined && name !== game.name) {
        changes.name = { from: game.name, to: name };
      }
      const stackChanged =
        stack !== undefined &&
        (stack.chips !== game.stackChips || stack.amount !== game.stackAmount);
      if (stack !== undefined && stackChanged) {
        changes.stack = {
          from: { chips: game.stackChips, amount: game.stackAmount },
          to: stack,
        };
      }
      if (Object.keys(changes).length === 0) {
        return game;
      }
      const updated = updateGameRow(tx, game.id, {
        ...(name !== undefined ? { name } : {}),
        ...(stack !== undefined ? { stackChips: stack.chips, stackAmount: stack.amount } : {}),
      });
      insertGameEvent(tx, {
        gameId: game.id,
        playerId: null,
        type: 'settings_changed',
        payload: changes,
        createdBy: actor.tgUserId,
        createdAt: now,
      });
      if (game.status === 'finished' && stackChanged) {
        recalculateFinishedGame(tx, updated, input.settlementPolicy);
      }
      return updated;
    },
  );
}

/** Seats a chat player in the game if needed (`player_added`). Returns whether it was added. */
export function seatPlayer(ctx: MutationContext, playerId: string): boolean {
  const { tx, game, actor, now } = ctx;
  if (findGamePlayer(tx, game.id, playerId)) {
    return false;
  }
  insertGamePlayer(tx, {
    gameId: game.id,
    playerId,
    seatOrder: nextSeatOrder(tx, game.id),
    addedBy: actor.tgUserId,
    addedAt: now,
  });
  insertGameEvent(tx, {
    gameId: game.id,
    playerId,
    type: 'player_added',
    createdBy: actor.tgUserId,
    createdAt: now,
  });
  return true;
}

export type AddGamePlayerInput =
  { readonly playerId: string } | { readonly guestName: string } | { readonly self: true };

/**
 * `POST /games/:gameId/players`: a known chat player, a new guest, or the actor
 * themselves (V1-PL-01). Adding an already seated player is a no-op.
 */
export async function addPlayerToGame(
  deps: ServiceDeps,
  actor: Actor,
  gameId: string,
  input: AddGamePlayerInput,
): Promise<{ playerId: string; added: boolean }> {
  return mutateGame(deps, actor, gameId, { authorize: activeGameMember }, (ctx) => {
    const { tx, chat, now } = ctx;
    let playerId: string;
    if ('self' in input) {
      playerId = ensureChatPlayer(tx, chat.id, actor.tgUserId, now).id;
    } else if ('guestName' in input) {
      playerId = insertGuest(tx, chat.id, input.guestName, now).id;
    } else {
      const player = findChatPlayer(tx, input.playerId);
      if (!player || player.chatId !== chat.id || player.mergedInto !== null) {
        throw new ServiceError('NOT_FOUND', { playerId: input.playerId });
      }
      playerId = player.id;
    }
    return { playerId, added: seatPlayer(ctx, playerId) };
  });
}
