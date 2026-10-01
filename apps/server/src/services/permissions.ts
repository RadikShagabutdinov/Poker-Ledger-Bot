// The permission matrix of SPEC §3 in one module.
import type { ChatRow, GameRow } from '../db/schema';
import type { Actor } from './context';
import type { ServiceDeps } from './deps';
import { ServiceError } from './errors';

export interface ChatAccess {
  /** `creator`, `administrator`, `member`, or `restricted` with `is_member`. */
  readonly isMember: boolean;
  /** `creator` or `administrator`. */
  readonly isAdmin: boolean;
}

export async function resolveChatAccess(
  deps: ServiceDeps,
  chat: ChatRow,
  actor: Actor,
): Promise<ChatAccess> {
  const membership = await deps.membership.getMembership(chat.tgChatId, actor.tgUserId);
  return { isMember: membership !== 'none', isAdmin: membership === 'admin' };
}

/** Everything about the actor that permission checks on a game need. */
export interface GameAccess extends ChatAccess {
  readonly isCreator: boolean;
  /** The actor is linked to one of the game's players. */
  readonly isGamePlayer: boolean;
}

export function assertChatMember(access: ChatAccess): void {
  if (!access.isMember) {
    throw new ServiceError('NOT_CHAT_MEMBER');
  }
}

/** Create games, add players, record and cancel events, finish: any chat member. */
export function canManageGame(access: GameAccess): boolean {
  return access.isMember;
}

/** Edit, reopen or delete a finished game: the creator or a chat admin (V1-EDIT-01..03). */
export function canEditFinished(access: GameAccess): boolean {
  return access.isMember && (access.isCreator || access.isAdmin);
}

/** Edit the settlement: players of the game, the creator, chat admins (SPEC §3). */
export function canEditSettlement(access: GameAccess): boolean {
  return access.isMember && (access.isGamePlayer || access.isCreator || access.isAdmin);
}

/**
 * View a game: chat members; a player of a finished game may view it after
 * leaving the chat (SEC-02).
 */
export function canViewGame(access: GameAccess, game: GameRow): boolean {
  return access.isMember || (access.isGamePlayer && game.status === 'finished');
}

/** Payment details of recipients are shown only to players of the game (SEC-04). */
export function canSeePaymentDetails(access: GameAccess): boolean {
  return access.isGamePlayer;
}

/** Throws `NOT_CHAT_MEMBER` for outsiders and `FORBIDDEN` for members without the right. */
export function assertAllowed(access: GameAccess, allowed: boolean): void {
  if (allowed) {
    return;
  }
  throw new ServiceError(access.isMember ? 'FORBIDDEN' : 'NOT_CHAT_MEMBER');
}
