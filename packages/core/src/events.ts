import { CoreError, assertSafeInt, type Result } from './errors';
import type { ChipEventType, CoreEvent, CorePlayer } from './types';

/** Player status at the table (V1-PLAY-07). */
export type PlayerStatus = 'not_joined' | 'seated' | 'left';

/** Per-player totals over non-cancelled events (SPEC §8.1). */
export interface PlayerTotals {
  readonly playerId: string;
  readonly seatOrder: number;
  /** Chips bought: sum of `buy_in` and `rebuy`. */
  readonly in: number;
  /** Chips taken off the table: sum of `cash_out`. */
  readonly out: number;
  readonly buyinCount: number;
  readonly rebuyCount: number;
  readonly status: PlayerStatus;
}

/** Game summary (V1-PLAY-06). */
export interface GameSummary {
  /** Chips issued in total, `IN`. */
  readonly issuedChips: number;
  /** Chips taken by players who left, `OUT`. */
  readonly cashedOutChips: number;
  /** Chips expected on the table: issued − cashed out. */
  readonly expectedOnTable: number;
  readonly seatedCount: number;
}

/** Why an event makes the sequence invalid. */
export type SequenceViolation =
  'UNKNOWN_PLAYER' | 'ALREADY_SEATED' | 'NOT_SEATED' | 'INVALID_CHIPS';

export interface SequenceError {
  readonly code: 'INVALID_EVENT_SEQUENCE';
  /** The first event that is invalid in the sequence. */
  readonly eventId: number;
  readonly reason: SequenceViolation;
}

export type CancelError =
  | { readonly code: 'EVENT_NOT_FOUND' }
  | { readonly code: 'EVENT_ALREADY_CANCELLED' }
  | { readonly code: 'EVENT_NOT_CANCELLABLE' }
  | {
      readonly code: 'INVALID_EVENT_SEQUENCE';
      /** The event that has to be cancelled first (V1-LOG-04). */
      readonly blockingEventId: number;
    };

/** A new chip event that is about to be recorded. */
export interface NewChipEvent {
  readonly playerId: string;
  readonly type: ChipEventType;
  readonly chips: number;
}

interface MutableTotals {
  in: number;
  out: number;
  buyinCount: number;
  rebuyCount: number;
  status: PlayerStatus;
}

function isChipEvent(event: CoreEvent): event is CoreEvent & { type: ChipEventType } {
  return event.type === 'buy_in' || event.type === 'rebuy' || event.type === 'cash_out';
}

function sortedById(events: readonly CoreEvent[]): CoreEvent[] {
  return [...events].sort((a, b) => a.id - b.id);
}

/**
 * Replays non-cancelled chip events in `id` order. Stops at the first invalid
 * event and reports it; totals are complete only when `error` is undefined.
 */
function replay(
  players: readonly CorePlayer[],
  events: readonly CoreEvent[],
): { totals: Map<string, MutableTotals>; error?: SequenceError } {
  const totals = new Map<string, MutableTotals>();
  for (const player of players) {
    assertSafeInt(player.seatOrder, 'seatOrder');
    totals.set(player.id, { in: 0, out: 0, buyinCount: 0, rebuyCount: 0, status: 'not_joined' });
  }

  for (const event of sortedById(events)) {
    if (event.cancelled || !isChipEvent(event)) {
      continue;
    }
    const fail = (reason: SequenceViolation) => ({
      totals,
      error: { code: 'INVALID_EVENT_SEQUENCE' as const, eventId: event.id, reason },
    });

    const player = event.playerId === null ? undefined : totals.get(event.playerId);
    if (!player) {
      return fail('UNKNOWN_PLAYER');
    }
    const chips = event.chips;
    const minChips = event.type === 'cash_out' ? 0 : 1;
    if (chips === null || !Number.isSafeInteger(chips) || chips < minChips) {
      return fail('INVALID_CHIPS');
    }

    const seated = player.status === 'seated';
    switch (event.type) {
      case 'buy_in':
        if (seated) {
          return fail('ALREADY_SEATED');
        }
        player.in += chips;
        player.buyinCount += 1;
        player.status = 'seated';
        break;
      case 'rebuy':
        if (!seated) {
          return fail('NOT_SEATED');
        }
        player.in += chips;
        player.rebuyCount += 1;
        break;
      case 'cash_out':
        if (!seated) {
          return fail('NOT_SEATED');
        }
        player.out += chips;
        player.status = 'left';
        break;
    }
    assertSafeInt(player.in, 'in');
    assertSafeInt(player.out, 'out');
  }
  return { totals };
}

