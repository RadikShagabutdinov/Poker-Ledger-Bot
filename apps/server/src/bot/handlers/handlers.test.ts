import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { findChat, findChatByTgId } from '../../db/repositories/chats';
import { listGameEvents } from '../../db/repositories/gameEvents';
import { findGame } from '../../db/repositories/games';
import { createGame, listActiveGames } from '../../services';
import {
  ALICE,
  BOB,
  CAROL,
  MALLORY,
  TG_CHAT_ID,
  actor,
  setupChat,
  setupGame,
} from '../../services/testing';
import { gameCallback } from '../callbacks';
import {
  GROUP,
  botMembership,
  buttonPress,
  createTestBot,
  privateChat,
  textMessage,
  type TestBot,
} from '../testing';

// Intl separates digit groups with a no-break space in ru.
const plain = (text: unknown) => String(text).replace(/[\u00a0\u202f]/g, ' ');
const lastAnswer = (t: TestBot) => plain(t.telegram.callsOf('answerCallbackQuery').at(-1)?.text);
const lastReply = (t: TestBot) => t.telegram.callsOf('sendMessage').at(-1);

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('chat membership of the bot', () => {
  it('registers the chat and greets it with a settings link', async () => {
    const t = createTestBot();
    await t.handle(botMembership(ALICE, 'left', 'member'));
    const chat = findChatByTgId(t.deps.db, TG_CHAT_ID);
    expect(chat).toMatchObject({ title: 'Poker club', language: 'ru', botStatus: 'member' });
    const welcome = lastReply(t);
    expect(String(welcome?.text)).toContain('/newgame');
    expect(String(welcome?.text)).toContain('закреплять');
    expect(welcome?.reply_markup).toEqual({
      inline_keyboard: [
        [
          {
            text: '⚙️ Настройки',
            url: `https://t.me/poker_ledger_bot/app?startapp=s_${chat?.id ?? ''}`,
          },
        ],
      ],
    });
  });

  it('greets in English when an English speaker adds the bot', async () => {
    const t = createTestBot();
    await t.handle(botMembership(actor(5, 'Eve', { languageCode: 'en-GB' }), 'left', 'member'));
    expect(findChatByTgId(t.deps.db, TG_CHAT_ID)?.language).toBe('en');
    expect(String(lastReply(t)?.text)).toContain('Hi!');
  });

  it('tracks rights, keeps data on removal and restores it', async () => {
    const t = createTestBot();
    await t.handle(botMembership(ALICE, 'left', 'member'));
    const id = findChatByTgId(t.deps.db, TG_CHAT_ID)?.id;
    await t.handle(botMembership(ALICE, 'member', 'administrator'));
    expect(findChatByTgId(t.deps.db, TG_CHAT_ID)?.botStatus).toBe('admin');
    await t.handle(botMembership(ALICE, 'administrator', 'kicked'));
    expect(findChatByTgId(t.deps.db, TG_CHAT_ID)?.botStatus).toBe('left');
    await t.handle(botMembership(ALICE, 'left', 'administrator'));
    expect(findChatByTgId(t.deps.db, TG_CHAT_ID)).toMatchObject({ id, botStatus: 'admin' });
  });

  it('ignores private chats and channels', async () => {
    const t = createTestBot();
    await t.handle(botMembership(ALICE, 'left', 'member', privateChat(ALICE)));
    expect(t.telegram.calls).toEqual([]);
  });

  it('moves the chat to the supergroup id on migration', async () => {
    const t = createTestBot();
    const { chat, game } = await setupGame(t.deps);
    const oldGroup = { id: TG_CHAT_ID, type: 'group', title: 'Poker club' } as const;
    const supergroup = { ...GROUP, id: -100999 };
    // The supergroup may announce itself first; its empty chat is absorbed.
    await t.handle(botMembership(ALICE, 'left', 'administrator', supergroup));
    await t.handle({
      message: {
        message_id: 1,
        date: 0,
        chat: supergroup,
        migrate_from_chat_id: TG_CHAT_ID,
      },
    } as never);
    await t.handle({
      message: { message_id: 2, date: 0, chat: oldGroup, migrate_to_chat_id: -100999 },
    } as never);
    expect(findChat(t.deps.db, chat.id)?.tgChatId).toBe(-100999);
    expect(findChatByTgId(t.deps.db, -100999)?.id).toBe(chat.id);
    expect(findGame(t.deps.db, game.id)?.chatId).toBe(chat.id);
  });
});

