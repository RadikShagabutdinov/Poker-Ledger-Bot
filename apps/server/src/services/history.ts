import { computePlayerTotals, computeSummary } from '@pokerledger/core';

import { listEventsOfGames } from '../db/repositories/gameEvents';
import { listGamePlayersOfGames } from '../db/repositories/gamePlayers';
import { listGamesPage } from '../db/repositories/games';
import type { GameStatus, GameType } from '../db/schema';
import { loadChatForMember } from './chats';
import type { Actor } from './context';
import type { ServiceDeps } from './deps';
import { ServiceError } from './errors';
import { loadGameData, toCoreView } from './gameData';
import { buildSettlementView, type SettlementView } from './settlement';
import {
  buildGameLog,
  buildGameState,
  loadViewableGame,
  type GameState,
  type LogEntry,
} from './state';

export const HISTORY_PAGE_SIZE = 20;

export interface HistoryItem {
  readonly id: string;
  readonly name: string;
  readonly type: GameType;
  readonly status: GameStatus;
  readonly startedAt: number;
  readonly finishedAt: number | null;
  readonly playerCount: number;
  /** Total chips issued; money is `issuedChips × stack.amount / stack.chips`. */
  readonly issuedChips: number;
  readonly currency: string;
  readonly stack: { readonly chips: number; readonly amount: number };
  /** Chip mismatch `D` of a finished game, `null` otherwise. */
  readonly mismatchChips: number | null;
}

export interface HistoryPage {
  readonly items: readonly HistoryItem[];
  readonly nextCursor: string | null;
}

export interface HistoryQuery {
  readonly status?: 'active' | 'finished' | undefined;
  /** V1 has cash games only; the filter is there for V2 (V1-HIST-02). */
  readonly type?: GameType | undefined;
  /** Inclusive lower bound of `started_at`, ms (V1-HIST-02). */
  readonly from?: number | undefined;
  /** Exclusive upper bound of `started_at`, ms. */
  readonly to?: number | undefined;
  readonly cursor?: string | undefined;
  readonly limit?: number | undefined;
}

function encodeCursor(startedAt: number, id: string): string {
  return Buffer.from(`${String(startedAt)}:${id}`).toString('base64url');
}

function decodeCursor(cursor: string): { startedAt: number; id: string } {
  const [time, id] = Buffer.from(cursor, 'base64url').toString().split(':');
  const startedAt = Number(time);
  if (!id || !Number.isSafeInteger(startedAt)) {
    throw new ServiceError('VALIDATION', { reason: 'INVALID_CURSOR' });
  }
  return { startedAt, id };
}

/**
 * `GET /chats/:chatId/games` (V1-HIST-01/02/04): games of the chat, newest first,
 * 20 per page, deleted games excluded.
 */
export async function listGames(
  deps: ServiceDeps,
  actor: Actor,
  chatId: string,
  query: HistoryQuery = {},
): Promise<HistoryPage> {
  const { chat } = await loadChatForMember(deps, actor, chatId);
  const limit = Math.min(Math.max(query.limit ?? HISTORY_PAGE_SIZE, 1), 100);
  const rows = listGamesPage(deps.db, {
    chatId: chat.id,
    status: query.status,
    type: query.type,
    from: query.from,
    to: query.to,
    after: query.cursor === undefined ? undefined : decodeCursor(query.cursor),
    limit: limit + 1,
  });
  const page = rows.slice(0, limit);
  const ids = page.map((g) => g.id);
  const players = listGamePlayersOfGames(deps.db, ids);
  const events = listEventsOfGames(deps.db, ids);

  const items = page.map((game): HistoryItem => {
    const view = toCoreView({
      game,
      players: players.filter((p) => p.gameId === game.id),
      events: events.filter((e) => e.gameId === game.id),
    });
    const summary = computeSummary(computePlayerTotals(view.players, view.events));
    return {
      id: game.id,
      name: game.name,
      type: game.type,
      status: game.status,
      startedAt: game.startedAt,
      finishedAt: game.finishedAt,
      playerCount: view.players.length,
      issuedChips: summary.issuedChips,
      currency: game.currency,
      stack: { chips: game.stackChips, amount: game.stackAmount },
      mismatchChips: game.status === 'finished' ? game.mismatchChips : null,
    };
  });
  const last = page.at(-1);
  return {
    items,
    nextCursor: rows.length > limit && last ? encodeCursor(last.startedAt, last.id) : null,
  };
}

export interface GameDetails {
  readonly state: GameState;
  /** Without payment details; those come only from `getSettlement` (SEC-04). */
  readonly settlement: SettlementView | null;
  readonly log: readonly LogEntry[];
}

/** Game details for history (V1-HIST-03). */
export async function getGameDetails(
  deps: ServiceDeps,
  actor: Actor,
  gameId: string,
): Promise<GameDetails> {
  const { game, access } = await loadViewableGame(deps, actor, gameId);
  const data = loadGameData(deps.db, game);
  return {
    state: buildGameState(deps.db, data, access, actor.tgUserId),
    settlement: game.status === 'finished' ? buildSettlementView(deps.db, game, false) : null,
    log: buildGameLog(deps.db, data),
  };
}
