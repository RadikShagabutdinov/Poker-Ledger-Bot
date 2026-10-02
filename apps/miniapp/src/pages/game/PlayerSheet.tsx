// Player actions: buy chips, leave the table, undo.
import { chipsToMoneyRounded } from '@pokerledger/core';
import type { GameStateResponse } from '@pokerledger/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useApi } from '../../api/apiContext';
import { useChat, useGameLog, useGameMutation } from '../../api/queries';
import { BottomSheet } from '../../components/BottomSheet';
import { Section } from '../../components/List';
import { NumberField } from '../../components/NumberField';
import { useToast } from '../../components/toastContext';
import { useFormat } from '../../i18n/hooks';
import { useConfirm } from '../../telegram/nativeUi';
import { describeEntry, isChipEvent } from './events';

/** Chat default while the chat settings load or if they cannot be read. */
const DEFAULT_QUICK_BUYINS = [1, 0.5];
const FRACTIONS: Record<number, string> = { 0.25: '¼', 0.5: '½', 0.75: '¾' };

export function PlayerSheet({
  game,
  playerId,
  onClose,
}: {
  game: GameStateResponse;
  playerId: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const format = useFormat();
  const api = useApi();
  const toast = useToast();
  const confirm = useConfirm();
  const chat = useChat(game.chatId);
  const log = useGameLog(game.id);
  const [buyChips, setBuyChips] = useState<number | null>(null);
  const [outChips, setOutChips] = useState<number | null>(null);

  const record = useGameMutation(game.id, (body: { type: 'buy' | 'cash_out'; chips: number }) =>
    api.addEvent(game.id, { ...body, playerId }),
  );
  const cancel = useGameMutation(game.id, (eventId: number) => api.cancelEvent(game.id, eventId));

  const player = game.players.find((p) => p.playerId === playerId);
  if (!player) return null;

  const money = (chips: number) =>
    format.money(chipsToMoneyRounded(chips, game.stack), game.currency);
  const busy = record.isPending || cancel.isPending;

  const submit = (type: 'buy' | 'cash_out', chips: number) => {
    record.mutate(
      { type, chips },
      {
        onSuccess: ({ event }) => {
          const amount = format.number(chips);
          toast.info(
            event?.type === 'cash_out'
              ? t('player.recordedCashOut', { chips: amount })
              : event?.type === 'rebuy'
                ? t('player.recordedRebuy', { chips: amount })
                : t('player.recordedBuyIn', { chips: amount }),
          );
          onClose();
        },
        onError: toast.error,
      },
    );
  };

  const lastEvent = log.data?.entries.findLast(
    (e) => e.playerId === playerId && isChipEvent(e) && e.cancelled === null,
  );
  const undoLast = async () => {
    if (!lastEvent) return;
    const what = describeEntry(t, format, lastEvent, game.currency);
    const ok = await confirm({ message: t('player.undoConfirm', { what }), ok: t('log.cancelOk') });
    if (!ok) return;
    cancel.mutate(lastEvent.id, {
      onSuccess: () => {
        toast.info(t('log.cancelledToast', { what }));
        onClose();
      },
      onError: toast.error,
    });
  };

  const quickBuyins = (chat.data?.quickBuyins ?? DEFAULT_QUICK_BUYINS)
    .map((fraction) => ({ fraction, chips: Math.round(fraction * game.stack.chips) }))
    .filter((q) => q.chips > 0);
  const stackLabel = (fraction: number) =>
    fraction === 1
      ? t('player.fullStack')
      : t('player.stacks', {
          fraction: FRACTIONS[fraction] ?? format.number(fraction),
        });
  const preliminary =
    outChips === null
      ? null
      : chipsToMoneyRounded(player.outChips + outChips - player.inChips, game.stack);

  return (
    <BottomSheet open onClose={onClose} title={player.name}>
      <Section title={t('player.buy')}>
        <div className="quick-buttons">
          {quickBuyins.map((q) => (
            <button
              key={q.fraction}
              type="button"
              className="button"
              disabled={busy}
              onClick={() => {
                submit('buy', q.chips);
              }}
            >
              <span>{stackLabel(q.fraction)}</span>
              <span className="button-sub">{format.number(q.chips)}</span>
            </button>
          ))}
        </div>
        <NumberField
          label={t('player.custom')}
          value={buyChips}
          onChange={setBuyChips}
          {...(buyChips !== null && buyChips > 0
            ? { hint: t('player.equivalent', { money: money(buyChips) }) }
            : {})}
        />
        <button
          type="button"
          className="button button-primary button-wide"
          disabled={busy || buyChips === null || buyChips <= 0}
          onClick={() => {
            if (buyChips !== null) submit('buy', buyChips);
          }}
        >
          {t('player.buySubmit', { chips: buyChips !== null ? format.number(buyChips) : '' })}
        </button>
      </Section>

      {player.status === 'seated' ? (
        <Section title={t('player.cashOut')}>
          <NumberField
            label={t('player.cashOutChips')}
            value={outChips}
            onChange={setOutChips}
            {...(preliminary !== null
              ? {
                  hint: t('player.preliminary', {
                    money: format.signedMoney(preliminary, game.currency),
                  }),
                }
              : {})}
          />
          <button
            type="button"
            className="button button-wide"
            disabled={busy || outChips === null}
            onClick={() => {
              if (outChips !== null) submit('cash_out', outChips);
            }}
          >
            {t('player.cashOutSubmit')}
          </button>
        </Section>
      ) : null}

      <button
        type="button"
        className="button button-wide button-destructive"
        disabled={busy || !lastEvent}
        onClick={() => void undoLast()}
      >
        {t('player.undo')}
      </button>
      {log.data && !lastEvent ? <p className="hint">{t('player.nothingToUndo')}</p> : null}
    </BottomSheet>
  );
}
