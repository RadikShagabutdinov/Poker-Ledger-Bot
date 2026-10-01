import { describe, expect, it } from 'vitest';

import { describeServer, startDatabase } from './main';

describe('server smoke', () => {
  it('imports workspace packages', () => {
    expect(describeServer()).toContain('@pokerledger/core');
    expect(describeServer()).toContain('@pokerledger/shared');
  });

  it('applies migrations on a clean database', () => {
    const database = startDatabase(':memory:');
    const tables = (
      database.sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all() as { name: string }[]
    ).map((row) => row.name);
    expect(tables).toEqual(
      expect.arrayContaining([
        'chat_players',
        'chats',
        'game_events',
        'game_players',
        'game_results',
        'games',
        'link_tokens',
        'settlements',
        'users',
      ]),
    );
    expect(database.sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
    database.close();
  });
});
