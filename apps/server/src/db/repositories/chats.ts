import { eq, inArray } from 'drizzle-orm';

import type { DbOrTx } from '../client';
import { chatPlayers, chats, games, type ChatRow } from '../schema';

export function findChat(db: DbOrTx, id: string): ChatRow | undefined {
  return db.select().from(chats).where(eq(chats.id, id)).get();
}

export function findChats(db: DbOrTx, ids: readonly string[]): ChatRow[] {
  if (ids.length === 0) {
    return [];
  }
  return db
    .select()
    .from(chats)
    .where(inArray(chats.id, [...ids]))
    .all();
}

export function findChatByTgId(db: DbOrTx, tgChatId: number): ChatRow | undefined {
  return db.select().from(chats).where(eq(chats.tgChatId, tgChatId)).get();
}

export function insertChat(db: DbOrTx, row: typeof chats.$inferInsert): ChatRow {
  return db.insert(chats).values(row).returning().get();
}

export function updateChat(
  db: DbOrTx,
  id: string,
  patch: Partial<Omit<ChatRow, 'id' | 'createdAt'>>,
): ChatRow {
  return db.update(chats).set(patch).where(eq(chats.id, id)).returning().get();
}

/** Whether a chat has any players or games. */
export function chatHasData(db: DbOrTx, id: string): boolean {
  const player = db
    .select({ id: chatPlayers.id })
    .from(chatPlayers)
    .where(eq(chatPlayers.chatId, id))
    .limit(1)
    .get();
  const game = db.select({ id: games.id }).from(games).where(eq(games.chatId, id)).limit(1).get();
  return player !== undefined || game !== undefined;
}

export function deleteChat(db: DbOrTx, id: string): void {
  db.delete(chats).where(eq(chats.id, id)).run();
}
