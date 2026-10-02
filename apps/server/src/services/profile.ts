import { profilePatchSchema, type Language, type ProfilePatch } from '@pokerledger/shared';

import { listPlayersOfUser } from '../db/repositories/chatPlayers';
import { findChats } from '../db/repositories/chats';
import { listActiveGamesOfChats } from '../db/repositories/games';
import { findUser, updateUser } from '../db/repositories/users';
import type { UserRow } from '../db/schema';
import { languageFromCode, touchUser, type Actor } from './context';
import type { ServiceDeps } from './deps';
import { parseInput } from './errors';

export interface ProfileView {
  readonly tgUserId: number;
  readonly firstName: string;
  readonly lastName: string | null;
  readonly username: string | null;
  /** Chosen language, `null` when it follows Telegram. */
  readonly language: Language | null;
  /** The language to use: the chosen one, else from Telegram `language_code`. */
  readonly effectiveLanguage: Language;
  readonly payPhone: string | null;
  readonly payBank: string | null;
  readonly payNote: string | null;
}

function toProfileView(user: UserRow, actor: Actor): ProfileView {
  return {
    tgUserId: user.tgUserId,
    firstName: user.firstName,
    lastName: user.lastName,
    username: user.username,
    language: user.language,
    effectiveLanguage: user.language ?? languageFromCode(actor.languageCode, 'en'),
    payPhone: user.payPhone,
    payBank: user.payBank,
    payNote: user.payNote,
  };
}

/** `GET /me`: only the user themselves. */
export function getProfile(deps: ServiceDeps, actor: Actor): ProfileView {
  touchUser(deps.db, actor, deps.now());
  return toProfileView(findUser(deps.db, actor.tgUserId) as UserRow, actor);
}

/** `PATCH /me`: language and payment details; `null` clears a field. */
export function updateProfile(deps: ServiceDeps, actor: Actor, patch: ProfilePatch): ProfileView {
  const input = parseInput(profilePatchSchema, patch);
  const now = deps.now();
  return deps.db.transaction((tx) => {
    touchUser(tx, actor, now);
    updateUser(tx, actor.tgUserId, { ...input, updatedAt: now });
    return toProfileView(findUser(tx, actor.tgUserId) as UserRow, actor);
  });
}

export interface MyChatView {
  readonly chatId: string;
  readonly title: string;
  readonly activeGameIds: readonly string[];
}

/** `GET /me/chats`: chats where the user is a player, with active games. */
export function listMyChats(deps: ServiceDeps, actor: Actor): MyChatView[] {
  const chatIds = listPlayersOfUser(deps.db, actor.tgUserId).map((p) => p.chatId);
  const active = listActiveGamesOfChats(deps.db, chatIds);
  return findChats(deps.db, chatIds)
    .filter((chat) => chat.botStatus !== 'left')
    .map((chat) => ({
      chatId: chat.id,
      title: chat.title,
      activeGameIds: active.filter((g) => g.chatId === chat.id).map((g) => g.id),
    }))
    .sort((a, b) => a.title.localeCompare(b.title));
}