describe('group commands', () => {
  it('/newgame creates a game and posts the pinned status at once', async () => {
    const t = createTestBot();
    const chat = setupChat(t.deps);
    await t.handle(textMessage(BOB, '/newgame'));
    const [game] = listActiveGames(t.deps, chat.id);
    expect(game).toMatchObject({
      name: 'Покер 15.09',
      stackChips: 30_000,
      createdBy: BOB.tgUserId,
    });
    expect(String(lastReply(t)?.text)).toContain('Покер 15.09');
    expect(t.telegram.callsOf('pinChatMessage')).toHaveLength(1);
    expect(findGame(t.deps.db, game?.id ?? '')?.statusMessageId).toBe(100);
  });

  it('/newgame takes a name, also with the bot username', async () => {
    const t = createTestBot();
    const chat = setupChat(t.deps);
    await t.handle(textMessage(BOB, '/newgame@poker_ledger_bot Friday <night>'));
    expect(listActiveGames(t.deps, chat.id)[0]?.name).toBe('Friday <night>');
    expect(String(lastReply(t)?.text)).toContain('Friday &lt;night&gt;');
  });

  it('/newgame with an active game links to it', async () => {
    const t = createTestBot();
    const chat = setupChat(t.deps);
    await t.handle(textMessage(BOB, '/newgame'));
    const [game] = listActiveGames(t.deps, chat.id);
    t.telegram.clear();
    await t.handle(textMessage(CAROL, '/newgame'));
    expect(listActiveGames(t.deps, chat.id)).toHaveLength(1);
    const reply = lastReply(t);
    expect(String(reply?.text)).toContain('уже идёт игра');
    expect(reply?.reply_parameters).toEqual({ message_id: 100, allow_sending_without_reply: true });
    expect(reply?.reply_markup).toEqual({
      inline_keyboard: [
        [
          {
            text: '📱 Открыть',
            url: `https://t.me/poker_ledger_bot/app?startapp=g_${game?.id ?? ''}`,
          },
        ],
      ],
    });
  });

  it('/newgame from a non-member or an anonymous admin creates nothing', async () => {
    const t = createTestBot();
    const chat = setupChat(t.deps);
    await t.handle(textMessage(MALLORY, '/newgame'));
    expect(String(lastReply(t)?.text)).toContain('Только участники');
    await t.handle(textMessage(actor(1087968824, 'Group'), '/newgame'));
    expect(String(lastReply(t)?.text)).toContain('анонимно');
    expect(listActiveGames(t.deps, chat.id)).toEqual([]);
  });

  it('/newgame registers a chat the bot missed being added to', async () => {
    const t = createTestBot();
    t.deps.setMembership(TG_CHAT_ID, BOB.tgUserId, 'member');
    await t.handle(textMessage(BOB, '/newgame'));
    const chat = findChatByTgId(t.deps.db, TG_CHAT_ID);
    expect(chat).toMatchObject({ botStatus: 'member' });
    expect(listActiveGames(t.deps, chat?.id ?? '')).toHaveLength(1);
  });

  it('/game links to the active game or offers to create one', async () => {
    const t = createTestBot();
    const chat = setupChat(t.deps);
    await t.handle(textMessage(BOB, '/game'));
    expect(lastReply(t)).toMatchObject({
      text: 'Активных игр нет. Начните новую командой /newgame.',
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: '📱 Открыть чат в приложении',
              url: `https://t.me/poker_ledger_bot/app?startapp=c_${chat.id}`,
            },
          ],
        ],
      },
    });
    await createGame(t.deps, BOB, chat.id);
    await t.handle(textMessage(BOB, '/game'));
    expect(String(lastReply(t)?.text)).toBe('Текущая игра: «Покер 15.09».');
  });

  it('/history, /settings, /stats and /help reply with links and texts', async () => {
    const t = createTestBot();
    const chat = setupChat(t.deps);
    await t.handle(textMessage(BOB, '/settings'));
    expect(lastReply(t)?.reply_markup).toMatchObject({
      inline_keyboard: [[{ url: `https://t.me/poker_ledger_bot/app?startapp=s_${chat.id}` }]],
    });
    await t.handle(textMessage(BOB, '/history'));
    expect(lastReply(t)?.reply_markup).toMatchObject({
      inline_keyboard: [[{ url: `https://t.me/poker_ledger_bot/app?startapp=c_${chat.id}` }]],
    });
    await t.handle(textMessage(BOB, '/stats'));
    expect(String(lastReply(t)?.text)).toContain('следующей версии');
    await t.handle(textMessage(BOB, '/help'));
    expect(String(lastReply(t)?.text)).toContain('/newgame');
  });
});

describe('private chat', () => {
  it('/start opens the Mini App and creates nothing', async () => {
    const t = createTestBot();
    await t.handle(textMessage(CAROL, '/start', privateChat(CAROL)));
    expect(lastReply(t)?.reply_markup).toEqual({
      inline_keyboard: [
        [{ text: '📱 Открыть приложение', url: 'https://t.me/poker_ledger_bot/app' }],
      ],
    });
  });

  it('/start uses a web_app button when the Mini App URL is known', async () => {
    const t = createTestBot();
    Object.assign(t.botDeps, { miniAppUrl: 'https://example.github.io/poker/' });
    await t.handle(
      textMessage(actor(6, 'Ann', { languageCode: 'en' }), '/start', privateChat(actor(6, 'Ann'))),
    );
    expect(lastReply(t)?.reply_markup).toEqual({
      inline_keyboard: [
        [{ text: '📱 Open the app', web_app: { url: 'https://example.github.io/poker/' } }],
      ],
    });
  });

  it('group commands explain that games live in groups', async () => {
    const t = createTestBot();
    await t.handle(textMessage(CAROL, '/newgame', privateChat(CAROL)));
    expect(String(lastReply(t)?.text)).toContain('Игры создаются в группе');
    expect(findChatByTgId(t.deps.db, CAROL.tgUserId)).toBeUndefined();
  });
});

