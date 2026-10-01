// Helpers for tests only; not exported from the package.
import type { ChipEventType, CoreEvent, CorePlayer } from './types';

export function seat(...ids: string[]): CorePlayer[] {
  return ids.map((id, i) => ({ id, seatOrder: i + 1 }));
}

/** Builds events with ids 1, 2, … from `[playerId, type, chips]` tuples. */
export function log(...items: [string, ChipEventType, number][]): CoreEvent[] {
  return items.map(([playerId, type, chips], i) => ({
    id: i + 1,
    playerId,
    type,
    chips,
    cancelled: false,
  }));
}
