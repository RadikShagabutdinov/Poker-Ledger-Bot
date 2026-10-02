import { errorBodySchema } from '@pokerledger/shared';
import { describe, expect, it } from 'vitest';

import { ALICE, BOB, setupChat, setupGame } from '../services/testing';
import { MINIAPP_ORIGIN, createTestApp, initDataFor } from './testing';

describe('CORS (SEC-05)', () => {
  const preflight = (origin: string) => ({
    method: 'OPTIONS',
    headers: {
      Origin: origin,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'authorization,content-type',
    },
  });

  it('allows only the Mini App origin in production', async () => {
    const { app } = createTestApp();
    const allowed = await app.request('/api/me', preflight(MINIAPP_ORIGIN));
    expect(allowed.status).toBe(204);
    expect(allowed.headers.get('Access-Control-Allow-Origin')).toBe(MINIAPP_ORIGIN);
    expect(allowed.headers.get('Access-Control-Allow-Headers')).toMatch(/Authorization/i);

    for (const origin of ['https://evil.example', 'http://localhost:5173']) {
      const denied = await app.request('/api/me', preflight(origin));
      expect(denied.headers.get('Access-Control-Allow-Origin')).toBeNull();
    }
    const simple = await app.request('/api/me', {
      headers: { Origin: MINIAPP_ORIGIN, Authorization: `tma ${initDataFor(ALICE)}` },
    });
    expect(simple.headers.get('Access-Control-Allow-Origin')).toBe(MINIAPP_ORIGIN);
  });

  it('also allows http://localhost:* in development', async () => {
    const { app } = createTestApp({ dev: true });
    for (const origin of ['http://localhost:5173', 'http://127.0.0.1:4173', 'http://localhost']) {
      const response = await app.request('/api/me', preflight(origin));
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe(origin);
    }
    const lookalike = await app.request('/api/me', preflight('http://localhost.evil.example'));
    expect(lookalike.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
});

describe('rate limit (SEC-06)', () => {
  it('allows 60 requests per minute per user, then 429 with Retry-After', async () => {
    const t = createTestApp();
    for (let i = 0; i < 60; i++) {
      expect((await t.call(ALICE, 'GET', '/me')).status).toBe(200);
    }
    const limited = await t.call(ALICE, 'GET', '/me');
    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toBe('60');
    expect(await limited.json()).toEqual({ error: { code: 'RATE_LIMITED' } });
    // Other users are counted separately.
    expect((await t.call(BOB, 'GET', '/me')).status).toBe(200);
    t.deps.advance(60_000);
    expect((await t.call(ALICE, 'GET', '/me')).status).toBe(200);
  });
});

describe('errors (I18N-06)', () => {
  async function error(response: Response) {
    return { status: response.status, ...errorBodySchema.parse(await response.json()).error };
  }

  it('rejects invalid bodies with VALIDATION and issue details', async () => {
    const t = createTestApp();
    const { game } = await setupGame(t.deps);
    const wrong = await t.call(BOB, 'POST', `/games/${game.id}/events`, {
      body: { type: 'sell', playerId: 'p', chips: '10' },
    });
    expect(await error(wrong)).toMatchObject({
      status: 422,
      code: 'VALIDATION',
      details: {
        issues: expect.arrayContaining([
          expect.objectContaining({ path: ['type'] }),
          expect.objectContaining({ path: ['chips'] }),
        ]) as unknown,
      },
    });
    const negative = await t.call(BOB, 'PATCH', `/chats/${game.chatId}/settings`, {
      body: { stack: { chips: -1, amount: 10 } },
    });
    expect(await error(negative)).toMatchObject({ status: 422, code: 'VALIDATION' });
    const longNote = await t.call(BOB, 'PATCH', '/me', { body: { payNote: 'x'.repeat(201) } });
    expect(await error(longNote)).toMatchObject({ status: 422, code: 'VALIDATION' });
    const halfStack = await t.call(BOB, 'POST', `/chats/${game.chatId}/games`, {
      body: { stackChips: 1000 },
    });
    expect(await error(halfStack)).toMatchObject({ status: 422, code: 'VALIDATION' });
  });

  it('rejects broken JSON and oversized bodies', async () => {
    const t = createTestApp();
    const chat = setupChat(t.deps);
    const broken = await t.call(BOB, 'POST', `/chats/${chat.id}/players`, {
      rawBody: '{"name":',
      headers: { 'Content-Type': 'application/json' },
    });
    expect(await error(broken)).toEqual({
      status: 422,
      code: 'VALIDATION',
      details: { reason: 'INVALID_JSON' },
    });
    const huge = await t.call(BOB, 'POST', `/chats/${chat.id}/players`, {
      body: { name: 'x'.repeat(70_000) },
    });
    expect(await error(huge)).toMatchObject({ details: { reason: 'BODY_TOO_LARGE' } });
  });

  it('answers NOT_FOUND for unknown routes, games and malformed ids', async () => {
    const t = createTestApp();
    setupChat(t.deps);
    for (const path of ['/nope', '/games/short', '/games/AAAAAAAAAAAA', '/chats/unknown']) {
      expect(await error(await t.call(BOB, 'GET', path))).toEqual({
        status: 404,
        code: 'NOT_FOUND',
      });
    }
    const { game } = await setupGame(createTestApp().deps);
    expect((await t.call(BOB, 'POST', `/games/${game.id}/events/abc/cancel`)).status).toBe(404);
  });
});
