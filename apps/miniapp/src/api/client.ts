// HTTP API client: `Authorization: tma <initDataRaw>`, responses checked by the
// shared zod schemas, errors as codes only.
import {
  addGamePlayerResponseSchema,
  chatResponseSchema,
  ERROR_CODES,
  errorBodySchema,
  eventMutationResponseSchema,
  finishPreviewResponseSchema,
  finishResponseSchema,
  gameLogResponseSchema,
  gameMutationResponseSchema,
  gameStateSchema,
  historyPageResponseSchema,
  myChatsResponseSchema,
  playersResponseSchema,
  profileResponseSchema,
  settlementResponseSchema,
  type AddGamePlayerBody,
  type AddGamePlayerResponse,
  type ChatResponse,
  type ChatSettingsPatch,
  type CreateGameBody,
  type EditFinishedBody,
  type ErrorCode,
  type EventMutationResponse,
  type FinishBody,
  type FinishPreviewBody,
  type FinishPreviewResponse,
  type FinishResponse,
  type GameEventBody,
  type GameLogResponse,
  type GameMutationResponse,
  type GameStateResponse,
  type HistoryPageResponse,
  type HistoryQueryParams,
  type MyChatsResponse,
  type PlayersResponse,
  type ProfilePatch,
  type ProfileResponse,
  type SettlementPutBody,
  type SettlementResponse,
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
  updateMe(patch: ProfilePatch): Promise<ProfileResponse>;
  myChats(): Promise<MyChatsResponse>;
  chat(chatId: string): Promise<ChatResponse>;
  updateChatSettings(chatId: string, patch: ChatSettingsPatch): Promise<ChatResponse>;
  chatPlayers(chatId: string): Promise<PlayersResponse>;
  chatGames(chatId: string, query?: HistoryQueryParams): Promise<HistoryPageResponse>;
  createGame(chatId: string, body: CreateGameBody): Promise<GameMutationResponse>;
  game(gameId: string): Promise<GameStateResponse>;
  updateGame(gameId: string, body: UpdateGameBody): Promise<GameMutationResponse>;
  /** An atomic batch of event changes of a finished game. */
  editFinished(gameId: string, body: EditFinishedBody): Promise<GameMutationResponse>;
  reopen(gameId: string, expectedVersion: number): Promise<GameMutationResponse>;
  deleteGame(gameId: string): Promise<void>;
  addPlayer(gameId: string, body: AddGamePlayerBody): Promise<AddGamePlayerResponse>;
  addEvent(gameId: string, body: GameEventBody): Promise<EventMutationResponse>;
  cancelEvent(gameId: string, eventId: number): Promise<EventMutationResponse>;
  undo(gameId: string): Promise<EventMutationResponse>;
  log(gameId: string): Promise<GameLogResponse>;
  finishPreview(gameId: string, body: FinishPreviewBody): Promise<FinishPreviewResponse>;
  finish(gameId: string, body: FinishBody): Promise<FinishResponse>;
  settlement(gameId: string): Promise<SettlementResponse>;
  saveSettlement(gameId: string, body: SettlementPutBody): Promise<SettlementResponse>;
  resetSettlement(gameId: string, expectedVersion: number): Promise<SettlementResponse>;
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

  async function send(method: string, path: string, body?: unknown): Promise<Response> {
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
    return response;
  }

  async function request<S extends z.ZodType>(
    schema: S,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<z.infer<S>> {
    const response = await send(method, path, body);
    const parsed = schema.safeParse(await response.json().catch(() => undefined));
    if (!parsed.success) {
      throw new ApiError('INTERNAL_ERROR', { reason: 'BAD_RESPONSE' }, response.status);
    }
    return parsed.data;
  }

  return {
    me: () => request(profileResponseSchema, 'GET', '/me'),
    updateMe: (patch) => request(profileResponseSchema, 'PATCH', '/me', patch),
    myChats: () => request(myChatsResponseSchema, 'GET', '/me/chats'),
    chat: (chatId) => request(chatResponseSchema, 'GET', `/chats/${enc(chatId)}`),
    updateChatSettings: (chatId, patch) =>
      request(chatResponseSchema, 'PATCH', `/chats/${enc(chatId)}/settings`, patch),
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
    editFinished: (gameId, body) =>
      request(gameMutationResponseSchema, 'POST', `/games/${enc(gameId)}/edit`, body),
    reopen: (gameId, expectedVersion) =>
      request(gameMutationResponseSchema, 'POST', `/games/${enc(gameId)}/reopen`, {
        expectedVersion,
      }),
    deleteGame: async (gameId) => {
      await send('DELETE', `/games/${enc(gameId)}`);
    },
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
    finishPreview: (gameId, body) =>
      request(finishPreviewResponseSchema, 'POST', `/games/${enc(gameId)}/finish/preview`, body),
    finish: (gameId, body) =>
      request(finishResponseSchema, 'POST', `/games/${enc(gameId)}/finish`, body),
    settlement: (gameId) =>
      request(settlementResponseSchema, 'GET', `/games/${enc(gameId)}/settlement`),
    saveSettlement: (gameId, body) =>
      request(settlementResponseSchema, 'PUT', `/games/${enc(gameId)}/settlement`, body),
    resetSettlement: (gameId, expectedVersion) =>
      request(settlementResponseSchema, 'POST', `/games/${enc(gameId)}/settlement/reset`, {
        expectedVersion,
      }),
  };
}
