import { describe, expect, it } from 'vitest';

import { apiError, fakeFetch, ME } from '../test/testUtils';
import { ApiError, createApiClient } from './client';

describe('createApiClient', () => {
  it('sends initData in the Authorization header and parses the response', async () => {
    const seen: Headers[] = [];
    const { fetch } = fakeFetch({ 'GET /me': { body: ME } });
    const api = createApiClient({
      baseUrl: '/api',
      initDataRaw: 'user=%7B%7D&hash=abc',
      fetch: (input, init) => {
        seen.push(new Headers(init?.headers));
        return fetch(input, init);
      },
    });
    await expect(api.me()).resolves.toEqual(ME);
    expect(seen[0]?.get('authorization')).toBe('tma user=%7B%7D&hash=abc');
  });

  it('turns an error body into ApiError with code and details', async () => {
    const { fetch } = fakeFetch({
      'POST /games/g1/events/7/cancel': apiError(422, 'INVALID_EVENT_SEQUENCE', {
        blockingEventId: 9,
      }),
    });
    const api = createApiClient({ baseUrl: '/api', initDataRaw: 'x', fetch });
    const error = await api.cancelEvent('g1', 7).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      code: 'INVALID_EVENT_SEQUENCE',
      details: { blockingEventId: 9 },
      status: 422,
    });
  });

  it('reports network failures and malformed responses as INTERNAL_ERROR', async () => {
    const offline = createApiClient({
      baseUrl: '/api',
      initDataRaw: 'x',
      fetch: () => Promise.reject(new TypeError('Failed to fetch')),
    });
    await expect(offline.me()).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
      details: { reason: 'NETWORK' },
      status: 0,
    });

    const { fetch } = fakeFetch({ 'GET /me': { body: { tgUserId: 'nope' } } });
    const broken = createApiClient({ baseUrl: '/api', initDataRaw: 'x', fetch });
    await expect(broken.me()).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
      details: { reason: 'BAD_RESPONSE' },
    });
  });

  it('builds the history query from defined parameters only', async () => {
    const { fetch, calls } = fakeFetch({});
    const api = createApiClient({ baseUrl: '/api', initDataRaw: 'x', fetch });
    await api.chatGames('chat1', { status: 'active' }).catch(() => undefined);
    expect(calls[0]?.path).toBe('/chats/chat1/games?status=active');
  });
});
