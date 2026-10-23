// Finishing a game: counted chips, reconciliation, mismatch adjustment, preview, finish.
import { add, chipsToMoneyRounded, fromInt, rat, type MismatchMode } from '@pokerledger/core';
import type { FinishPreviewBody, GameStateResponse } from '@pokerledger/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useNavigate, useParams } from 'react-router';

import { useApi } from '../../api/apiContext';
import { isApiError } from '../../api/client';
import { queryKeys, useFinishPreview, useGame } from '../../api/queries';
import { ListItem, Section } from '../../components/List';
import { NumberField } from '../../components/NumberField';
import { ErrorState, QueryView } from '../../components/Status';
import { useToast } from '../../components/toastContext';
import { useFormat } from '../../i18n/hooks';
import { BackButton, MainButton } from '../../telegram/TelegramUi';
import { MismatchNotice, ResultsSection, TransferItem } from '../finished/results';
import { roundForDisplay, type ResultRow } from '../finished/resultRows';

/** The preview is requested once typing pauses for this long. */
export const PREVIEW_DELAY_MS = 300;

function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(value);
    }, delayMs);
    return () => {
      clearTimeout(timer);
    };
  }, [value, delayMs]);
  return debounced;
}

export function FinishGamePage() {
  const { gameId = '' } = useParams();
  const game = useGame(gameId);
  return (
    <main className="page page-finish">
      <BackButton />
      <QueryView query={game}>
        {(data) =>
          data.status === 'active' ? (
            <FinishForm game={data} />
          ) : (
            <Navigate to={`/games/${data.id}`} replace />
          )
        }
      </QueryView>
    </main>
  );
}

type Mode = MismatchMode['mode'];

