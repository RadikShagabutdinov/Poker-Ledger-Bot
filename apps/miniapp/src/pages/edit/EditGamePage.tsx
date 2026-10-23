// Editing a finished game (creator and chat admins): name, stack, mismatch adjustment and
// chip events. Every change goes to the server at once and lands in the log.
import type { EditFinishedBody, GameStateResponse } from '@pokerledger/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useParams } from 'react-router';

import { useApi } from '../../api/apiContext';
import { useGame, useGameLog } from '../../api/queries';
import { BottomSheet } from '../../components/BottomSheet';
import { ListItem, Section } from '../../components/List';
import { NumberField } from '../../components/NumberField';
import { QueryView } from '../../components/Status';
import { useFormat } from '../../i18n/hooks';
import { useConfirm } from '../../telegram/nativeUi';
import { BackButton } from '../../telegram/TelegramUi';
import { RenameSheet, StackSheet } from '../game/GameSettingsSheets';
import type { LogEntry } from '../game/events';
import { playerSessions, sessionEventIds, type ChipEntry, type Session } from './sessions';
import { useFinishedEdit } from './useFinishedEdit';

export function EditGamePage() {
  const { gameId = '' } = useParams();
  const { t } = useTranslation();
  const game = useGame(gameId);
  return (
    <main className="page">
      <BackButton />
      <h1 className="page-title">{t('edit.title')}</h1>
      <QueryView query={game}>
        {(data) =>
          data.status === 'finished' && data.permissions.canEditFinished ? (
            <Editor game={data} />
          ) : (
            <Navigate to={`/games/${data.id}`} replace />
          )
        }
      </QueryView>
    </main>
  );
}

type Sheet =
  | { kind: 'rename' }
  | { kind: 'stack' }
  | { kind: 'event'; entry: ChipEntry }
  | { kind: 'rebuy'; playerId: string; cashOut: ChipEntry }
  | { kind: 'entry'; playerId: string };

function Editor({ game }: { game: GameStateResponse }) {
  const { t } = useTranslation();
  const format = useFormat();
  const api = useApi();
  const confirm = useConfirm();
  const log = useGameLog(game.id);
  const edit = useFinishedEdit(game);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const close = () => {
    setSheet(null);
  };

  const removeSession = async (name: string, session: Session) => {
    const ok = await confirm({
      message: t('edit.removeSessionConfirm', { name }),
      ok: t('edit.removeSessionOk'),
      destructive: true,
    });
    if (!ok) return;
    edit.run((extra) => api.editFinished(game.id, { cancel: sessionEventIds(session), ...extra }));
  };

  return (
    <>
      <Link className="hint-link" to={`/games/${game.id}`}>
        {t('edit.back')}
      </Link>

      <Section title={t('edit.parameters')}>
        <ListItem
          title={t('create.name')}
          subtitle={game.name}
          onClick={() => {
            setSheet({ kind: 'rename' });
          }}
        />
        <ListItem
          title={t('create.stack')}
          subtitle={t('details.stackValue', {
            chips: format.number(game.stack.chips),
            amount: format.money(game.stack.amount, game.currency),
          })}
          onClick={() => {
            setSheet({ kind: 'stack' });
          }}
        />
      </Section>

      {game.mismatch !== null && game.mismatch.chips !== 0 ? (
        <MismatchEditor game={game} edit={edit} />
      ) : null}

      <QueryView query={log}>
        {(data) => (
          <>
            {game.players.map((player) => (
              <PlayerEvents
                key={player.playerId}
                name={player.name}
                sessions={playerSessions(data.entries, player.playerId)}
                disabled={edit.isPending}
                onEvent={(entry) => {
                  setSheet({ kind: 'event', entry });
                }}
                onRemoveSession={(session) => void removeSession(player.name, session)}
                onAddRebuy={(cashOut) => {
                  setSheet({ kind: 'rebuy', playerId: player.playerId, cashOut });
                }}
                onAddEntry={() => {
                  setSheet({ kind: 'entry', playerId: player.playerId });
                }}
              />
            ))}
          </>
        )}
      </QueryView>

      {sheet?.kind === 'rename' ? (
        <RenameSheet
          game={game}
          onClose={close}
          saving={edit.isPending}
          save={(body, done) => {
            edit.run((extra) => api.updateGame(game.id, { ...body, ...extra }), done);
          }}
        />
      ) : null}
      {sheet?.kind === 'stack' ? (
        <StackSheet
          game={game}
          onClose={close}
          saving={edit.isPending}
          save={(body, done) => {
            edit.run((extra) => api.updateGame(game.id, { ...body, ...extra }), done);
          }}
        />
      ) : null}
      {sheet?.kind === 'event' ? (
        <EventSheet game={game} entry={sheet.entry} edit={edit} onClose={close} />
      ) : null}
      {sheet?.kind === 'rebuy' ? (
        <AddChipsSheet
          game={game}
          title={t('edit.addRebuyTitle', { name: nameOf(game, sheet.playerId) })}
          firstLabel={t('edit.rebuyChips')}
          finalChips={sheet.cashOut.chips}
          edit={edit}
          onClose={close}
          build={(chips, final) => ({
            cancel: [sheet.cashOut.id],
            add: [
              { playerId: sheet.playerId, type: 'rebuy', chips },
              { playerId: sheet.playerId, type: 'cash_out', chips: final },
            ],
          })}
        />
      ) : null}
      {sheet?.kind === 'entry' ? (
        <AddChipsSheet
          game={game}
          title={t('edit.addEntryTitle', { name: nameOf(game, sheet.playerId) })}
          firstLabel={t('edit.buyInChips')}
          finalChips={null}
          edit={edit}
          onClose={close}
          build={(chips, final) => ({
            add: [
              { playerId: sheet.playerId, type: 'buy_in', chips },
              { playerId: sheet.playerId, type: 'cash_out', chips: final },
            ],
          })}
        />
      ) : null}
      {edit.policySheet}
    </>
  );
}

