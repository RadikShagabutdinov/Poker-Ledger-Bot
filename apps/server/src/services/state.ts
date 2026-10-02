import {
  chipsToMoneyRounded,
  computePlayerTotals,
  computeSummary,
  type PlayerStatus,
} from '@pokerledger/core';

import type { DbOrTx } from '../db/client';
import { findChatPlayerByUser, findChatPlayersWithUsers } from '../db/repositories/chatPlayers';
import { listGameResults } from '../db/repositories/gameResults';
import { findUsers } from '../db/repositories/users';
import type {
  EventPayload,
  GameRow,
  GameStatus,
  GameType,
  MismatchModeName,
  StoredEventType,
} from '../db/schema';
import { touchUser, type Actor } from './context';
import type { ServiceDeps } from './deps';
import {
  findVisibleGame,
  loadGameData,
  resolveGameAccess,
  toCoreView,
  type GameData,
} from './gameData';
import {
  assertAllowed,
  canEditFinished,
  canEditSettlement,
  canManageGame,
  canViewGame,
  type GameAccess,
} from './permissions';
import { ensureChatPlayer, playerName } from './players';

export interface GamePlayerState {
  readonly playerId: string;
  readonly name: string;
  readonly isGuest: boolean;
  readonly seatOrder: number;
  readonly status: PlayerStatus;
  readonly inChips: number;
  readonly outChips: number;
  readonly buyinCount: number;
  readonly rebuyCount: number;
  /**
   * Finished game: the stored result. Active game: a provisional result
   * for players who left, rounded to the nearest unit; otherwise `null`.
   */
  readonly moneyResult: number | null;
}

/** `GET /games/:gameId`. */
export interface GameState {
  readonly id: string;
  readonly chatId: string;
  readonly type: GameType;
  readonly name: string;
  readonly status: GameStatus;
  readonly currency: string;
  readonly stack: { readonly chips: number; readonly amount: number };
  readonly version: number;
  readonly createdBy: number;
  readonly startedAt: number;
  readonly finishedAt: number | null;
  readonly mismatch: {
    readonly mode: MismatchModeName;
    readonly playerId: string | null;
    readonly chips: number;
  } | null;
  readonly settlementIsManual: boolean;
  readonly summary: {
    readonly issuedChips: number;
    readonly cashedOutChips: number;
    readonly expectedOnTableChips: number;
    readonly seatedCount: number;
  };
  readonly players: readonly GamePlayerState[];
  /** The viewer's player in this game, if any. */
  readonly myPlayerId: string | null;
  readonly permissions: {
    readonly canManage: boolean;
    readonly canEditFinished: boolean;
    readonly canEditSettlement: boolean;
  };
}

function provisionalMoney(chips: number, game: GameRow): number {
  return chipsToMoneyRounded(chips, { chips: game.stackChips, amount: game.stackAmount });
}

/** Players' names by player id. */
export function playerNames(
  db: DbOrTx,
  playerIds: readonly string[],
): Map<string, { name: string; isGuest: boolean }> {
  return new Map(
    findChatPlayersWithUsers(db, playerIds).map(({ player, user }) => [
      player.id,
      { name: playerName(player, user), isGuest: player.tgUserId === null },
    ]),
  );
}

/** The game player linked to `tgUserId`, if any. */
function gamePlayerOf(db: DbOrTx, data: GameData, tgUserId: number | null): string | null {
  if (tgUserId === null) {
    return null;
  }
  const player = findChatPlayerByUser(db, data.game.chatId, tgUserId);
  return player && data.players.some((p) => p.playerId === player.id) ? player.id : null;
}

