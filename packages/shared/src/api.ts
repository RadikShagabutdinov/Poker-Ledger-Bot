// HTTP API contract: request bodies and queries the server validates, and
// response shapes the Mini App relies on.
import { z } from 'zod';

import { ERROR_CODES } from './errors';
import { chipsSchema, languageSchema, stackSchema, transferSchema } from './schemas';

const id = z.string().min(1).max(64);
const version = z.number().int().positive();
const timestamp = z.number().int().nonnegative();

/** What to do with a manual settlement when a finished-game edit changes results. */
export const settlementPolicySchema = z.enum(['recalculate', 'keep']);
export type SettlementPolicy = z.infer<typeof settlementPolicySchema>;

/** Fields shared by edits of a finished game. */
const finishedEditFields = {
  expectedVersion: version.optional(),
  settlementPolicy: settlementPolicySchema.optional(),
};

// ---------------------------------------------------------------------------
// Requests

/** `POST /chats/:chatId/players`. */
export const addGuestBodySchema = z.object({ name: z.string() });

/** `PATCH /chats/:chatId/players/:playerId`; `null` resets a Telegram player's name. */
export const renamePlayerBodySchema = z.object({ name: z.string().nullable() });

/** `GET /chats/:chatId/games` query. `from`/`to` are UTC ms, `to` exclusive. */
export const historyQuerySchema = z.object({
  status: z.enum(['active', 'finished']).optional(),
  type: z.enum(['cash', 'tournament']).optional(),
  from: z.coerce.number().int().nonnegative().optional(),
  to: z.coerce.number().int().nonnegative().optional(),
  cursor: z.string().min(1).max(200).optional(),
});
export type HistoryQueryParams = z.infer<typeof historyQuerySchema>;

/** `POST /chats/:chatId/games`; omitted fields come from the chat settings. */
export const createGameBodySchema = z.object({
  name: z.string().optional(),
  type: z.enum(['cash', 'tournament']).optional(),
  stackChips: z.number().optional(),
  stackAmount: z.number().optional(),
});
export type CreateGameBody = z.infer<typeof createGameBodySchema>;

/** Chip mismatch adjustment in the flat form of the API body. */
const mismatchFields = {
  mismatchMode: z.enum(['proportional', 'single_player']),
  mismatchPlayerId: id.optional(),
};

/**
 * `PATCH /games/:gameId`: name and stack; for a finished game also the
 * mismatch adjustment.
 */
export const updateGameBodySchema = z.object({
  name: z.string().optional(),
  stack: stackSchema.optional(),
  mismatchMode: mismatchFields.mismatchMode.optional(),
  mismatchPlayerId: mismatchFields.mismatchPlayerId,
  ...finishedEditFields,
});
export type UpdateGameBody = z.infer<typeof updateGameBodySchema>;

/** `POST /games/:gameId/players`: a known chat player, a new guest, or the user. */
export const addGamePlayerBodySchema = z.union([
  z.object({ playerId: id }).strict(),
  z.object({ guestName: z.string() }).strict(),
  z.object({ self: z.literal(true) }).strict(),
]);
export type AddGamePlayerBody = z.infer<typeof addGamePlayerBodySchema>;

/** `POST /games/:gameId/events`; `buy` becomes `buy_in` or `rebuy`. */
export const gameEventBodySchema = z.object({
  type: z.enum(['buy', 'cash_out']),
  playerId: id,
  chips: z.number(),
  ...finishedEditFields,
});
export type GameEventBody = z.infer<typeof gameEventBodySchema>;

/** `POST /games/:gameId/events/:eventId/cancel`. */
export const cancelEventBodySchema = z.object(finishedEditFields);

/** `POST /games/:gameId/undo`. */
export const undoBodySchema = z.object({ mineOnly: z.boolean().optional() });

/**
 * `POST /games/:gameId/edit`: one atomic batch of changes to a finished game
 *. `replace` corrects the chips of an event in place.
 */
export const editFinishedBodySchema = z.object({
  cancel: z.array(z.number().int().positive()).max(100).optional(),
  add: z
    .array(
      z.object({ playerId: id, type: z.enum(['buy_in', 'rebuy', 'cash_out']), chips: z.number() }),
    )
    .max(100)
    .optional(),
  replace: z
    .array(z.object({ eventId: z.number().int().positive(), chips: z.number() }))
    .max(100)
    .optional(),
  ...finishedEditFields,
});
export type EditFinishedBody = z.infer<typeof editFinishedBodySchema>;

