import type { Db } from '../db/client';

/** Membership of a user in a Telegram chat, from `getChatMember` (SPEC §3). */
export type Membership = 'admin' | 'member' | 'none';

/**
 * Checks chat membership through the Bot API. The real implementation with a
 * 10-minute cache comes with the API (stage 4); tests use a fake.
 */
export interface MembershipChecker {
  getMembership(tgChatId: number, tgUserId: number): Promise<Membership>;
}

/** Schedules a debounced update of the game's chat message (V1-MSG-07). */
export interface MessageUpdater {
  schedule(gameId: string): void;
}

export interface ServiceDeps {
  readonly db: Db;
  readonly membership: MembershipChecker;
  readonly messageUpdater: MessageUpdater;
  /** Current time, UTC milliseconds. */
  readonly now: () => number;
  /** IANA time zone used for `{date}` in game names (V1-SET-03). */
  readonly timeZone: string;
}

export const DEFAULT_TIME_ZONE = 'Europe/Moscow';
