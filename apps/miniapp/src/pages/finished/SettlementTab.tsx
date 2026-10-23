// Transfers of a finished game: view with payment details, manual editing.
import {
  checkManualSettlement,
  validateTransfers,
  type SettlementWarning,
} from '@pokerledger/core';
import type {
  GameStateResponse,
  PaymentDetailsResponse,
  SettlementResponse,
} from '@pokerledger/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useApi } from '../../api/apiContext';
import { isApiError } from '../../api/client';
import { queryKeys, useSettlement } from '../../api/queries';
import { Section } from '../../components/List';
import { NumberField } from '../../components/NumberField';
import { QueryView } from '../../components/Status';
import { useToast } from '../../components/toastContext';
import { useFormat } from '../../i18n/hooks';
import { useConfirm } from '../../telegram/nativeUi';
import { MainButton } from '../../telegram/TelegramUi';
import { playerNameOf } from '../game/events';
import { TransferItem } from './results';

export function SettlementTab({ game }: { game: GameStateResponse }) {
  const settlement = useSettlement(game.id, game.version);
  const [editing, setEditing] = useState(false);
  return (
    <QueryView query={settlement}>
      {(data) =>
        editing ? (
          <SettlementEditor
            game={game}
            settlement={data}
            onDone={() => {
              setEditing(false);
            }}
          />
        ) : (
          <SettlementView
            game={game}
            settlement={data}
            onEdit={() => {
              setEditing(true);
            }}
          />
        )
      }
    </QueryView>
  );
}

function WarningsPanel({
  game,
  warnings,
}: {
  game: GameStateResponse;
  warnings: readonly SettlementWarning[];
}) {
  const { t } = useTranslation();
  const format = useFormat();
  if (warnings.length === 0) return null;
  const expected = new Map(game.players.map((p) => [p.playerId, p.moneyResult ?? 0]));
  return (
    <div className="notice" role="alert">
      <p>{t('settlement.warnings')}</p>
      <ul className="warning-list">
        {warnings.map((w) => (
          <li key={`${w.code}-${w.playerId}`}>
            {w.code === 'BALANCE_MISMATCH'
              ? t('settlement.balance', {
                  name: playerNameOf(game, w.playerId),
                  actual: format.signedMoney(
                    (expected.get(w.playerId) ?? 0) + w.delta,
                    game.currency,
                  ),
                  expected: format.signedMoney(expected.get(w.playerId) ?? 0, game.currency),
                })
              : t('settlement.unknownPlayer')}
          </li>
        ))}
      </ul>
    </div>
  );
}

function PaymentDetails({ details }: { details: PaymentDetailsResponse }) {
  const { t } = useTranslation();
  const toast = useToast();
  const copy = (text: string) => {
    const clipboard = navigator.clipboard as Clipboard | undefined;
    (clipboard ? clipboard.writeText(text) : Promise.reject(new Error('No clipboard API'))).then(
      () => {
        toast.info(t('settlement.copied'));
      },
      () => {
        toast.errorText(t('settlement.copyFailed'));
      },
    );
  };
  const lines = [
    ['phone', details.phone],
    ['bank', details.bank],
    ['note', details.note],
  ] as const;
  return (
    <dl className="payment">
      {lines.map(([key, value]) =>
        value === null || value === '' ? null : (
          <div key={key} className="payment-line">
            <dt>{t(`settlement.${key}`)}</dt>
            <dd>{value}</dd>
            <button
              type="button"
              className="link-button"
              aria-label={t('settlement.copyLabel', { what: value })}
              onClick={() => {
                copy(value);
              }}
            >
              {t('settlement.copy')}
            </button>
          </div>
        ),
      )}
    </dl>
  );
}

function SettlementView({
  game,
  settlement,
  onEdit,
}: {
  game: GameStateResponse;
  settlement: SettlementResponse;
  onEdit: () => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      {settlement.isManual ? <p className="hint">{t('settlement.manual')}</p> : null}
      <WarningsPanel game={game} warnings={settlement.warnings} />
      <Section>
        {settlement.transfers.length === 0 ? (
          <p className="hint">{t('settlement.none')}</p>
        ) : (
          settlement.transfers.map((transfer, index) => (
            <TransferItem key={index} game={game} transfer={transfer}>
              {transfer.recipientPayment ? (
                <PaymentDetails details={transfer.recipientPayment} />
              ) : null}
            </TransferItem>
          ))
        )}
      </Section>
      {game.permissions.canEditSettlement ? (
        <button type="button" className="button button-wide" onClick={onEdit}>
          {t('settlement.edit')}
        </button>
      ) : null}
    </>
  );
}

interface DraftTransfer {
  /** Stable React key: rows can be removed from the middle. */
  readonly key: number;
  readonly from: string;
  readonly to: string;
  readonly amount: number | null;
}

let nextKey = 1;

function draftOf(settlement: SettlementResponse): DraftTransfer[] {
  return settlement.transfers.map((t) => ({
    key: nextKey++,
    from: t.from,
    to: t.to,
    amount: t.amount,
  }));
}

/**
 * Free editing: balance mismatches are warnings recomputed by core on every change; only
 * empty or non-positive amounts and self-transfers block saving.
 */
