import { profilePatchSchema } from '@pokerledger/shared';
import { Hono } from 'hono';

import { getProfile, listMyChats, updateProfile, type ServiceDeps } from '../../services';
import type { AppEnv } from '../env';
import { readJson } from '../validate';

/** Profile: only the user themselves. */
export function meRoutes(services: ServiceDeps): Hono<AppEnv> {
  return new Hono<AppEnv>()
    .get('/me', (c) => c.json(getProfile(services, c.var.actor)))
    .patch('/me', async (c) => {
      const patch = await readJson(c, profilePatchSchema);
      return c.json(updateProfile(services, c.var.actor, patch));
    })
    .get('/me/chats', (c) => c.json({ chats: listMyChats(services, c.var.actor) }));
}
