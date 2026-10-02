// «+ Player» (SPEC §12.5, V1-PL-02/04): known chat players, myself, or a guest.
import { guestNameSchema, type GameStateResponse } from '@pokerledger/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useApi } from '../../api/apiContext';
import { isApiError } from '../../api/client';
import { queryKeys, useChatPlayers, useGameMutation } from '../../api/queries';
import { BottomSheet } from '../../components/BottomSheet';
import { ListItem, Section } from '../../components/List';
import { QueryView } from '../../components/Status';
import { TextField } from '../../components/TextField';
import { useToast } from '../../components/toastContext';
import { useConfirm } from '../../telegram/nativeUi';

type AddBody = { playerId: string } | { guestName: string } | { self: true };

const lower = (text: string) => text.trim().toLocaleLowerCase();

export function AddPlayerSheet({
  game,
  onClose,
  onAdded,
}: {
  game: GameStateResponse;
  onClose: () => void;
  /** Called with the added player, to open their buy-in panel. */
  onAdded: (playerId: string) => void;
}) {
  const { t } = useTranslation();
  const api = useApi();
  const toast = useToast();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const players = useChatPlayers(game.chatId);
  const [search, setSearch] = useState('');
  const [guestName, setGuestName] = useState('');

  const add = useGameMutation(game.id, (body: AddBody) => api.addPlayer(game.id, body));
  const submit = (body: AddBody) => {
    add.mutate(body, {
      onSuccess: ({ playerId }) => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.chatPlayers(game.chatId) });
        onAdded(playerId);
      },
      onError: (error) => {
        void onAddError(error, body);
      },
    });
  };

  const onAddError = async (error: Error, body: AddBody) => {
    // Another member may have just created this guest (V1-PL-02).
    const existingId = isApiError(error, 'GUEST_NAME_TAKEN') ? error.details?.playerId : null;
    if (typeof existingId !== 'string' || !('guestName' in body)) {
      toast.error(error);
      return;
    }
    const ok = await confirm({
      message: t('addPlayer.existingConfirm', { name: body.guestName }),
      ok: t('addPlayer.existingOk'),
    });
    if (ok) submit({ playerId: existingId });
  };

  const inGame = new Set(game.players.map((p) => p.playerId));
  const all = players.data?.players ?? [];
  const candidates = all.filter(
    (p) => !inGame.has(p.playerId) && lower(p.name).includes(lower(search)),
  );
  const existingGuest =
    guestName.trim() === ''
      ? undefined
      : all.find((p) => p.isGuest && lower(p.name) === lower(guestName));
  const guestValid = guestNameSchema.safeParse(guestName).success;

  return (
    <BottomSheet open onClose={onClose} title={t('addPlayer.title')}>
      {game.myPlayerId === null ? (
        <button
          type="button"
          className="button button-wide"
          disabled={add.isPending}
          onClick={() => {
            submit({ self: true });
          }}
        >
          {t('addPlayer.self')}
        </button>
      ) : null}

      <Section footer={t('addPlayer.hint')}>
        <TextField
          type="search"
          label={t('addPlayer.search')}
          value={search}
          onChange={setSearch}
        />
        <QueryView query={players}>
          {() =>
            candidates.length === 0 ? (
              <p className="hint">{t('addPlayer.noMatches')}</p>
            ) : (
              candidates.map((p) => (
                <ListItem
                  key={p.playerId}
                  title={p.name}
                  {...(p.isGuest ? { subtitle: t('addPlayer.guestLabel') } : {})}
                  onClick={() => {
                    if (!add.isPending) submit({ playerId: p.playerId });
                  }}
                />
              ))
            )
          }
        </QueryView>
      </Section>

      <Section title={t('addPlayer.guest')}>
        <TextField
          label={t('addPlayer.guestName')}
          value={guestName}
          onChange={setGuestName}
          maxLength={40}
        />
        {existingGuest ? (
          <div className="notice">
            <p>{t('addPlayer.existingGuest', { name: existingGuest.name })}</p>
            {!inGame.has(existingGuest.playerId) ? (
              <button
                type="button"
                className="button button-primary"
                disabled={add.isPending}
                onClick={() => {
                  submit({ playerId: existingGuest.playerId });
                }}
              >
                {t('addPlayer.useExisting')}
              </button>
            ) : null}
          </div>
        ) : (
          <button
            type="button"
            className="button button-primary button-wide"
            disabled={add.isPending || !guestValid}
            onClick={() => {
              submit({ guestName: guestName.trim() });
            }}
          >
            {t('addPlayer.guestSubmit')}
          </button>
        )}
      </Section>
    </BottomSheet>
  );
}