/** `POST /games/:gameId/finish/preview`. */
export const finishPreviewBodySchema = z.object({
  finalChips: z.record(z.string(), z.number()),
  ...mismatchFields,
});
export type FinishPreviewBody = z.infer<typeof finishPreviewBodySchema>;

/** `POST /games/:gameId/finish`. */
export const finishBodySchema = finishPreviewBodySchema.extend({ expectedVersion: version });
export type FinishBody = z.infer<typeof finishBodySchema>;

/** `PUT /games/:gameId/settlement`. */
export const settlementPutBodySchema = z.object({
  transfers: z.array(transferSchema).max(1000),
  expectedVersion: version,
});
export type SettlementPutBody = z.infer<typeof settlementPutBodySchema>;

/** Bodies that only carry an optional `expectedVersion` (reopen, settlement reset). */
export const versionBodySchema = z.object({ expectedVersion: version.optional() });

// ---------------------------------------------------------------------------
// Responses

export const errorBodySchema = z.object({
  error: z.object({
    code: z.enum(ERROR_CODES),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});
export type ErrorBody = z.infer<typeof errorBodySchema>;

/** `GET /me`, `PATCH /me`. */
export const profileResponseSchema = z.object({
  tgUserId: z.number().int(),
  firstName: z.string(),
  lastName: z.string().nullable(),
  username: z.string().nullable(),
  language: languageSchema.nullable(),
  effectiveLanguage: languageSchema,
  payPhone: z.string().nullable(),
  payBank: z.string().nullable(),
  payNote: z.string().nullable(),
});
export type ProfileResponse = z.infer<typeof profileResponseSchema>;

/** `GET /me/chats`. */
export const myChatsResponseSchema = z.object({
  chats: z.array(z.object({ chatId: id, title: z.string(), activeGameIds: z.array(id) })),
});
export type MyChatsResponse = z.infer<typeof myChatsResponseSchema>;

/** `GET /chats/:chatId`, `PATCH /chats/:chatId/settings`. */
export const chatResponseSchema = z.object({
  id,
  title: z.string(),
  language: languageSchema,
  currency: z.string(),
  stack: stackSchema,
  gameNameTemplate: z.string(),
  quickBuyins: z.array(z.number()),
  botStatus: z.enum(['member', 'admin', 'left']),
  isAdmin: z.boolean(),
  /** The name the next game gets from the template. */
  nextGameName: z.string(),
});
export type ChatResponse = z.infer<typeof chatResponseSchema>;

export const playerSchema = z.object({ playerId: id, name: z.string(), isGuest: z.boolean() });
export type PlayerResponse = z.infer<typeof playerSchema>;

/** `GET /chats/:chatId/players`. */
export const playersResponseSchema = z.object({ players: z.array(playerSchema) });
export type PlayersResponse = z.infer<typeof playersResponseSchema>;

const gameType = z.enum(['cash', 'tournament']);
const gameStatus = z.enum(['active', 'finished', 'deleted']);

/** `GET /chats/:chatId/games`. */
export const historyPageResponseSchema = z.object({
  items: z.array(
    z.object({
      id,
      name: z.string(),
      type: gameType,
      status: gameStatus,
      startedAt: timestamp,
      finishedAt: timestamp.nullable(),
      playerCount: z.number().int(),
      issuedChips: z.number().int(),
      currency: z.string(),
      stack: stackSchema,
      mismatchChips: z.number().int().nullable(),
    }),
  ),
  nextCursor: z.string().nullable(),
});
export type HistoryPageResponse = z.infer<typeof historyPageResponseSchema>;

/** `GET /games/:gameId`. */
export const gameStateSchema = z.object({
  id,
  chatId: id,
  type: gameType,
  name: z.string(),
  status: gameStatus,
  currency: z.string(),
  stack: stackSchema,
  version,
  createdBy: z.number().int(),
  startedAt: timestamp,
  finishedAt: timestamp.nullable(),
  mismatch: z
    .object({
      mode: z.enum(['proportional', 'single_player']),
      playerId: id.nullable(),
      chips: z.number().int(),
    })
    .nullable(),
  settlementIsManual: z.boolean(),
  summary: z.object({
    issuedChips: z.number().int(),
    cashedOutChips: z.number().int(),
    expectedOnTableChips: z.number().int(),
    seatedCount: z.number().int(),
  }),
  players: z.array(
    z.object({
      playerId: id,
      name: z.string(),
      isGuest: z.boolean(),
      seatOrder: z.number().int(),
      status: z.enum(['not_joined', 'seated', 'left']),
      inChips: z.number().int(),
      outChips: z.number().int(),
      buyinCount: z.number().int(),
      rebuyCount: z.number().int(),
      moneyResult: z.number().int().nullable(),
    }),
  ),
  /** The current user's player in this game, if any. */
  myPlayerId: id.nullable(),
  permissions: z.object({
    canManage: z.boolean(),
    canEditFinished: z.boolean(),
    canEditSettlement: z.boolean(),
  }),
});
export type GameStateResponse = z.infer<typeof gameStateSchema>;

/** Responses of game mutations: the fresh game state plus what the mutation returns. */
export const gameMutationResponseSchema = z.object({ game: gameStateSchema });
export type GameMutationResponse = z.infer<typeof gameMutationResponseSchema>;

const eventResultSchema = z.object({
  eventId: z.number().int(),
  playerId: id,
  type: z.enum(['buy_in', 'rebuy', 'cash_out']),
  chips: chipsSchema,
});

/** `POST /games/:gameId/events`, `/cancel`, `/undo` on an active game. */
export const eventMutationResponseSchema = gameMutationResponseSchema.extend({
  /** Absent for finished games, where the change goes through the edit batch. */
  event: eventResultSchema.optional(),
});
export type EventMutationResponse = z.infer<typeof eventMutationResponseSchema>;

/** `POST /games/:gameId/players`. */
export const addGamePlayerResponseSchema = gameMutationResponseSchema.extend({
  playerId: id,
  added: z.boolean(),
});
export type AddGamePlayerResponse = z.infer<typeof addGamePlayerResponseSchema>;

/** `GET /games/:gameId/log`. */
export const gameLogResponseSchema = z.object({
  entries: z.array(
    z.object({
      id: z.number().int(),
      type: z.string(),
      playerId: id.nullable(),
      playerName: z.string().nullable(),
      chips: z.number().int().nullable(),
      payload: z.record(z.string(), z.unknown()).nullable(),
      createdBy: z.object({ tgUserId: z.number().int(), name: z.string() }),
      createdAt: timestamp,
      cancelled: z.object({ by: z.number().int(), at: timestamp }).nullable(),
    }),
  ),
});
export type GameLogResponse = z.infer<typeof gameLogResponseSchema>;

const transferResponseSchema = z.object({ from: id, to: id, amount: z.number().int() });

/** `POST /games/:gameId/finish/preview`. */
export const finishPreviewResponseSchema = z.object({
  mismatchChips: z.number().int(),
  summary: z.object({
    issuedChips: z.number().int(),
    cashedOutChips: z.number().int(),
    expectedOnTable: z.number().int(),
    seatedCount: z.number().int(),
  }),
  players: z.array(
    z.object({
      playerId: id,
      inChips: z.number().int(),
      outChips: z.number().int(),
      adjustmentChips: z.object({ num: z.number().int(), den: z.number().int() }),
      moneyResult: z.number().int(),
    }),
  ),
  transfers: z.array(transferResponseSchema),
});
export type FinishPreviewResponse = z.infer<typeof finishPreviewResponseSchema>;

/** `POST /games/:gameId/finish`. */
export const finishResponseSchema = gameMutationResponseSchema.extend({
  result: finishPreviewResponseSchema,
});
export type FinishResponse = z.infer<typeof finishResponseSchema>;

/** Payment details of a recipient; only for players of the game. */
export const paymentDetailsSchema = z.object({
  phone: z.string().nullable(),
  bank: z.string().nullable(),
  note: z.string().nullable(),
});
export type PaymentDetailsResponse = z.infer<typeof paymentDetailsSchema>;

/** `GET|PUT /games/:gameId/settlement`, `POST /games/:gameId/settlement/reset`. */
export const settlementResponseSchema = z.object({
  version,
  isManual: z.boolean(),
  transfers: z.array(
    transferResponseSchema.extend({ recipientPayment: paymentDetailsSchema.optional() }),
  ),
  warnings: z.array(
    z.union([
      z.object({ code: z.literal('BALANCE_MISMATCH'), playerId: id, delta: z.number().int() }),
      z.object({ code: z.literal('UNKNOWN_PLAYER'), playerId: id }),
    ]),
  ),
});
export type SettlementResponse = z.infer<typeof settlementResponseSchema>;