const nameOf = (game: GameStateResponse, playerId: string) =>
  game.players.find((p) => p.playerId === playerId)?.name ?? '';

type Edit = ReturnType<typeof useFinishedEdit>;

function PlayerEvents({
  name,
  sessions,
  disabled,
  onEvent,
  onRemoveSession,
  onAddRebuy,
  onAddEntry,
}: {
  name: string;
  sessions: readonly Session[];
  disabled: boolean;
  onEvent: (entry: ChipEntry) => void;
  onRemoveSession: (session: Session) => void;
  onAddRebuy: (cashOut: ChipEntry) => void;
  onAddEntry: () => void;
}) {
  const { t } = useTranslation();
  const format = useFormat();
  const last = sessions.at(-1);
  const label = (entry: LogEntry) =>
    t(`edit.event.${entry.type as 'buy_in' | 'rebuy' | 'cash_out'}`, {
      chips: format.number(entry.chips ?? 0),
    });
  return (
    <Section title={name}>
      {sessions.length === 0 ? <p className="hint">{t('edit.noEvents')}</p> : null}
      {sessions.map((session, index) => (
        <div
          key={session.buyIn.id}
          className="edit-session"
          aria-label={t('edit.session', { n: index + 1 })}
        >
          {[session.buyIn, ...session.rebuys, ...(session.cashOut ? [session.cashOut] : [])].map(
            (entry) => (
              <ListItem
                key={entry.id}
                title={label(entry)}
                after="✎"
                onClick={() => {
                  if (!disabled) onEvent(entry);
                }}
              />
            ),
          )}
          <button
            type="button"
            className="link-button link-destructive"
            disabled={disabled}
            onClick={() => {
              onRemoveSession(session);
            }}
          >
            {t('edit.removeSession')}
          </button>
        </div>
      ))}
      <div className="quick-buttons">
        {last?.cashOut ? (
          <button
            type="button"
            className="button"
            disabled={disabled}
            onClick={() => {
              if (last.cashOut) onAddRebuy(last.cashOut);
            }}
          >
            {t('edit.addRebuy')}
          </button>
        ) : null}
        <button type="button" className="button" disabled={disabled} onClick={onAddEntry}>
          {t('edit.addEntry')}
        </button>
      </div>
    </Section>
  );
}