function FinishForm({ game }: { game: GameStateResponse }) {
  const { t } = useTranslation();
  const format = useFormat();
  const api = useApi();
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  // Keyed by player, so polling the game does not reset what was typed.
  const [chips, setChips] = useState<Record<string, number | null>>({});
  const [mode, setMode] = useState<Mode>('proportional');
  const [mismatchPlayerId, setMismatchPlayerId] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const seated = game.players.filter((p) => p.status === 'seated');
  const left = game.players.filter((p) => p.status === 'left');
  const entered = seated.map((p) => chips[p.playerId] ?? null);
  const complete = entered.every((c) => c !== null);
  const counted = game.summary.cashedOutChips + entered.reduce<number>((s, c) => s + (c ?? 0), 0);
  const difference = counted - game.summary.issuedChips;
  const hasMismatch = complete && difference !== 0;
  const effectiveMode: Mode = hasMismatch ? mode : 'proportional';
  const playerChosen = effectiveMode === 'proportional' || mismatchPlayerId !== '';

  const body: FinishPreviewBody | null =
    complete && playerChosen
      ? {
          finalChips: Object.fromEntries(seated.map((p) => [p.playerId, chips[p.playerId] ?? 0])),
          mismatchMode: effectiveMode,
          ...(effectiveMode === 'single_player' ? { mismatchPlayerId } : {}),
        }
      : null;
  // Debounced by its JSON: the object is rebuilt on every render.
  const bodyKey = JSON.stringify(body);
  const settledKey = useDebounced(bodyKey, PREVIEW_DELAY_MS);
  const previewInput = settledKey === bodyKey ? body : null;
  const preview = useFinishPreview(game.id, game.version, previewInput);

  if (game.summary.issuedChips === 0) {
    return (
      <>
        <h1 className="page-title">{t('finish.title')}</h1>
        <p className="notice">{t('finish.empty')}</p>
      </>
    );
  }

  const money = (value: number) =>
    format.money(chipsToMoneyRounded(Math.abs(value), game.stack), game.currency);
  const signed = (value: number) => (value > 0 ? '+' : value < 0 ? '−' : '');

  const submit = () => {
    if (!body) return;
    setSubmitting(true);
    api
      .finish(game.id, { ...body, expectedVersion: game.version })
      .then((response) => {
        queryClient.setQueryData(queryKeys.game(game.id), response.game);
        void queryClient.invalidateQueries({ queryKey: queryKeys.chat(game.chatId) });
        toast.info(t('finish.done'));
        void navigate(`/games/${game.id}`, { replace: true });
      })
      .catch((error: unknown) => {
        setSubmitting(false);
        if (isApiError(error, 'CONFLICT')) {
          void queryClient.invalidateQueries({ queryKey: queryKeys.game(game.id) });
        }
        toast.error(error);
      });
  };

  const mismatchPlayers = [...seated, ...left];
  const previewRows: ResultRow[] | undefined = preview.data?.players.map((p) => ({
    playerId: p.playerId,
    inChips: p.inChips,
    outChips: p.outChips,
    chipResult: roundForDisplay(
      add(
        fromInt(p.outChips - p.inChips),
        rat(BigInt(p.adjustmentChips.num), BigInt(p.adjustmentChips.den)),
      ),
    ),
    moneyResult: p.moneyResult,
  }));

  return (
    <>
      <h1 className="page-title">{t('finish.title')}</h1>
      <p className="hint">{game.name}</p>

      {seated.length > 0 ? (
        <Section title={t('finish.seated')}>
          {seated.map((p) => (
            <div key={p.playerId} className="section-field">
              <NumberField
                label={p.name}
                value={chips[p.playerId] ?? null}
                onChange={(value) => {
                  setChips((current) => ({ ...current, [p.playerId]: value }));
                }}
                {...(chips[p.playerId] != null
                  ? { hint: `≈ ${money(chips[p.playerId] ?? 0)}` }
                  : {})}
              />
            </div>
          ))}
        </Section>
      ) : null}

      {left.length > 0 ? (
        <Section title={t('finish.left')}>
          {left.map((p) => (
            <ListItem
              key={p.playerId}
              title={p.name}
              after={t('finish.outChips', { chips: format.number(p.outChips) })}
            />
          ))}
        </Section>
      ) : null}

      <Section title={t('finish.reconcile')}>
        <div
          className={
            !complete
              ? 'reconcile'
              : difference === 0
                ? 'reconcile reconcile-ok'
                : 'reconcile reconcile-bad'
          }
          data-testid="reconcile"
        >
          <ListItem title={t('finish.issued')} after={format.number(game.summary.issuedChips)} />
          <ListItem
            title={t('finish.counted')}
            after={
              complete
                ? format.number(counted)
                : t('finish.countedPartial', { chips: format.number(counted) })
            }
          />
          {complete ? (
            <ListItem
              title={t('finish.difference')}
              after={
                difference === 0
                  ? t('finish.balanced')
                  : `${signed(difference)}${format.number(Math.abs(difference))} · ${signed(difference)}${money(difference)}`
              }
            />
          ) : null}
        </div>
      </Section>

      {hasMismatch ? (
        <Section title={t('finish.adjustment')}>
          <MismatchNotice game={game} mismatchChips={difference} />
          <div className="choices" role="radiogroup" aria-label={t('finish.adjustment')}>
            {(['proportional', 'single_player'] as const).map((value) => (
              <label key={value} className="choice">
                <input
                  type="radio"
                  name="mismatch-mode"
                  value={value}
                  checked={mode === value}
                  onChange={() => {
                    setMode(value);
                  }}
                />
                {value === 'proportional' ? t('finish.proportional') : t('finish.singlePlayer')}
              </label>
            ))}
          </div>
          {mode === 'single_player' ? (
            <label className="field section-field">
              <span className="field-label">{t('finish.player')}</span>
              <select
                className="input"
                value={mismatchPlayerId}
                onChange={(event) => {
                  setMismatchPlayerId(event.target.value);
                }}
              >
                <option value="">{t('finish.choosePlayer')}</option>
                {mismatchPlayers.map((p) => (
                  <option key={p.playerId} value={p.playerId}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </Section>
      ) : null}

      {body === null ? (
        <p className="hint">{t('finish.previewHint')}</p>
      ) : preview.isError && previewInput !== null ? (
        <ErrorState error={preview.error} />
      ) : previewRows ? (
        <div aria-busy={preview.isFetching || previewInput === null}>
          <ResultsSection game={game} rows={previewRows} title={t('finish.preview')} />
          <Section title={t('settlement.title')}>
            {preview.data?.transfers.length === 0 ? (
              <p className="hint">{t('settlement.none')}</p>
            ) : (
              preview.data?.transfers.map((transfer) => (
                <TransferItem
                  key={`${transfer.from}-${transfer.to}`}
                  game={game}
                  transfer={transfer}
                />
              ))
            )}
          </Section>
        </div>
      ) : null}

      <MainButton
        text={t('finish.submit')}
        disabled={body === null}
        loading={submitting}
        onClick={submit}
      />
    </>
  );
}
