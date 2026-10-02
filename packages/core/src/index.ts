// Pure calculation functions for games (SPEC §8). No DB, bot or HTTP dependencies.
export const CORE_PACKAGE = '@pokerledger/core';

export { CoreError, assertSafeInt, type Result } from './errors';
export {
  ZERO,
  add,
  cmp,
  div,
  floor,
  fromInt,
  isZero,
  mul,
  rat,
  sub,
  toSafeInt,
  type Rational,
} from './rational';
export type {
  ChipEventType,
  CoreEvent,
  CorePlayer,
  GameEventType,
  MismatchMode,
  Stack,
  Transfer,
} from './types';
export {
  canCancelEvent,
  computePlayerTotals,
  computeSummary,
  inferBuyType,
  validateEventSequence,
  validateNewEvent,
  type CancelError,
  type GameSummary,
  type NewChipEvent,
  type PlayerStatus,
  type PlayerTotals,
  type SequenceError,
  type SequenceViolation,
} from './events';
export {
  assertValidStack,
  chipsToMoney,
  chipsToMoneyRounded,
  computeChipResults,
  type ChipResults,
  type PlayerChipResult,
} from './mismatch';
export { roundLargestRemainder } from './rounding';
export { EXACT_SETTLEMENT_MAX_PLAYERS, computeSettlement, type Balance } from './settlement';
export {
  checkManualSettlement,
  validateTransfers,
  type MoneyResult,
  type SettlementWarning,
  type TransferError,
} from './manual';
export {
  computeCashGameResult,
  type CashGameError,
  type CashGameInput,
  type CashGamePlayerResult,
  type CashGameResult,
} from './cashGame';
