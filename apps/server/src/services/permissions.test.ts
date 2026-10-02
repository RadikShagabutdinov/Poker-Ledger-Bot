import { describe, expect, it } from 'vitest';

import type { GameRow } from '../db/schema';
import { buySelf } from './events';
import { finishGame } from './finish';
import {
  canEditFinished,
  canEditSettlement,
  canManageGame,
  canSeePaymentDetails,
  canViewGame,
  type GameAccess,
} from './permissions';
import { getGameState } from './state';
import {
  ALICE,
  BOB,
  CAROL,
  DAVE,
  MALLORY,
  createTestDeps,
  currentVersion,
  setupGame,
} from './testing';

const roles: Record<string, GameAccess> = {
  outsider: { isMember: false, isAdmin: false, isCreator: false, isGamePlayer: false },
  member: { isMember: true, isAdmin: false, isCreator: false, isGamePlayer: false },
  player: { isMember: true, isAdmin: false, isCreator: false, isGamePlayer: true },
  creator: { isMember: true, isAdmin: false, isCreator: true, isGamePlayer: false },
  admin: { isMember: true, isAdmin: true, isCreator: false, isGamePlayer: false },
  playerWhoLeftChat: { isMember: false, isAdmin: false, isCreator: false, isGamePlayer: true },
};

describe('permission matrix', () => {
  const finished = { status: 'finished' } as GameRow;
  const active = { status: 'active' } as GameRow;

  it.each([
    // role, manage, editFinished, editSettlement, viewActive, viewFinished, paymentDetails
    ['outsider', false, false, false, false, false, false],
    ['member', true, false, false, true, true, false],
    ['player', true, false, true, true, true, true],
    ['creator', true, true, true, true, true, false],
    ['admin', true, true, true, true, true, false],
    ['playerWhoLeftChat', false, false, false, false, true, true],
  ] as const)(
    '%s',
    (role, manage, editFinished, editSettlement, viewActive, viewFinished, payment) => {
      const access = roles[role] as GameAccess;
      expect(canManageGame(access)).toBe(manage);
      expect(canEditFinished(access)).toBe(editFinished);
      expect(canEditSettlement(access)).toBe(editSettlement);
      expect(canViewGame(access, active)).toBe(viewActive);
      expect(canViewGame(access, finished)).toBe(viewFinished);
      expect(canSeePaymentDetails(access)).toBe(payment);
    },
  );

  it('game state reports the permissions of the current user', async () => {
    const deps = createTestDeps();
    const { game } = await setupGame(deps);
    const carol = await buySelf(deps, CAROL, game.id, { expect: 'buy_in' });
    await finishGame(deps, BOB, game.id, {
      finalChips: { [carol.playerId]: 30_000 },
      mismatch: { mode: 'proportional' },
      expectedVersion: currentVersion(deps, game.id),
    });
    const flags = async (who: typeof BOB) => (await getGameState(deps, who, game.id)).permissions;
    expect(await flags(BOB)).toEqual({
      canManage: false,
      canEditFinished: true,
      canEditSettlement: true,
    });
    expect(await flags(ALICE)).toEqual({
      canManage: false,
      canEditFinished: true,
      canEditSettlement: true,
    });
    expect(await flags(CAROL)).toEqual({
      canManage: false,
      canEditFinished: false,
      canEditSettlement: true,
    });
    expect(await flags(DAVE)).toEqual({
      canManage: false,
      canEditFinished: false,
      canEditSettlement: false,
    });
    await expect(getGameState(deps, MALLORY, game.id)).rejects.toMatchObject({
      code: 'NOT_CHAT_MEMBER',
    });
  });
});
