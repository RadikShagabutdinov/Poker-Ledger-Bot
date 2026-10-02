import {
  addGuestBodySchema,
  chatSettingsPatchSchema,
  createGameBodySchema,
  historyQuerySchema,
  renamePlayerBodySchema,
} from '@pokerledger/shared';
import { Hono } from 'hono';

import {
  addGuest,
  createGame,
  getChat,
  getGameState,
  listGames,
  listPlayers,
  renamePlayer,
  updateChatSettings,
  type ServiceDeps,
} from '../../services';
import type { AppEnv } from '../env';
import { param, readJson, readQuery } from '../validate';

/** Chats, players and history: chat members. */
export function chatRoutes(services: ServiceDeps): Hono<AppEnv> {
  return new Hono<AppEnv>()
    .get('/chats/:chatId', async (c) =>
      c.json(await getChat(services, c.var.actor, param(c, 'chatId'))),
    )
    .patch('/chats/:chatId/settings', async (c) => {
      const patch = await readJson(c, chatSettingsPatchSchema);
      return c.json(await updateChatSettings(services, c.var.actor, param(c, 'chatId'), patch));
    })
    .get('/chats/:chatId/players', async (c) => {
      const players = await listPlayers(services, c.var.actor, param(c, 'chatId'));
      return c.json({ players });
    })
    .post('/chats/:chatId/players', async (c) => {
      const { name } = await readJson(c, addGuestBodySchema);
      return c.json(await addGuest(services, c.var.actor, param(c, 'chatId'), name), 201);
    })
    .patch('/chats/:chatId/players/:playerId', async (c) => {
      const { name } = await readJson(c, renamePlayerBodySchema);
      return c.json(
        await renamePlayer(services, c.var.actor, param(c, 'chatId'), param(c, 'playerId'), name),
      );
    })
    .get('/chats/:chatId/games', async (c) => {
      const query = readQuery(c, historyQuerySchema);
      return c.json(await listGames(services, c.var.actor, param(c, 'chatId'), query));
    })
    .post('/chats/:chatId/games', async (c) => {
      const body = await readJson(c, createGameBodySchema);
      const game = await createGame(services, c.var.actor, param(c, 'chatId'), {
        name: body.name,
        type: body.type,
        stack:
          body.stackChips === undefined && body.stackAmount === undefined
            ? undefined
            : // A missing half fails the stack validation in the service.
              { chips: body.stackChips ?? Number.NaN, amount: body.stackAmount ?? Number.NaN },
      });
      return c.json({ game: await getGameState(services, c.var.actor, game.id) }, 201);
    });
}
