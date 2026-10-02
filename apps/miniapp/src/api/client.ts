// HTTP API client (SPEC §11): `Authorization: tma <initDataRaw>`, responses checked by the
// shared zod schemas, errors as codes only (I18N-06).
import {
  addGamePlayerResponseSchema,
  chatResponseSchema,
  ERROR_CODES,
  errorBodySchema,
  eventMutationResponseSchema,
  gameLogResponseSchema,
  gameMutationResponseSchema,
  gameStateSchema,
  historyPageResponseSchema,
  playersResponseSchema,
  profileResponseSchema,
  type AddGamePlayerBody,
  type AddGamePlayerResponse,
  type ChatResponse,
  type CreateGameBody,
  type ErrorCode,
  type EventMutationResponse,
  type GameEventBody,
  type GameLogResponse,
  type GameMutationResponse,
  type GameStateResponse,
  type HistoryPageResponse,
  type HistoryQueryParams,
  type PlayersResponse,
  type ProfileResponse,
  type UpdateGameBody,
} from '@pokerledger/shared';
import type { z } from 'zod';

/** An API failure: the error code of the server, or `INTERNAL_ERROR` for network trouble. */
export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly details: Record<string, unknown> | undefined,
    /** HTTP status; 0 when the request did not reach the server. */
    readonly status: number,
  ) {
    super(code);
    this.name = 'ApiError';
  }
}

export function isApiError(error: unknown, code?: ErrorCode): error is ApiError {
  return error instanceof ApiError && (code === undefined || error.code === code);
}

export interface ApiClient {
  me(): Promise<ProfileResponse>;
  chat(chatId: string): Promise<ChatResponse>;
  chatPlayers(chatId: string): Promise<PlayersResponse>;
  chatGames(chatId: string, query?: HistoryQueryParams): Promise<HistoryPageResponse>;
  createGame(chatId: string, body: CreateGameBody): Promise<GameMutationResponse>;
  game(gameId: string): Promise<GameStateResponse>;
  updateGame(gameId: string, body: UpdateGameBody): Promise<GameMutationResponse>;
  addPlayer(gameId: string, body: AddGamePlayerBody): Promise<AddGamePlayerResponse>;
  addEvent(gameId: string, body: GameEventBody): Promise<EventMutationResponse>;
  cancelEvent(gameId: string, eventId: number): Promise<EventMutationResponse>;
  undo(gameId: string): Promise<EventMutationResponse>;
  log(gameId: string): Promise<GameLogResponse>;
}

export interface ApiClientOptions {
  /** `https://<domain>/api`, without a trailing slash. */
  readonly baseUrl: string;
  readonly initDataRaw: string;
  readonly fetch?: typeof fetch;
}

const KNOWN_CODES = new Set<string>(ERROR_CODES);

async function toApiError(response: Response): Promise<ApiError> {
  try {
    const body = errorBodySchema.safeParse(await response.json());
    if (body.success && KNOWN_CODES.has(body.data.error.code)) {
      return new ApiError(body.data.error.code, body.data.error.details, response.status);
    }
  } catch {
    // Not JSON: a proxy error page or similar.
  }
  return new ApiError('INTERNAL_ERROR', { reason: 'BAD_RESPONSE' }, response.status);
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const enc = encodeURIComponent;

  async function request<S extends z.ZodType>(
    schema: S,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<z.infer<S>> {
    const headers: Record<string, string> = { authorization: `tma ${options.initDataRaw}` };
    if (body !== undefined) {
      headers['content-type'] = 'application/json';
    }
    let response: Response;
    try {
      response = await doFetch(`${options.baseUrl}${path}`, {
        method,
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      throw new ApiError('INTERNAL_ERROR', { reason: 'NETWORK' }, 0);
    }
    if (!response.ok) {
      throw await toApiError(response);
    }
    const parsed = schema.safeParse(await response.json().catch(() => undefined));
    if (!parsed.success) {
      throw new ApiError('INTERNAL_ERROR', { reason: 'BAD_RESPONSE' }, response.status);
    }
    return parsed.data;
  }

  return {
    me: () => request(profileResponseSchema, 'GET', '/me'),
    chat: (chatId) => request(chatResponseSchema, 'GET', `/chats/${enc(chatId)}`),
    chatPlayers: (chatId) => request(playersResponseSchema, 'GET', `/chats/${enc(chatId)}/players`),
    chatGames: (chatId, query = {}) => {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) {
          params.set(key, String(value));
        }
      }
      const search = params.size > 0 ? `?${params.toString()}` : '';
      return request(historyPageResponseSchema, 'GET', `/chats/${enc(chatId)}/games${search}`);
    },
    createGame: (chatId, body) =>
      request(gameMutationResponseSchema, 'POST', `/chats/${enc(chatId)}/games`, body),
    game: (gameId) => request(gameStateSchema, 'GET', `/games/${enc(gameId)}`),
    updateGame: (gameId, body) =>
      request(gameMutationResponseSchema, 'PATCH', `/games/${enc(gameId)}`, body),
    addPlayer: (gameId, body) =>
      request(addGamePlayerResponseSchema, 'POST', `/games/${enc(gameId)}/players`, body),
    addEvent: (gameId, body) =>
      request(eventMutationResponseSchema, 'POST', `/games/${enc(gameId)}/events`, body),
    cancelEvent: (gameId, eventId) =>
      request(
        eventMutationResponseSchema,
        'POST',
        `/games/${enc(gameId)}/events/${String(eventId)}/cancel`,
        {},
      ),
    undo: (gameId) =>
      request(eventMutationResponseSchema, 'POST', `/games/${enc(gameId)}/undo`, {}),
    log: (gameId) => request(gameLogResponseSchema, 'GET', `/games/${enc(gameId)}/log`),
  };
}
