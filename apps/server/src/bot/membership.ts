import { GrammyError, type Api } from 'grammy';
import type { ChatMember } from 'grammy/types';

import type { Membership, MembershipChecker } from '../services';

/** `getChatMember` results are cached this long. */
export const MEMBERSHIP_TTL_MS = 10 * 60 * 1000;

/** Chat members are `creator`, `administrator`, `member`, or `restricted` with `is_member`. */
export function toMembership(member: ChatMember): Membership {
  switch (member.status) {
    case 'creator':
    case 'administrator':
      return 'admin';
    case 'member':
      return 'member';
    case 'restricted':
      return member.is_member ? 'member' : 'none';
    case 'left':
    case 'kicked':
      return 'none';
  }
}

/** Chat membership through the Bot API with an in-memory cache. */
export class TelegramMembershipChecker implements MembershipChecker {
  private readonly cache = new Map<string, { membership: Membership; expiresAt: number }>();

  constructor(
    private readonly api: Pick<Api, 'getChatMember'>,
    private readonly now: () => number,
    private readonly ttlMs = MEMBERSHIP_TTL_MS,
  ) {}

  async getMembership(tgChatId: number, tgUserId: number): Promise<Membership> {
    const key = `${String(tgChatId)}:${String(tgUserId)}`;
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > this.now()) {
      return cached.membership;
    }
    let membership: Membership;
    try {
      membership = toMembership(await this.api.getChatMember(tgChatId, tgUserId));
    } catch (error) {
      // Unknown user or chat, or the bot is not in the chat: not a member. Network
      // and server errors are not cached and propagate.
      if (error instanceof GrammyError && (error.error_code === 400 || error.error_code === 403)) {
        membership = 'none';
      } else {
        throw error;
      }
    }
    this.cache.set(key, { membership, expiresAt: this.now() + this.ttlMs });
    if (this.cache.size > 50_000) {
      this.prune();
    }
    return membership;
  }

  private prune(): void {
    const now = this.now();
    for (const [key, entry] of this.cache) {
      if (entry.expiresAt <= now) {
        this.cache.delete(key);
      }
    }
  }
}
