import type { MiddlewareHandler } from 'hono';

import { errorResponse } from './errors';
import type { AppEnv } from './env';

/** 60 API requests per minute per user (SEC-06), fixed windows. In memory: one process. */
export class ApiRateLimiter {
  private readonly windows = new Map<number, { start: number; count: number }>();

  constructor(
    private readonly now: () => number,
    private readonly limit = 60,
    private readonly windowMs = 60_000,
  ) {}

  /** Counts a request; returns ms until the window resets when over the limit, else 0. */
  hit(tgUserId: number): number {
    const now = this.now();
    let window = this.windows.get(tgUserId);
    if (!window || now - window.start >= this.windowMs) {
      window = { start: now, count: 0 };
      this.windows.set(tgUserId, window);
      if (this.windows.size > 10_000) {
        this.prune(now);
      }
    }
    window.count += 1;
    return window.count > this.limit ? window.start + this.windowMs - now : 0;
  }

  private prune(now: number): void {
    for (const [user, window] of this.windows) {
      if (now - window.start >= this.windowMs) {
        this.windows.delete(user);
      }
    }
  }
}

/** Runs after auth: `429 RATE_LIMITED` with `Retry-After` (seconds). */
export function rateLimit(limiter: ApiRateLimiter): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const waitMs = limiter.hit(c.var.actor.tgUserId);
    if (waitMs > 0) {
      c.header('Retry-After', String(Math.ceil(waitMs / 1000)));
      return errorResponse(c, 'RATE_LIMITED');
    }
    await next();
    return undefined;
  };
}
