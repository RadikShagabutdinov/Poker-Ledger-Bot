import type { Api } from 'grammy';
import type { Logger } from 'pino';

import type { Db } from '../db/client';
import { translator } from '../i18n';
import {
  loadGameMessageData,
  setBotStatus,
  setResultMessageId,
  setStatusMessageId,
  type MessageUpdater,
} from '../services';
import { isBotRemoved, isMessageGone, isNotModified } from './errors';
import type { MiniAppLinks } from './links';
import type { RenderedMessage } from './render/common';
import { renderDeleted, renderReopened, renderResult } from './render/result';
import { renderFinishedStatus, renderStatus } from './render/status';

/** Changes of a game are grouped for this long before its messages are updated. */
export const UPDATE_DELAY_MS = 2000;

export type MessageApi = Pick<
  Api,
  'sendMessage' | 'editMessageText' | 'pinChatMessage' | 'unpinChatMessage'
>;

export interface MessageUpdaterOptions {
  readonly db: Db;
  readonly api: MessageApi;
  readonly links: MiniAppLinks;
  readonly logger: Logger;
  readonly now: () => number;
  readonly delayMs?: number;
}

/**
 * Keeps a game's chat messages in line with the database. The first change starts a 2 s
 * timer; later changes within
 * it are folded into the same update, so a busy game is still updated every 2 s.
 * Updates of one game run one at a time; each renders the current state, so what
 * to do follows from the stored status and message ids alone.
 */
export class BotMessageUpdater implements MessageUpdater {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly running = new Map<string, Promise<void>>();
  private readonly delayMs: number;

  constructor(private readonly options: MessageUpdaterOptions) {
    this.delayMs = options.delayMs ?? UPDATE_DELAY_MS;
  }

  schedule(gameId: string): void {
    if (this.timers.has(gameId)) {
      return;
    }
    this.timers.set(
      gameId,
      setTimeout(() => {
        this.timers.delete(gameId);
        void this.run(gameId);
      }, this.delayMs),
    );
  }

  /**
   * Runs pending updates now: of one game (right after `/newgame`) or of all games
   * (graceful shutdown), and waits for updates in progress.
   */
  async flush(gameId?: string): Promise<void> {
    const ids = gameId === undefined ? [...this.timers.keys(), ...this.running.keys()] : [gameId];
    await Promise.all(
      [...new Set(ids)].map((id) => {
        const timer = this.timers.get(id);
        if (timer !== undefined) {
          clearTimeout(timer);
          this.timers.delete(id);
          return this.run(id);
        }
        return this.running.get(id) ?? Promise.resolve();
      }),
    );
  }

  private run(gameId: string): Promise<void> {
    const previous = this.running.get(gameId) ?? Promise.resolve();
    const next = previous
      .then(() => this.sync(gameId))
      .catch((error: unknown) => {
        this.options.logger.error({ err: error, gameId }, 'game message update failed');
      });
    this.running.set(gameId, next);
    void next.then(() => {
      if (this.running.get(gameId) === next) {
        this.running.delete(gameId);
      }
    });
    return next;
  }

  private async sync(gameId: string): Promise<void> {
    const { db, links } = this.options;
    const data = loadGameMessageData(db, gameId);
    if (!data || data.chat.botStatus === 'left') {
      return;
    }
    const { game, chat } = data;
    const chatId = chat.tgChatId;
    const language = chat.language;
    try {
      switch (game.status) {
        case 'active': {
          if (game.resultMessageId !== null) {
            await this.edit(chatId, game.resultMessageId, renderReopened(game.name, language));
            setResultMessageId(db, game.id, null);
          }
          const status = renderStatus(data.state, language, links);
          if (
            game.statusMessageId === null ||
            !(await this.edit(chatId, game.statusMessageId, status))
          ) {
            await this.sendStatus(gameId, chatId, status, language);
          }
          return;
        }
        case 'finished': {
          if (game.statusMessageId !== null) {
            await this.edit(
              chatId,
              game.statusMessageId,
              renderFinishedStatus(data.state, language),
            );
            await this.unpin(chatId, game.statusMessageId);
            setStatusMessageId(db, game.id, null);
          }
          const result = renderResult(data, language, links);
          if (
            game.resultMessageId === null ||
            !(await this.edit(chatId, game.resultMessageId, result))
          ) {
            const sent = await this.send(chatId, result);
            setResultMessageId(db, game.id, sent);
          }
          return;
        }
        case 'deleted': {
          const deleted = renderDeleted(game.name, language);
          if (game.statusMessageId !== null) {
            await this.edit(chatId, game.statusMessageId, deleted);
            await this.unpin(chatId, game.statusMessageId);
            setStatusMessageId(db, game.id, null);
          }
          if (game.resultMessageId !== null) {
            await this.edit(chatId, game.resultMessageId, deleted);
            setResultMessageId(db, game.id, null);
          }
          return;
        }
      }
    } catch (error) {
      if (isBotRemoved(error)) {
        this.options.logger.warn({ gameId, chatId: chat.id }, 'bot cannot write to the chat');
        setBotStatus(this.options, chatId, 'left');
        return;
      }
      throw error;
    }
  }

  /** Sends and pins a new status message. */
  private async sendStatus(
    gameId: string,
    chatId: number,
    message: RenderedMessage,
    language: 'ru' | 'en',
  ): Promise<void> {
    const messageId = await this.send(chatId, message);
    setStatusMessageId(this.options.db, gameId, messageId);
    try {
      await this.options.api.pinChatMessage(chatId, messageId, { disable_notification: true });
    } catch (error) {
      if (isBotRemoved(error)) {
        throw error;
      }
      // No right to pin: the game works with a plain message, say so once.
      this.options.logger.info({ gameId }, 'cannot pin the game message');
      await this.options.api.sendMessage(chatId, translator(language)('chat.pinFailed'));
    }
  }

  private async send(chatId: number, message: RenderedMessage): Promise<number> {
    const sent = await this.options.api.sendMessage(chatId, message.text, {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      ...(message.keyboard ? { reply_markup: message.keyboard } : {}),
    });
    return sent.message_id;
  }

  /**
   * Edits a message; without a keyboard its buttons are removed. `false` if the
   * message is gone (deleted by someone).
   */
  private async edit(
    chatId: number,
    messageId: number,
    message: RenderedMessage,
  ): Promise<boolean> {
    try {
      await this.options.api.editMessageText(chatId, messageId, message.text, {
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
        ...(message.keyboard ? { reply_markup: message.keyboard } : {}),
      });
      return true;
    } catch (error) {
      if (isNotModified(error)) {
        return true;
      }
      if (isMessageGone(error)) {
        return false;
      }
      throw error;
    }
  }

  private async unpin(chatId: number, messageId: number): Promise<void> {
    try {
      await this.options.api.unpinChatMessage(chatId, messageId);
    } catch (error) {
      // Not pinned, already unpinned or no rights: nothing to undo.
      if (isBotRemoved(error)) {
        throw error;
      }
    }
  }
}
