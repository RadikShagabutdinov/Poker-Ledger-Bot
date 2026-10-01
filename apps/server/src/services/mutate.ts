import type { Tx } from '../db/client';
import { bumpGameVersion, findGame } from '../db/repositories/games';
import type { ChatRow, GameRow } from '../db/schema';
import { touchUser, type Actor } from './context';
import type { ServiceDeps } from './deps';
import { ServiceError } from './errors';
import { findVisibleGame, resolveGameAccess } from './gameData';
import { assertAllowed, canEditFinished, canManageGame, type GameAccess } from './permissions';

export interface MutationContext {
  readonly tx: Tx;
  readonly actor: Actor;
  /** The game as read inside the transaction. */
  readonly game: GameRow;
  readonly chat: ChatRow;
  readonly access: GameAccess;
  readonly now: number;
  /** The game version after this mutation commits. */
  readonly nextVersion: number;
}

export interface MutationOptions {
  /** Optimistic concurrency: `CONFLICT` if the game version differs (SPEC §9.4). */
  readonly expectedVersion?: number | undefined;
  /** Permission and status checks; throw `ServiceError` to reject. */
  readonly authorize: (game: GameRow, access: GameAccess) => void;
}

/**
 * The single path of every game mutation (SPEC §9.4):
 * membership lookup → transaction (permissions → version → writes → `version++`)
 * → `messageUpdater.schedule(gameId)` after the commit.
 */
export async function mutateGame<T>(
  deps: ServiceDeps,
  actor: Actor,
  gameId: string,
  options: MutationOptions,
  write: (ctx: MutationContext) => T,
): Promise<T> {
  const { game: snapshot, chat } = findVisibleGame(deps.db, gameId);
  const access = await resolveGameAccess(deps, actor, snapshot, chat);
  const now = deps.now();
  const result = deps.db.transaction((tx) => {
    const game = findGame(tx, gameId);
    if (!game || game.status === 'deleted') {
      throw new ServiceError('NOT_FOUND');
    }
    options.authorize(game, access);
    if (options.expectedVersion !== undefined && options.expectedVersion !== game.version) {
      throw new ServiceError('CONFLICT', { version: game.version });
    }
    touchUser(tx, actor, now);
    const value = write({ tx, actor, game, chat, access, now, nextVersion: game.version + 1 });
    bumpGameVersion(tx, gameId);
    return value;
  });
  deps.messageUpdater.schedule(gameId);
  return result;
}

function assertStatus(game: GameRow, status: GameRow['status']): void {
  if (game.status !== status) {
    throw new ServiceError('INVALID_GAME_STATUS', { status: game.status });
  }
}

/** Active game, any chat member. */
export function activeGameMember(game: GameRow, access: GameAccess): void {
  assertAllowed(access, canManageGame(access));
  assertStatus(game, 'active');
}

/** Finished game, its creator or a chat admin. */
export function finishedGameEditor(game: GameRow, access: GameAccess): void {
  assertAllowed(access, canEditFinished(access));
  assertStatus(game, 'finished');
}
