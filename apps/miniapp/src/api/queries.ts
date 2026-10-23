// TanStack Query keys and hooks over the API client.
import type { FinishPreviewBody, GameStateResponse, HistoryQueryParams } from '@pokerledger/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useApi } from './apiContext';

/** The game screen polls the server while it is open and visible. */
export const GAME_POLL_MS = 3_000;

export const queryKeys = {
  me: ['me'] as const,
  chat: (chatId: string) => ['chat', chatId] as const,
  chatPlayers: (chatId: string) => ['chat', chatId, 'players'] as const,
  chatGames: (chatId: string, query: HistoryQueryParams) =>
    ['chat', chatId, 'games', query] as const,
  game: (gameId: string) => ['game', gameId] as const,
  log: (gameId: string) => ['game', gameId, 'log'] as const,
  finishPreview: (gameId: string, version: number, body: FinishPreviewBody | null) =>
    ['game', gameId, 'finishPreview', version, body] as const,
  settlement: (gameId: string, version: number) => ['game', gameId, 'settlement', version] as const,
};

export function useMe() {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.me, queryFn: () => api.me(), staleTime: Infinity });
}

export function useChat(chatId: string | undefined) {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.chat(chatId ?? ''),
    queryFn: () => api.chat(chatId ?? ''),
    enabled: chatId !== undefined,
  });
}

export function useChatPlayers(chatId: string | undefined, enabled = true) {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.chatPlayers(chatId ?? ''),
    queryFn: () => api.chatPlayers(chatId ?? ''),
    enabled: enabled && chatId !== undefined,
  });
}

export function useChatGames(chatId: string, query: HistoryQueryParams = {}) {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.chatGames(chatId, query),
    queryFn: () => api.chatGames(chatId, query),
  });
}

export function useGame(gameId: string) {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.game(gameId),
    queryFn: () => api.game(gameId),
    refetchInterval: GAME_POLL_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: 'always',
  });
}

export function useGameLog(gameId: string, enabled = true) {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.log(gameId),
    queryFn: () => api.log(gameId),
    enabled,
    refetchInterval: GAME_POLL_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: 'always',
  });
}

/**
 * A game mutation: the response carries the fresh game state, which replaces the cached one
 * at once; the log is refetched.
 */
export function useGameMutation<V, R extends { game: GameStateResponse }>(
  gameId: string,
  mutationFn: (variables: V) => Promise<R>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (response) => {
      queryClient.setQueryData(queryKeys.game(gameId), response.game);
      void queryClient.invalidateQueries({ queryKey: queryKeys.log(gameId) });
    },
  });
}

/**
 * Results and the automatic settlement for the counted chips. Disabled while `body` is
 * `null` (not all chips entered); the previous preview stays shown while the next loads.
 */
export function useFinishPreview(gameId: string, version: number, body: FinishPreviewBody | null) {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.finishPreview(gameId, version, body),
    queryFn: () => api.finishPreview(gameId, body as FinishPreviewBody),
    enabled: body !== null,
    placeholderData: keepPreviousData,
  });
}

/**
 * Settlement of a finished game, keyed by the game version: any change of the game
 * (seen through polling) refetches it.
 */
export function useSettlement(gameId: string, version: number) {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.settlement(gameId, version),
    queryFn: () => api.settlement(gameId),
    placeholderData: keepPreviousData,
  });
}
