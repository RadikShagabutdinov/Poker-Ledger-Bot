import type { ErrorBody, ErrorCode } from '@pokerledger/shared';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

import type { Logger } from '../logger';
import { ServiceError } from '../services';

/** HTTP status of every error code (SPEC §11). The body carries the code only (I18N-06). */
export const ERROR_STATUS: Record<ErrorCode, ContentfulStatusCode> = {
  UNAUTHORIZED: 401,
  NOT_CHAT_MEMBER: 403,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  ACTIVE_GAME_EXISTS: 409,
  INVALID_GAME_STATUS: 409,
  GUEST_NAME_TAKEN: 409,
  NOTHING_TO_UNDO: 409,
  VALIDATION: 422,
  INVALID_EVENT_SEQUENCE: 422,
  MISSING_FINAL_CHIPS: 422,
  INVALID_FINAL_CHIPS: 422,
  INVALID_MISMATCH_PLAYER: 422,
  EMPTY_GAME: 422,
  EVENT_NOT_CANCELLABLE: 422,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
};

export function errorResponse(
  c: Context,
  code: ErrorCode,
  details?: Record<string, unknown>,
): Response {
  const body: ErrorBody = { error: details === undefined ? { code } : { code, details } };
  return c.json(body, ERROR_STATUS[code]);
}

/** `onError`: business errors become their code; anything else is a logged 500. */
export function handleError(logger: Logger) {
  return (error: Error, c: Context): Response => {
    if (error instanceof ServiceError) {
      return errorResponse(c, error.code, error.details);
    }
    // No request body or headers here: they may carry initData or payment details (SEC-09).
    logger.error({ err: error, method: c.req.method, path: c.req.path }, 'request failed');
    return errorResponse(c, 'INTERNAL_ERROR');
  };
}
