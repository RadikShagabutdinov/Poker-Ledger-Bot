/** One button press per second per user. In memory: one server process. */
export class PressRateLimiter {
  private readonly last = new Map<number, number>();

  constructor(
    private readonly now: () => number,
    private readonly intervalMs = 1000,
  ) {}

  /** Registers a press; `false` if the previous accepted one was too recent. */
  tryPress(tgUserId: number): boolean {
    const now = this.now();
    const previous = this.last.get(tgUserId);
    if (previous !== undefined && now - previous < this.intervalMs) {
      return false;
    }
    this.last.set(tgUserId, now);
    if (this.last.size > 10_000) {
      this.prune(now);
    }
    return true;
  }

  private prune(now: number): void {
    for (const [user, at] of this.last) {
      if (now - at >= this.intervalMs) {
        this.last.delete(user);
      }
    }
  }
}
