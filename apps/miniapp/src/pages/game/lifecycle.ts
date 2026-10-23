// Reopening and deleting a game: the creator or a chat admin, after a native confirmation.
import type { GameStateResponse } from '@pokerledger/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { useApi } from '../../api/apiContext';
import { isApiError } from '../../api/client';
import { queryKeys } from '../../api/queries';
import { useToast } from '../../components/toastContext';
import { useConfirm } from '../../telegram/nativeUi';

/** Asks, deletes the game and goes to the chat home. */
export function useDeleteGame(game: GameStateResponse) {
  const { t } = useTranslation();
  const api = useApi();
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: () => api.deleteGame(game.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.chatGameLists(game.chatId) });
      toast.info(t('gameMenu.deleted'));
      void navigate(`/chats/${game.chatId}`, { replace: true });
    },
    onError: toast.error,
  });
  const run = async () => {
    const ok = await confirm({
      title: game.name,
      message: t('gameMenu.deleteConfirm'),
      ok: t('gameMenu.deleteOk'),
      destructive: true,
    });
    if (ok) remove.mutate();
  };
  return { run, isPending: remove.isPending };
}

/**
 * Asks and reopens a finished game; the game screen then shows it as active. When another
 * game is running in the chat, offers to open that one.
 */
export function useReopenGame(game: GameStateResponse) {
  const { t } = useTranslation();
  const api = useApi();
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const reopen = useMutation({
    mutationFn: () => api.reopen(game.id, game.version),
    onSuccess: ({ game: fresh }) => {
      queryClient.setQueryData(queryKeys.game(game.id), fresh);
      void queryClient.invalidateQueries({ queryKey: queryKeys.chatGameLists(game.chatId) });
      toast.info(t('gameMenu.reopened'));
    },
    onError: async (error) => {
      const activeId = isApiError(error, 'ACTIVE_GAME_EXISTS') ? error.details?.gameId : undefined;
      if (typeof activeId === 'string') {
        const open = await confirm({
          message: t('gameMenu.activeExists'),
          ok: t('gameMenu.openActive'),
        });
        if (open) void navigate(`/games/${activeId}`);
        return;
      }
      if (isApiError(error, 'CONFLICT')) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.game(game.id) });
      }
      toast.error(error);
    },
  });
  const run = async () => {
    const ok = await confirm({
      title: game.name,
      message: t('gameMenu.reopenConfirm'),
      ok: t('gameMenu.reopenOk'),
    });
    if (ok) reopen.mutate();
  };
  return { run, isPending: reopen.isPending };
}