/**
 * Checks the order of non-cancelled chip events: `buy_in` only for a player who
 * is not seated, `rebuy` and `cash_out` only for a seated one, chips > 0 for
 * purchases and ≥ 0 for a cash-out, and the player belongs to the game.
 */
export function validateEventSequence(
  players: readonly CorePlayer[],
  events: readonly CoreEvent[],
): Result<void, SequenceError> {
  const { error } = replay(players, events);
  return error ? { ok: false, error } : { ok: true, value: undefined };
}

/** Checks that `event` can be appended after `events`. */
export function validateNewEvent(
  players: readonly CorePlayer[],
  events: readonly CoreEvent[],
  event: NewChipEvent,
): Result<void, SequenceError> {
  const nextId = events.reduce((max, e) => Math.max(max, e.id), 0) + 1;
  return validateEventSequence(players, [...events, { ...event, id: nextId, cancelled: false }]);
}

/**
 * Per-player totals over non-cancelled events (SPEC §8.1), in the order of `players`.
 * Throws `CoreError` if the event sequence is invalid: stored sequences are
 * always validated before they are written.
 */
export function computePlayerTotals(
  players: readonly CorePlayer[],
  events: readonly CoreEvent[],
): PlayerTotals[] {
  const { totals, error } = replay(players, events);
  if (error) {
    throw new CoreError(
      `Invalid event sequence at event ${String(error.eventId)}: ${error.reason}`,
    );
  }
  return players.map((player) => {
    const t = totals.get(player.id) as MutableTotals;
    return { playerId: player.id, seatOrder: player.seatOrder, ...t };
  });
}

/** Game summary from player totals (V1-PLAY-06). */
export function computeSummary(totals: readonly PlayerTotals[]): GameSummary {
  let issuedChips = 0;
  let cashedOutChips = 0;
  let seatedCount = 0;
  for (const t of totals) {
    issuedChips += t.in;
    cashedOutChips += t.out;
    if (t.status === 'seated') {
      seatedCount += 1;
    }
  }
  assertSafeInt(issuedChips, 'issuedChips');
  assertSafeInt(cashedOutChips, 'cashedOutChips');
  return {
    issuedChips,
    cashedOutChips,
    expectedOnTable: issuedChips - cashedOutChips,
    seatedCount,
  };
}

/**
 * Infers the purchase type (V1-PLAY-05): `rebuy` if the player is seated now,
 * otherwise `buy_in`.
 */
export function inferBuyType(
  players: readonly CorePlayer[],
  events: readonly CoreEvent[],
  playerId: string,
): 'buy_in' | 'rebuy' {
  const totals = computePlayerTotals(players, events);
  const player = totals.find((t) => t.playerId === playerId);
  if (!player) {
    throw new CoreError(`Player ${playerId} is not in the game`);
  }
  return player.status === 'seated' ? 'rebuy' : 'buy_in';
}

/**
 * Checks whether a chip event can be cancelled (V1-LOG-04). If cancelling it would
 * make the sequence invalid, returns the first event that breaks: it has to be
 * cancelled first. Non-chip events are not cancellable here.
 */
export function canCancelEvent(
  players: readonly CorePlayer[],
  events: readonly CoreEvent[],
  eventId: number,
): Result<void, CancelError> {
  const target = events.find((e) => e.id === eventId);
  if (!target) {
    return { ok: false, error: { code: 'EVENT_NOT_FOUND' } };
  }
  if (target.cancelled) {
    return { ok: false, error: { code: 'EVENT_ALREADY_CANCELLED' } };
  }
  if (!isChipEvent(target)) {
    return { ok: false, error: { code: 'EVENT_NOT_CANCELLABLE' } };
  }
  const after = events.map((e) => (e.id === eventId ? { ...e, cancelled: true } : e));
  const { error } = replay(players, after);
  if (error) {
    return {
      ok: false,
      error: { code: 'INVALID_EVENT_SEQUENCE', blockingEventId: error.eventId },
    };
  }
  return { ok: true, value: undefined };
}
