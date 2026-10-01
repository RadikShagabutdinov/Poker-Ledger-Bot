/** All game event types (SPEC §10 `game_events.type`), including V2 ones. */
export type GameEventType =
  | 'game_created'
  | 'player_added'
  | 'buy_in'
  | 'rebuy'
  | 'cash_out'
  | 'settings_changed'
  | 'game_finished'
  | 'game_reopened'
  | 'game_deleted'
  | 'settlement_edited'
  // V2 (tournaments)
  | 'reentry'
  | 'tournament_rebuy'
  | 'addon'
  | 'bust'
  | 'places_set';

/** Chip event types that cash-game calculations take into account. */
export type ChipEventType = 'buy_in' | 'rebuy' | 'cash_out';

/** A player of one game, as needed for calculations. */
export interface CorePlayer {
  readonly id: string;
  /** Order of joining the game; the smaller value wins deterministic tie-breaks. */
  readonly seatOrder: number;
}

/**
 * A game event as needed for calculations. Events are processed in ascending `id`
 * order. Types other than `buy_in` / `rebuy` / `cash_out` are ignored.
 */
export interface CoreEvent {
  readonly id: number;
  readonly playerId: string | null;
  readonly type: GameEventType;
  readonly chips: number | null;
  readonly cancelled: boolean;
}

/** Stack value of a game: `chips` chips cost `amount` currency units. Both > 0. */
export interface Stack {
  readonly chips: number;
  readonly amount: number;
}

/** How the chip mismatch `D = OUT − IN` is distributed (V1-FIN-04). */
export type MismatchMode =
  { readonly mode: 'proportional' } | { readonly mode: 'single_player'; readonly playerId: string };

/** A money transfer between two players, `amount > 0`. */
export interface Transfer {
  readonly from: string;
  readonly to: string;
  readonly amount: number;
}
