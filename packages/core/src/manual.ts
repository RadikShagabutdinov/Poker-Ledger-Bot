import type { Transfer } from './types';

/** Final money result of a player, used to check a settlement against. */
export interface MoneyResult {
  readonly playerId: string;
  readonly money: number;
}

/** Soft problems of a manual settlement: shown, but saving is allowed (V1-SETL-04). */
export type SettlementWarning =
  | {
      readonly code: 'BALANCE_MISMATCH';
      readonly playerId: string;
      /** `(received − paid) − money`. */
      readonly delta: number;
    }
  | { readonly code: 'UNKNOWN_PLAYER'; readonly playerId: string };

/** Hard errors: the API rejects such transfers (V1-SETL-05). */
export interface TransferError {
  readonly index: number;
  readonly code: 'INVALID_AMOUNT' | 'NON_POSITIVE_AMOUNT' | 'SELF_TRANSFER';
}

/**
 * Checks a (possibly manual) settlement against the results (SPEC §8.4): for each
 * player `delta = (received − paid) − money`, every non-zero delta is a warning.
 * Players in transfers that are not in `results` are reported as `UNKNOWN_PLAYER`.
 * Warnings follow the order of `results`, then unknown players by first appearance.
 */
export function checkManualSettlement(
  transfers: readonly Transfer[],
  results: readonly MoneyResult[],
): SettlementWarning[] {
  const net = new Map<string, number>(results.map((r) => [r.playerId, 0]));
  const unknown = new Set<string>();
  const credit = (playerId: string, amount: number) => {
    const current = net.get(playerId);
    if (current === undefined) {
      unknown.add(playerId);
    } else {
      net.set(playerId, current + amount);
    }
  };
  for (const t of transfers) {
    credit(t.from, -t.amount);
    credit(t.to, t.amount);
  }

  const warnings: SettlementWarning[] = [];
  for (const r of results) {
    const delta = (net.get(r.playerId) as number) - r.money;
    if (delta !== 0) {
      warnings.push({ code: 'BALANCE_MISMATCH', playerId: r.playerId, delta });
    }
  }
  for (const playerId of unknown) {
    warnings.push({ code: 'UNKNOWN_PLAYER', playerId });
  }
  return warnings;
}

/**
 * Hard validation of transfers (V1-SETL-05): the amount must be a positive safe
 * integer and payer and receiver must differ. Returns one error per bad field.
 */
export function validateTransfers(transfers: readonly Transfer[]): TransferError[] {
  const errors: TransferError[] = [];
  transfers.forEach((t, index) => {
    if (!Number.isSafeInteger(t.amount)) {
      errors.push({ index, code: 'INVALID_AMOUNT' });
    } else if (t.amount <= 0) {
      errors.push({ index, code: 'NON_POSITIVE_AMOUNT' });
    }
    if (t.from === t.to) {
      errors.push({ index, code: 'SELF_TRANSFER' });
    }
  });
  return errors;
}
