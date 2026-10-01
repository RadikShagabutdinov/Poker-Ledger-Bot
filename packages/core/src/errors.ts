/**
 * Thrown for programmer errors: inputs that a correct caller never produces
 * (non-integer chips, non-positive stack, unbalanced totals). Expected
 * validation failures are returned as `Result` values instead.
 */
export class CoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CoreError';
  }
}

/** Successful result with a value, or a failure with a typed error. */
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

/** Throws `CoreError` unless `value` is a safe integer. */
export function assertSafeInt(value: number, what: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new CoreError(`${what} must be a safe integer, got ${String(value)}`);
  }
}