/** Game state as `viewer` (a Telegram user id, `null` for system use) sees it. */
export function buildGameState(
  db: DbOrTx,
  data: GameData,
  access: GameAccess,
  viewer: number | null,
): GameState {
  const { game } = data;
  const view = toCoreView(data);
  const totals = computePlayerTotals(view.players, view.events);
  const summary = computeSummary(totals);
  const names = playerNames(
    db,
    data.players.map((p) => p.playerId),
  );
  const results =
    game.status === 'finished'
      ? new Map(listGameResults(db, game.id).map((r) => [r.playerId, r.moneyResult]))
      : undefined;

  return {
    id: game.id,
    chatId: game.chatId,
    type: game.type,
    name: game.name,
    status: game.status,
    currency: game.currency,
    stack: { chips: game.stackChips, amount: game.stackAmount },
    version: game.version,
    createdBy: game.createdBy,
    startedAt: game.startedAt,
    finishedAt: game.finishedAt,
    mismatch:
      game.mismatchMode === null
        ? null
        : {
            mode: game.mismatchMode,
            playerId: game.mismatchPlayerId,
            chips: game.mismatchChips ?? 0,
          },
    settlementIsManual: game.settlementIsManual,
    summary: {
      issuedChips: summary.issuedChips,
      cashedOutChips: summary.cashedOutChips,
      expectedOnTableChips: summary.expectedOnTable,
      seatedCount: summary.seatedCount,
    },
    players: totals.map((t) => {
      const info = names.get(t.playerId);
      let moneyResult: number | null = null;
      if (results) {
        moneyResult = results.get(t.playerId) ?? null;
      } else if (t.status === 'left') {
        moneyResult = provisionalMoney(t.out - t.in, game);
      }
      return {
        playerId: t.playerId,
        name: info?.name ?? '',
        isGuest: info?.isGuest ?? false,
        seatOrder: t.seatOrder,
        status: t.status,
        inChips: t.in,
        outChips: t.out,
        buyinCount: t.buyinCount,
        rebuyCount: t.rebuyCount,
        moneyResult,
      };
    }),
    myPlayerId: gamePlayerOf(db, data, viewer),
    permissions: {
      canManage: canManageGame(access) && game.status === 'active',
      canEditFinished: canEditFinished(access),
      canEditSettlement: canEditSettlement(access),
    },
  };
}

/**
 * Loads a game the actor may view, or throws. A chat member opening a game
 * becomes a player of the chat.
 */
export async function loadViewableGame(
  deps: ServiceDeps,
  actor: Actor,
  gameId: string,
): Promise<{ game: GameRow; access: GameAccess }> {
  const { game, chat } = findVisibleGame(deps.db, gameId);
  const access = await resolveGameAccess(deps, actor, game, chat);
  assertAllowed(access, canViewGame(access, game));
  const now = deps.now();
  deps.db.transaction((tx) => {
    touchUser(tx, actor, now);
    if (access.isMember) {
      ensureChatPlayer(tx, game.chatId, actor.tgUserId, now);
    }
  });
  return { game, access };
}

export async function getGameState(
  deps: ServiceDeps,
  actor: Actor,
  gameId: string,
): Promise<GameState> {
  const { game, access } = await loadViewableGame(deps, actor, gameId);
  return buildGameState(deps.db, loadGameData(deps.db, game), access, actor.tgUserId);
}

export interface LogEntry {
  readonly id: number;
  readonly type: StoredEventType;
  readonly playerId: string | null;
  readonly playerName: string | null;
  readonly chips: number | null;
  readonly payload: EventPayload | null;
  readonly createdBy: { readonly tgUserId: number; readonly name: string };
  readonly createdAt: number;
  readonly cancelled: { readonly by: number; readonly at: number } | null;
}

export function buildGameLog(db: DbOrTx, data: GameData): LogEntry[] {
  const names = playerNames(
    db,
    data.players.map((p) => p.playerId),
  );
  const authors = new Map(
    findUsers(db, [...new Set(data.events.map((e) => e.createdBy))]).map((u) => [
      u.tgUserId,
      [u.firstName, u.lastName].filter(Boolean).join(' '),
    ]),
  );
  return data.events.map((e) => ({
    id: e.id,
    type: e.type,
    playerId: e.playerId,
    playerName: e.playerId === null ? null : (names.get(e.playerId)?.name ?? null),
    chips: e.chips,
    payload: e.payload,
    createdBy: { tgUserId: e.createdBy, name: authors.get(e.createdBy) ?? '' },
    createdAt: e.createdAt,
    cancelled:
      e.cancelledAt === null || e.cancelledBy === null
        ? null
        : { by: e.cancelledBy, at: e.cancelledAt },
  }));
}

/** `GET /games/:gameId/log`: all events, cancelled ones included. */
export async function getGameLog(
  deps: ServiceDeps,
  actor: Actor,
  gameId: string,
): Promise<LogEntry[]> {
  const { game } = await loadViewableGame(deps, actor, gameId);
  return buildGameLog(deps.db, loadGameData(deps.db, game));
}
