import { eq, inArray } from 'drizzle-orm';

import type { DbOrTx } from '../client';
import { users, type UserRow } from '../schema';

export function findUser(db: DbOrTx, tgUserId: number): UserRow | undefined {
  return db.select().from(users).where(eq(users.tgUserId, tgUserId)).get();
}

export function findUsers(db: DbOrTx, tgUserIds: readonly number[]): UserRow[] {
  if (tgUserIds.length === 0) {
    return [];
  }
  return db
    .select()
    .from(users)
    .where(inArray(users.tgUserId, [...tgUserIds]))
    .all();
}

export interface UserNameFields {
  readonly tgUserId: number;
  readonly firstName: string;
  readonly lastName: string | null;
  readonly username: string | null;
}

/** Inserts the user or refreshes the name fields. */
export function upsertUserName(db: DbOrTx, fields: UserNameFields, now: number): void {
  db.insert(users)
    .values({ ...fields, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: users.tgUserId,
      set: {
        firstName: fields.firstName,
        lastName: fields.lastName,
        username: fields.username,
        updatedAt: now,
      },
    })
    .run();
}

export function updateUser(
  db: DbOrTx,
  tgUserId: number,
  // `undefined` fields are left unchanged.
  patch: {
    [K in 'language' | 'payPhone' | 'payBank' | 'payNote' | 'updatedAt']?: UserRow[K] | undefined;
  },
): void {
  db.update(users).set(patch).where(eq(users.tgUserId, tgUserId)).run();
}
