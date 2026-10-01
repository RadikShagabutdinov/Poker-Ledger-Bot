import { displayNameSchema, guestNameSchema } from '@pokerledger/shared';

import type { DbOrTx } from '../db/client';
import {
  findChatPlayer,
  findChatPlayerByUser,
  insertChatPlayer,
  listChatPlayers,
  updateChatPlayer,
  type ChatPlayerWithUser,
} from '../db/repositories/chatPlayers';
import { newId } from '../db/ids';
import type { ChatPlayerRow, UserRow } from '../db/schema';
import type { Actor } from './context';
import type { ServiceDeps } from './deps';
import { ServiceError, parseInput } from './errors';
import { loadChatForMember } from './chats';

export interface PlayerView {
  readonly playerId: string;
  readonly name: string;
  readonly isGuest: boolean;
}

/** Display name: the chat override, else the Telegram name (V1-PL-03). */
export function playerName(player: ChatPlayerRow, user: UserRow | null): string {
  if (player.displayName) {
    return player.displayName;
  }
  if (user) {
    return [user.firstName, user.lastName].filter(Boolean).join(' ');
  }
  return '';
}

export function toPlayerView({ player, user }: ChatPlayerWithUser): PlayerView {
  return { playerId: player.id, name: playerName(player, user), isGuest: player.tgUserId === null };
}

/**
 * Chat player of a Telegram user, created on first interaction in the chat (V1-PL-01).
 * The user row must exist (see `touchUser`).
 */
export function ensureChatPlayer(
  db: DbOrTx,
  chatId: string,
  tgUserId: number,
  now: number,
): ChatPlayerRow {
  return (
    findChatPlayerByUser(db, chatId, tgUserId) ??
    insertChatPlayer(db, { id: newId(), chatId, tgUserId, displayName: null, createdAt: now })
  );
}

/**
 * Guest names are unique per chat ignoring case (V1-PL-02). Compared in JS because
 * SQLite `lower()` folds ASCII only; the DB index is a backstop for ASCII names.
 */
function findGuestByName(db: DbOrTx, chatId: string, name: string): ChatPlayerRow | undefined {
  const key = name.toLocaleLowerCase();
  return listChatPlayers(db, chatId).find(
    ({ player }) => player.tgUserId === null && player.displayName?.toLocaleLowerCase() === key,
  )?.player;
}

/** Creates a guest or throws `GUEST_NAME_TAKEN` with the existing guest's id. */
export function insertGuest(
  db: DbOrTx,
  chatId: string,
  rawName: string,
  now: number,
): ChatPlayerRow {
  const name = parseInput(guestNameSchema, rawName);
  const existing = findGuestByName(db, chatId, name);
  if (existing) {
    throw new ServiceError('GUEST_NAME_TAKEN', { playerId: existing.id });
  }
  return insertChatPlayer(db, {
    id: newId(),
    chatId,
    tgUserId: null,
    displayName: name,
    createdAt: now,
  });
}

/** `GET /chats/:chatId/players`: known players of the chat (V1-PL-04). */
export async function listPlayers(
  deps: ServiceDeps,
  actor: Actor,
  chatId: string,
): Promise<PlayerView[]> {
  const { chat } = await loadChatForMember(deps, actor, chatId);
  return listChatPlayers(deps.db, chat.id).map(toPlayerView);
}

/** `POST /chats/:chatId/players` with `{ name }`. */
export async function addGuest(
  deps: ServiceDeps,
  actor: Actor,
  chatId: string,
  name: string,
): Promise<PlayerView> {
  const { chat } = await loadChatForMember(deps, actor, chatId);
  const player = deps.db.transaction((tx) => insertGuest(tx, chat.id, name, deps.now()));
  return toPlayerView({ player, user: null });
}

/**
 * `PATCH /chats/:chatId/players/:playerId` (V1-PL-03). For a Telegram player `null`
 * resets the override to the Telegram name.
 */
export async function renamePlayer(
  deps: ServiceDeps,
  actor: Actor,
  chatId: string,
  playerId: string,
  rawName: string | null,
): Promise<PlayerView> {
  const { chat } = await loadChatForMember(deps, actor, chatId);
  return deps.db.transaction((tx) => {
    const player = findChatPlayer(tx, playerId);
    if (!player || player.chatId !== chat.id || player.mergedInto !== null) {
      throw new ServiceError('NOT_FOUND');
    }
    const isGuest = player.tgUserId === null;
    if (rawName === null && isGuest) {
      throw new ServiceError('VALIDATION', { reason: 'GUEST_NAME_REQUIRED' });
    }
    const name = rawName === null ? null : parseInput(displayNameSchema, rawName);
    if (isGuest && name !== null) {
      const existing = findGuestByName(tx, chat.id, name);
      if (existing && existing.id !== player.id) {
        throw new ServiceError('GUEST_NAME_TAKEN', { playerId: existing.id });
      }
    }
    updateChatPlayer(tx, player.id, { displayName: name });
    const updated = listChatPlayers(tx, chat.id).find((p) => p.player.id === player.id);
    return toPlayerView(updated as ChatPlayerWithUser);
  });
}
