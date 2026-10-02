// Human-readable game events for the log, toasts and confirmations.
import type { GameLogResponse, GameStateResponse } from '@pokerledger/shared';
import type { TFunction } from 'i18next';

import type { useFormat } from '../../i18n/hooks';

export type LogEntry = GameLogResponse['entries'][number];
type Format = ReturnType<typeof useFormat>;

const CHIP_EVENTS = new Set(['buy_in', 'rebuy', 'cash_out']);
const KNOWN_EVENTS = new Set([
  'game_created',
  'player_added',
  'buy_in',
  'rebuy',
  'cash_out',
  'settings_changed',
  'game_finished',
  'game_reopened',
  'game_deleted',
  'settlement_edited',
]);

export function isChipEvent(entry: { type: string }): boolean {
  return CHIP_EVENTS.has(entry.type);
}

/** `Вася: докуп 30 000`. */
export function describeChipEvent(
  t: TFunction,
  format: Format,
  event: { type: 'buy_in' | 'rebuy' | 'cash_out'; chips: number; playerName: string },
): string {
  return t(`log.event.${event.type}`, {
    player: event.playerName,
    chips: format.number(event.chips),
  });
}

export function playerNameOf(game: GameStateResponse, playerId: string): string {
  return game.players.find((p) => p.playerId === playerId)?.name ?? '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function describeSettings(t: TFunction, format: Format, entry: LogEntry, currency: string) {
  const parts: string[] = [];
  const name = entry.payload?.name;
  if (isRecord(name) && typeof name.to === 'string') {
    parts.push(t('log.renamed', { name: name.to }));
  }
  const stack = entry.payload?.stack;
  if (isRecord(stack) && isRecord(stack.to)) {
    const { chips, amount } = stack.to;
    if (typeof chips === 'number' && typeof amount === 'number') {
      parts.push(
        t('log.stackChanged', {
          chips: format.number(chips),
          amount: format.money(amount, currency),
        }),
      );
    }
  }
  return parts.length > 0 ? parts.join('; ') : t('log.event.settings_changed');
}

export function describeEntry(
  t: TFunction,
  format: Format,
  entry: LogEntry,
  currency: string,
): string {
  const player = entry.playerName ?? '';
  if (entry.type === 'settings_changed') {
    return describeSettings(t, format, entry, currency);
  }
  if (!KNOWN_EVENTS.has(entry.type)) {
    return t('log.event.other', { type: entry.type });
  }
  return t(`log.event.${entry.type}` as 'log.event.buy_in', {
    player,
    chips: format.number(entry.chips ?? 0),
  });
}