function SettlementEditor({
  game,
  settlement,
  onDone,
}: {
  game: GameStateResponse;
  settlement: SettlementResponse;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const api = useApi();
  const toast = useToast();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const [rows, setRows] = useState(() => draftOf(settlement));
  const [changed, setChanged] = useState(false);
  // The version the edit started from: a newer one seen by polling must still conflict.
  const [baseVersion, setBaseVersion] = useState(settlement.version);
  const [busy, setBusy] = useState(false);

  const players = game.players.filter((p) => p.moneyResult !== null);
  const transfers = rows.map((r) => ({ from: r.from, to: r.to, amount: r.amount ?? 0 }));
  const warnings = checkManualSettlement(
    transfers,
    players.map((p) => ({ playerId: p.playerId, money: p.moneyResult ?? 0 })),
  );
  const errors = validateTransfers(transfers);
  const errorsOf = (index: number) => errors.filter((e) => e.index === index);

  const update = (key: number, patch: Partial<Omit<DraftTransfer, 'key'>>) => {
    setRows((current) => current.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    setChanged(true);
  };

  const finish = (fresh: SettlementResponse) => {
    queryClient.setQueryData(queryKeys.settlement(game.id, fresh.version), fresh);
    void queryClient.invalidateQueries({ queryKey: queryKeys.game(game.id), exact: true });
    void queryClient.invalidateQueries({ queryKey: queryKeys.log(game.id) });
    onDone();
  };
  const fail = (error: unknown) => {
    setBusy(false);
    toast.error(error);
    if (isApiError(error, 'CONFLICT')) {
      // Keep the draft, warnings are recomputed against the fresh results.
      void queryClient
        .fetchQuery({ queryKey: queryKeys.game(game.id), queryFn: () => api.game(game.id) })
        .then((fresh) => {
          setBaseVersion(fresh.version);
        });
    }
  };

  const save = () => {
    setBusy(true);
    api
      .saveSettlement(game.id, { transfers, expectedVersion: baseVersion })
      .then((fresh) => {
        toast.info(
          fresh.warnings.length > 0 ? t('settlement.savedWithWarnings') : t('settlement.saved'),
        );
        finish(fresh);
      })
      .catch(fail);
  };

  const reset = async () => {
    const ok = await confirm({
      message: t('settlement.resetConfirm'),
      ok: t('settlement.resetOk'),
    });
    if (!ok) return;
    setBusy(true);
    api
      .resetSettlement(game.id, baseVersion)
      .then((fresh) => {
        toast.info(t('settlement.resetDone'));
        finish(fresh);
      })
      .catch(fail);
  };

  const cancel = async () => {
    if (changed) {
      const ok = await confirm({
        message: t('settlement.discardConfirm'),
        ok: t('settlement.discardOk'),
      });
      if (!ok) return;
    }
    onDone();
  };

  const firstPlayer = players[0]?.playerId ?? '';
  const secondPlayer = players[1]?.playerId ?? firstPlayer;

  return (
    <>
      <WarningsPanel game={game} warnings={warnings} />
      {rows.map((row, index) => {
        const rowErrors = errorsOf(index);
        const label = `${playerNameOf(game, row.from)} → ${playerNameOf(game, row.to)}`;
        return (
          <section
            key={row.key}
            className={rowErrors.length > 0 ? 'transfer-edit transfer-invalid' : 'transfer-edit'}
            aria-label={label}
          >
            <div className="transfer-edit-players">
              {(['from', 'to'] as const).map((side) => (
                <label key={side} className="field">
                  <span className="field-label">{t(`settlement.${side}`)}</span>
                  <select
                    className="input"
                    value={row[side]}
                    onChange={(event) => {
                      const value = event.target.value;
                      update(row.key, side === 'from' ? { from: value } : { to: value });
                    }}
                  >
                    {players.map((p) => (
                      <option key={p.playerId} value={p.playerId}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <NumberField
              label={t('settlement.amount', { currency: game.currency })}
              value={row.amount}
              onChange={(amount) => {
                update(row.key, { amount });
              }}
            />
            {rowErrors.map((e) => (
              <p key={e.code} className="field-error" role="alert">
                {e.code === 'SELF_TRANSFER'
                  ? t('settlement.selfTransfer')
                  : t('settlement.badAmount')}
              </p>
            ))}
            <button
              type="button"
              className="button button-destructive"
              onClick={() => {
                setRows((current) => current.filter((r) => r.key !== row.key));
                setChanged(true);
              }}
            >
              {t('settlement.remove')}
            </button>
          </section>
        );
      })}
      <button
        type="button"
        className="button button-wide"
        disabled={players.length < 2}
        onClick={() => {
          setRows((current) => [
            ...current,
            { key: nextKey++, from: firstPlayer, to: secondPlayer, amount: null },
          ]);
          setChanged(true);
        }}
      >
        {t('settlement.add')}
      </button>
      <button
        type="button"
        className="button button-wide"
        disabled={busy}
        onClick={() => void reset()}
      >
        {t('settlement.reset')}
      </button>
      <button type="button" className="button button-wide" onClick={() => void cancel()}>
        {t('settlement.cancelEdit')}
      </button>
      <MainButton
        text={t('settlement.save')}
        disabled={errors.length > 0}
        loading={busy}
        onClick={save}
      />
    </>
  );
}
