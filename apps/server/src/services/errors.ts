import type { ErrorCode } from '@pokerledger/shared';
import type { z } from 'zod';

/** Expected business error; the API turns it into `{ error: { code, details } }`. */
export class ServiceError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly details?: Record<string, unknown>,
  ) {
    super(code);
    this.name = 'ServiceError';
  }
}

/** Validates `value` with a shared zod schema, throwing `VALIDATION` on failure. */
export function parseInput<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ServiceError('VALIDATION', {
      issues: result.error.issues.map((i) => ({ path: i.path.map(String), code: i.code })),
    });
  }
  return result.data;
}
