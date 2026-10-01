import { and, eq, inArray, isNull } from 'drizzle-orm';

import type { DbOrTx } from '../client';
import { chatPlayers, users, type ChatPlayerRow, type UserRow } from '../schema';

/** A chat player with the linked Telegram user, if any. */
export interface ChatPlayerWithUser {
  readonly player: ChatPlayerRow;
  readonly user: UserRow | null;
}

export function findChatPlayer(db: DbOrTx, id: string): ChatPlayerRow | undefined {
  return db.select().from(chatPlayers).where(eq(chatPlayers.id, id)).get();
}

export function findChatPlayerByUser(
  db: DbOrTx,
  chatId: string,
  tgUserId: number,
): ChatPlayerRow | undefined {
  return db
    .select()
    .from(chatPlayers)
    .where(and(eq(chatPlayers.chatId, chatId), eq(chatPlayers.tgUserId, tgUserId)))
    .get();
}

/** Active (not merged) players of a chat with their users, in creation order. */
export function listChatPlayers(db: DbOrTx, chatId: string): ChatPlayerWithUser[] {
  return db
    .select({ player: chatPlayers, user: users })
    .from(chatPlayers)
    .leftJoin(users, eq(users.tgUserId, chatPlayers.tgUserId))
    .where(and(eq(chatPlayers.chatId, chatId), isNull(chatPlayers.mergedInto)))
    .orderBy(chatPlayers.createdAt, chatPlayers.id)
    .all();
}

export function findChatPlayersWithUsers(db: DbOrTx, ids: readonly string[]): ChatPlayerWithUser[] {
  if (ids.length === 0) {
    return [];
  }
  return db
    .select({ player: chatPlayers, user: users })
    .from(chatPlayers)
    .leftJoin(users, eq(users.tgUserId, chatPlayers.tgUserId))
    .where(inArray(chatPlayers.id, [...ids]))
    .all();
}

/** Chat players linked to a Telegram user, across all chats. */
export function listPlayersOfUser(db: DbOrTx, tgUserId: number): ChatPlayerRow[] {
  return db
    .select()
    .from(chatPlayers)
    .where(and(eq(chatPlayers.tgUserId, tgUserId), isNull(chatPlayers.mergedInto)))
    .all();
}

export function insertChatPlayer(db: DbOrTx, row: typeof chatPlayers.$inferInsert): ChatPlayerRow {
  return db.insert(chatPlayers).values(row).returning().get();
}

export function updateChatPlayer(
  db: DbOrTx,
  id: string,
  patch: Partial<Pick<ChatPlayerRow, 'displayName'>>,
): ChatPlayerRow {
  return db.update(chatPlayers).set(patch).where(eq(chatPlayers.id, id)).returning().get();
}
