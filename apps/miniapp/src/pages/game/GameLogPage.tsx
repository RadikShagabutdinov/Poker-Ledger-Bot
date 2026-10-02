// Game log (V1-LOG-02..04): cancelled events struck through, cancel a specific event.
import type { GameStateResponse } from '@pokerledger/shared';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import { useApi } from '../../api/apiContext';
import { isApiError } from '../../api/client';
import { useGame, useGameLog, useGameMutation } from '../../api/queries';
import { ListItem, Section } from '../../components/List';
import { QueryView } from '../../components/Status';
import { useToast } from '../../components/toastContext';
import { useFormat } from '../../i18n/hooks';
import { useConfirm } from '../../telegram/nativeUi';
import { BackButton } from '../../telegram/TelegramUi';
import { describeEntry, isChipEvent, type LogEntry } from './events';

export function GameLogPage() {
  const { gameId = '' } = useParams();
  const { t } = useTranslation();
  const game = useGame(gameId);
  return (
    <main className="page">
      <BackButton />
      <h1 className="page-title">{t('log.title')}</h1>
      <QueryView query={game}>{(data) => <GameLog game={data} />}</QueryView>
    </main>
  );
}

const entryDomId = (id: number) => `log-entry-${String(id)}`;

function GameLog({ game }: { game: GameStateResponse }) {
  const { t } = useTranslation();
  const format = useFormat();
  const api = useApi();
  const toast = useToast();
  const confirm = useConfirm();
  const log = useGameLog(game.id);
  const [highlight, setHighlight] = useState<number | null>(null);
  const cancel = useGameMutation(game.id, (eventId: number) => api.cancelEvent(game.id, eventId));

  useEffect(() => {
    if (highlight === null) return;
    document.getElementById(entryDomId(highlight))?.scrollIntoView?.({ block: 'center' });
  }, [highlight]);

  const time = new Intl.DateTimeFormat(format.language === 'ru' ? 'ru-RU' : 'en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });
  const canCancel = game.status === 'active' && game.permissions.canManage;

  const onCancel = async (entry: LogEntry, entries: readonly LogEntry[]) => {
    const what = describeEntry(t, format, entry, game.currency);
    const ok = await confirm({
      message: t('log.cancelConfirm', { what }),
      ok: t('log.cancelOk'),
      destructive: true,
    });
    if (!ok) return;
    cancel.mutate(entry.id, {
      onSuccess: () => {
        setHighlight(null);
        toast.info(t('log.cancelledToast', { what }));
      },
      onError: (error) => {
        // V1-LOG-04: say which event has to be cancelled first.
        const blockingId = isApiError(error, 'INVALID_EVENT_SEQUENCE')
          ? error.details?.blockingEventId
          : undefined;
        const blocking = entries.find((e) => e.id === blockingId);
        if (typeof blockingId !== 'number') {
          toast.error(error);
        } else if (blocking) {
          setHighlight(blocking.id);
          toast.errorText(
            t('log.blocked', { what: describeEntry(t, format, blocking, game.currency) }),
          );
        } else {
          toast.errorText(t('log.blockedUnknown'));
        }
      },
    });
  };

  return (
    <QueryView query={log}>
      {(data) =>
        data.entries.length === 0 ? (
          <p className="hint">{t('log.empty')}</p>
        ) : (
          <Section>
            {data.entries.toReversed().map((entry) => {
              const cancellable = canCancel && entry.cancelled === null && isChipEvent(entry);
              const subtitle = [
                entry.createdBy.name,
                time.format(entry.createdAt),
                ...(entry.cancelled ? [t('log.cancelled')] : []),
              ].join(' · ');
              const classes = [
                entry.cancelled ? 'item-cancelled' : '',
                highlight === entry.id ? 'item-highlight' : '',
              ]
                .filter(Boolean)
                .join(' ');
              return (
                <ListItem
                  key={entry.id}
                  id={entryDomId(entry.id)}
                  className={classes}
                  title={describeEntry(t, format, entry, game.currency)}
                  subtitle={subtitle}
                  {...(cancellable
                    ? {
                        onClick: () => {
                          if (!cancel.isPending) void onCancel(entry, data.entries);
                        },
                      }
                    : {})}
                />
              );
            })}
          </Section>
        )
      }
    </QueryView>
  );
}