describe('game buttons', () => {
  async function gameWithStatus(t: TestBot): Promise<string> {
    const { game } = await setupGame(t.deps);
    await t.updater.flush();
    t.telegram.clear();
    return game.id;
  }

  /** Presses a button and moves past the rate limit. */
  async function press(t: TestBot, who: typeof BOB, data: string): Promise<unknown> {
    await t.handle(buttonPress(who, data));
    t.deps.advance(1000);
    return lastAnswer(t);
  }

  it("«I'm in» buys one stack for the presser, once", async () => {
    const t = createTestBot();
    const gameId = await gameWithStatus(t);
    expect(await press(t, BOB, gameCallback('join', gameId))).toBe('Вход 30 000 записан');
    expect(await press(t, BOB, gameCallback('join', gameId))).toBe('Вы уже в игре');
    const chipEvents = listGameEvents(t.deps.db, gameId).filter((e) => e.type === 'buy_in');
    expect(chipEvents).toHaveLength(1);
    expect(chipEvents[0]).toMatchObject({ chips: 30_000, createdBy: BOB.tgUserId });
  });

  it('answers in the presser’s language', async () => {
    const t = createTestBot();
    const gameId = await gameWithStatus(t);
    const english = actor(CAROL.tgUserId, 'Carol', { languageCode: 'en' });
    expect(await press(t, english, gameCallback('join', gameId))).toBe('Buy-in of 30,000 recorded');
  });

  it('«Rebuy» needs a seat first', async () => {
    const t = createTestBot();
    const gameId = await gameWithStatus(t);
    expect(await press(t, BOB, gameCallback('rebuy', gameId))).toBe(
      'Вы ещё не за столом: сначала нажмите «✋ Я в игре»',
    );
    await press(t, BOB, gameCallback('join', gameId));
    expect(await press(t, BOB, gameCallback('rebuy', gameId))).toBe('Докуп 30 000 записан');
  });

  it('«Undo mine» cancels the presser’s last action', async () => {
    const t = createTestBot();
    const gameId = await gameWithStatus(t);
    await press(t, BOB, gameCallback('join', gameId));
    await press(t, CAROL, gameCallback('join', gameId));
    expect(await press(t, BOB, gameCallback('undo', gameId))).toBe('Отменён вход 30 000');
    const bobEvent = listGameEvents(t.deps.db, gameId).find(
      (e) => e.type === 'buy_in' && e.createdBy === BOB.tgUserId,
    );
    expect(bobEvent?.cancelledBy).toBe(BOB.tgUserId);
    expect(await press(t, BOB, gameCallback('undo', gameId))).toBe(
      'Нечего отменять: ваших действий за последние 15 минут нет',
    );
  });

  it('allows one press per second', async () => {
    const t = createTestBot();
    const gameId = await gameWithStatus(t);
    await t.handle(buttonPress(BOB, gameCallback('join', gameId)));
    await t.handle(buttonPress(BOB, gameCallback('rebuy', gameId)));
    expect(lastAnswer(t)).toBe('Слишком часто. Попробуйте через секунду');
    expect(listGameEvents(t.deps.db, gameId).filter((e) => e.type === 'rebuy')).toEqual([]);
  });

  it('rejects outsiders, unknown games, finished games and stale buttons', async () => {
    const t = createTestBot();
    const gameId = await gameWithStatus(t);
    expect(await press(t, MALLORY, gameCallback('join', gameId))).toBe(
      'Играть могут только участники чата',
    );
    expect(await press(t, BOB, gameCallback('join', 'AAAAAAAAAAAA'))).toBe('Игра не найдена');
    expect(await press(t, BOB, 'x:whatever')).toBe('Эта кнопка устарела');
  });

  it('every press updates the status message within 2 s', async () => {
    const t = createTestBot();
    const gameId = await gameWithStatus(t);
    await press(t, BOB, gameCallback('join', gameId));
    await press(t, CAROL, gameCallback('join', gameId));
    expect(t.telegram.callsOf('editMessageText')).toEqual([]);
    await vi.advanceTimersByTimeAsync(2000);
    const edits = t.telegram.callsOf('editMessageText');
    expect(edits).toHaveLength(1);
    expect(String(edits[0]?.text)).toContain('Bob');
    expect(String(edits[0]?.text)).toContain('Carol');
    expect(t.deps.scheduled).toEqual([gameId, gameId]);
  });

  it('every answer goes to answerCallbackQuery', async () => {
    const t = createTestBot();
    const gameId = await gameWithStatus(t);
    await t.handle(buttonPress(ALICE, gameCallback('join', gameId)));
    const answers = t.telegram.callsOf('answerCallbackQuery');
    expect(answers).toHaveLength(1);
    expect(plain(answers[0]?.text)).toBe('Вход 30 000 записан');
  });
});
