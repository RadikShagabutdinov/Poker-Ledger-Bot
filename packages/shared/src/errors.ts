/**
 * Error codes returned by services and the API. The API returns codes
 * only; user-facing texts are translated on the client.
 */
export const ERROR_CODES = [
  'UNAUTHORIZED',
  'NOT_CHAT_MEMBER',
  'FORBIDDEN',
  'NOT_FOUND',
  'VALIDATION',
  'CONFLICT',
  'ACTIVE_GAME_EXISTS',
  'INVALID_EVENT_SEQUENCE',
  'MISSING_FINAL_CHIPS',
  'INVALID_FINAL_CHIPS',
  'INVALID_MISMATCH_PLAYER',
  /** The action is not allowed in the current game status (e.g. finishing a finished game). */
  'INVALID_GAME_STATUS',
  /** A game without chip events can only be deleted, not finished. */
  'EMPTY_GAME',
  /** A guest with this name already exists in the chat; details carry its id. */
  'GUEST_NAME_TAKEN',
  /** Only buy-ins, rebuys and cash-outs can be cancelled. */
  'EVENT_NOT_CANCELLABLE',
  /** There is no event to undo. */
  'NOTHING_TO_UNDO',
  /** Too many API requests from this user; `Retry-After` says when to retry. */
  'RATE_LIMITED',
  /** Unexpected server failure. */
  'INTERNAL_ERROR',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** Error body of the API: `{ error: { code, details } }`. */
export interface ApiError {
  readonly code: ErrorCode;
  readonly details?: Record<string, unknown>;
}