function EventSheet({
  game,
  entry,
  edit,
  onClose,
}: {
  game: GameStateResponse;
  entry: ChipEntry;
  edit: Edit;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const api = useApi();
  const confirm = useConfirm();
  const [chips, setChips] = useState<number | null>(entry.chips);
  // A cash-out may be zero chips; buys are positive.
  const valid = chips !== null && (entry.type === 'cash_out' ? chips >= 0 : chips > 0);
  const type = entry.type as 'buy_in' | 'rebuy' | 'cash_out';

  const cancelRebuy = async () => {
    const ok = await confirm({
      message: t('edit.cancelRebuyConfirm'),
      ok: t('edit.cancelRebuyOk'),
      destructive: true,
    });
    if (ok) {
      edit.run((extra) => api.editFinished(game.id, { cancel: [entry.id], ...extra }), onClose);
    }
  };

  return (
    <BottomSheet
      open
      onClose={onClose}
      title={`${entry.playerName ?? ''}: ${t(`edit.eventType.${type}`)}`}
    >
      <NumberField label={t('edit.chips')} value={chips} onChange={setChips} autoFocus />
      <button
        type="button"
        className="button button-primary button-wide"
        disabled={!valid || chips === entry.chips || edit.isPending}
        onClick={() => {
          if (chips === null) return;
          edit.run(
            (extra) =>
              api.editFinished(game.id, { replace: [{ eventId: entry.id, chips }], ...extra }),
            onClose,
          );
        }}
      >
        {t('common.save')}
      </button>
      {type === 'rebuy' ? (
        <button
          type="button"
          className="button button-destructive button-wide"
          disabled={edit.isPending}
          onClick={() => void cancelRebuy()}
        >
          {t('edit.cancelRebuy')}
        </button>
      ) : null}
    </BottomSheet>
  );
}

/** A buy (rebuy or a new buy-in) together with the chips the player left with. */
function AddChipsSheet({
  game,
  title,
  firstLabel,
  finalChips,
  edit,
  onClose,
  build,
}: {
  game: GameStateResponse;
  title: string;
  firstLabel: string;
  finalChips: number | null;
  edit: Edit;
  onClose: () => void;
  build: (chips: number, final: number) => EditFinishedBody;
}) {
  const { t } = useTranslation();
  const api = useApi();
  const [chips, setChips] = useState<number | null>(game.stack.chips);
  const [final, setFinal] = useState<number | null>(finalChips);
  const valid = chips !== null && chips > 0 && final !== null && final >= 0;
  return (
    <BottomSheet open onClose={onClose} title={title}>
      <NumberField label={firstLabel} value={chips} onChange={setChips} autoFocus />
      <NumberField label={t('edit.finalChips')} value={final} onChange={setFinal} />
      <button
        type="button"
        className="button button-primary button-wide"
        disabled={!valid || edit.isPending}
        onClick={() => {
          if (chips === null || final === null) return;
          edit.run(
            (extra) => api.editFinished(game.id, { ...build(chips, final), ...extra }),
            onClose,
          );
        }}
      >
        {t('common.save')}
      </button>
    </BottomSheet>
  );
}

function MismatchEditor({ game, edit }: { game: GameStateResponse; edit: Edit }) {
  const { t } = useTranslation();
  const api = useApi();
  const current = game.mismatch;
  const [mode, setMode] = useState(current?.mode ?? 'proportional');
  const [playerId, setPlayerId] = useState(current?.playerId ?? '');
  const players = game.players.filter((p) => p.status !== 'not_joined');
  const changed =
    mode !== current?.mode || (mode === 'single_player' && playerId !== current.playerId);
  const valid = mode === 'proportional' || playerId !== '';
  return (
    <Section title={t('finish.adjustment')}>
      <div className="choices" role="radiogroup" aria-label={t('finish.adjustment')}>
        {(['proportional', 'single_player'] as const).map((value) => (
          <label key={value} className="choice">
            <input
              type="radio"
              name="mismatch-mode"
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
            value={playerId}
            onChange={(event) => {
              setPlayerId(event.target.value);
            }}
          >
            <option value="">{t('finish.choosePlayer')}</option>
            {players.map((p) => (
              <option key={p.playerId} value={p.playerId}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <div className="section-field">
        <button
          type="button"
          className="button button-wide"
          disabled={!changed || !valid || edit.isPending}
          onClick={() => {
            edit.run((extra) =>
              api.updateGame(game.id, {
                mismatchMode: mode,
                ...(mode === 'single_player' ? { mismatchPlayerId: playerId } : {}),
                ...extra,
              }),
            );
          }}
        >
          {t('edit.applyAdjustment')}
        </button>
      </div>
    </Section>
  );
}
