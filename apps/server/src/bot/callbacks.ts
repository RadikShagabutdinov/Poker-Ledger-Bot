import { gameIdSchema } from '@pokerledger/shared';

/**
 * Game message buttons (V1-MSG-03/08): `j:<gameId>` I'm in, `r:<gameId>` rebuy,
 * `u:<gameId>` undo mine. The game id keeps them working with several games (V2).
 */
export type GameAction = 'join' | 'rebuy' | 'undo';

const CODES: Record<GameAction, string> = { join: 'j', rebuy: 'r', undo: 'u' };
const ACTIONS = new Map(
  Object.entries(CODES).map(([action, code]) => [code, action as GameAction]),
);

export function gameCallback(action: GameAction, gameId: string): string {
  return `${CODES[action]}:${gameId}`;
}

export function parseGameCallback(
  data: string,
): { action: GameAction; gameId: string } | undefined {
  const match = /^([a-z]):(.+)$/.exec(data);
  const action = match?.[1] === undefined ? undefined : ACTIONS.get(match[1]);
  const gameId = match?.[2];
  if (!action || gameId === undefined || !gameIdSchema.safeParse(gameId).success) {
    return undefined;
  }
  return { action, gameId };
}
