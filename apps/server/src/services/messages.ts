// System-level reads and writes for the bot's chat messages: no actor, no permission
// checks, never payment details (SEC-04).
import type { Language } from '@pokerledger/shared';

import type { DbOrTx } from '../db/client';
import { findChatPlayersWithUsers } from '../db/repositories/chatPlayers';
import { findChat } from '../db/repositories/chats';
import { findGame, updateGame } from '../db/repositories/games';
import { findUser } from '../db/repositories/users';
import type { ChatRow, GameRow } from '../db/schema';
import { languageFromCode, type Actor } from './context';
import { loadGameData } from './gameData';
import type { GameAccess } from './permissions';
import { buildSettlementView, type SettlementView } from './settlement';
import { buildGameState, type GameState } from './state';

const NO_ACCESS: GameAccess = {
  isMember: false,
  isAdmin: false,
  isCreator: false,
  isGamePlayer: false,
};

/** Everything the status and result messages of a game are rendered from. */
export interface GameMessageData {
  readonly game: GameRow;
  readonly chat: ChatRow;
  readonly state: GameState;
  /** Finished games only; without payment details. */
  readonly settlement: SettlementView | null;
  /** Telegram user of each linked player, for result mentions (SPEC §13.4). */
  readonly mentions: ReadonlyMap<string, number>;
}

/** Any game, deleted ones included; `undefined` if it does not exist. */
export function loadGameMessageData(db: DbOrTx, gameId: string): GameMessageData | undefined {
  const game = findGame(db, gameId);
  if (!game) {
    return undefined;
  }
  const chat = findChat(db, game.chatId) as ChatRow;
  const data = loadGameData(db, game);
  const mentions = new Map<string, number>();
  for (const { player } of findChatPlayersWithUsers(
    db,
    data.players.map((p) => p.playerId),
  )) {
    if (player.tgUserId !== null) {
      mentions.set(player.id, player.tgUserId);
    }
  }
  return {
    game,
    chat,
    state: buildGameState(db, data, NO_ACCESS, null),
    settlement: game.status === 'finished' ? buildSettlementView(db, game, false) : null,
    mentions,
  };
}

/** Message ids are bookkeeping, not game changes: no `version++`. */
export function setStatusMessageId(db: DbOrTx, gameId: string, messageId: number | null): void {
  updateGame(db, gameId, { statusMessageId: messageId });
}

export function setResultMessageId(db: DbOrTx, gameId: string, messageId: number | null): void {
  updateGame(db, gameId, { resultMessageId: messageId });
}

/**
 * Language of a user's own notifications (I18N-03): the profile setting, else the
 * Telegram `language_code`.
 */
export function userLanguage(db: DbOrTx, actor: Actor): Language {
  return findUser(db, actor.tgUserId)?.language ?? languageFromCode(actor.languageCode, 'ru');
}
