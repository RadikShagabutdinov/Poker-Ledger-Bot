// Component test harness: the real API client over a fake `fetch` with per-route handlers.
import type {
  ChatResponse,
  GameLogResponse,
  GameStateResponse,
  ProfileResponse,
} from '@pokerledger/shared';
import { QueryClient } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

import { AppProviders, AppRoutes } from '../App';
import { createApiClient } from '../api/client';

export interface Call {
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
}

export type Reply = { status?: number; body?: unknown };
export type Handler = (call: Call) => Reply;
/** `"POST /games/g1/events"` → handler or a fixed reply. */
export type Routes = Record<string, Handler | Reply>;

export function apiError(status: number, code: string, details?: Record<string, unknown>): Reply {
  return { status, body: { error: { code, ...(details ? { details } : {}) } } };
}

export function fakeFetch(routes: Routes) {
  const calls: Call[] = [];
  const fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href, 'http://test');
    const path = url.pathname.replace(/^\/api/, '') + url.search;
    const method = init?.method ?? 'GET';
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    const call = { method, path, body };
    calls.push(call);
    const route = routes[`${method} ${path}`];
    const reply: Reply =
      route === undefined
        ? apiError(404, 'NOT_FOUND')
        : typeof route === 'function'
          ? route(call)
          : route;
    return Promise.resolve(
      new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
        status: reply.status ?? 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  };
  return { fetch, calls };
}

export const ME: ProfileResponse = {
  tgUserId: 100,
  firstName: 'Вася',
  lastName: null,
  username: null,
  language: null,
  effectiveLanguage: 'ru',
  payPhone: null,
  payBank: null,
  payNote: null,
};

export const CHAT: ChatResponse = {
  id: 'chat1',
  title: 'Покерный клуб',
  language: 'ru',
  currency: 'RUB',
  stack: { chips: 30_000, amount: 1_000 },
  gameNameTemplate: 'Покер {date}',
  quickBuyins: [1, 0.5],
  botStatus: 'admin',
  isAdmin: false,
  nextGameName: 'Покер 15.09',
};

type GamePlayer = GameStateResponse['players'][number];

export function player(
  playerId: string,
  name: string,
  overrides: Partial<GamePlayer> = {},
): GamePlayer {
  return {
    playerId,
    name,
    isGuest: false,
    seatOrder: 1,
    status: 'seated',
    inChips: 30_000,
    outChips: 0,
    buyinCount: 1,
    rebuyCount: 0,
    moneyResult: null,
    ...overrides,
  };
}

export function game(overrides: Partial<GameStateResponse> = {}): GameStateResponse {
  return {
    id: 'game00000001',
    chatId: 'chat1',
    type: 'cash',
    name: 'Покер 15.09',
    status: 'active',
    currency: 'RUB',
    stack: { chips: 30_000, amount: 1_000 },
    version: 5,
    createdBy: 100,
    startedAt: 1_757_900_000_000,
    finishedAt: null,
    mismatch: null,
    settlementIsManual: false,
    summary: {
      issuedChips: 30_000,
      cashedOutChips: 0,
      expectedOnTableChips: 30_000,
      seatedCount: 1,
    },
    players: [player('p1', 'Вася')],
    myPlayerId: 'p1',
    permissions: { canManage: true, canEditFinished: false, canEditSettlement: false },
    ...overrides,
  };
}

type LogEntry = GameLogResponse['entries'][number];

export function logEntry(id: number, overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    id,
    type: 'buy_in',
    playerId: 'p1',
    playerName: 'Вася',
    chips: 30_000,
    payload: null,
    createdBy: { tgUserId: 100, name: 'Вася' },
    createdAt: 1_757_900_000_000 + id * 60_000,
    cancelled: null,
    ...overrides,
  };
}

/** Renders the app at `path` with the browser stand-ins for Telegram controls. */
export function renderApp(path: string, routes: Routes) {
  const { fetch, calls } = fakeFetch({ 'GET /me': { body: ME }, ...routes });
  const api = createApiClient({ baseUrl: '/api', initDataRaw: 'user=test', fetch });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const result = render(
    <AppProviders api={api} language="ru" nativeUi={false} queryClient={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </AppProviders>,
  );
  /** Requests other than reads. */
  const mutations = () => calls.filter((c) => c.method !== 'GET');
  return { ...result, calls, mutations, queryClient };
}

/** Same text with plain spaces: Intl groups digits with no-break spaces in ru. */
export const plain = (text: string | null | undefined) =>
  (text ?? '').replace(/[\u00a0\u202f]/g, ' ');
