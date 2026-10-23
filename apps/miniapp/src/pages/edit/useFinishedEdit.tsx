// Edits of a finished game, each sent at once and logged by the server.
import type {
  GameMutationResponse,
  GameStateResponse,
  SettlementPolicy,
} from '@pokerledger/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { isApiError } from '../../api/client';
import { queryKeys } from '../../api/queries';
import { ChoiceSheet } from '../../components/ChoiceSheet';
import { useToast } from '../../components/toastContext';

export interface EditExtra {
  readonly expectedVersion: number;
  readonly settlementPolicy?: SettlementPolicy;
}

export type EditRequest = (extra: EditExtra) => Promise<GameMutationResponse>;

interface Attempt {
  readonly request: EditRequest;
  readonly onDone?: (() => void) | undefined;
}

function needsPolicy(error: unknown): boolean {
  return isApiError(error, 'VALIDATION') && error.details?.reason === 'SETTLEMENT_POLICY_REQUIRED';
}

/**
 * Runs an edit with the version the user saw. When results change and the settlement was
 * edited by hand, the server asks what to do with it; the user picks in a sheet and the edit
 * is repeated with that policy. Render `policySheet` once on the page.
 */
export function useFinishedEdit(game: GameStateResponse): {
  run: (request: EditRequest, onDone?: () => void) => void;
  isPending: boolean;
  policySheet: ReactNode;
} {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [waiting, setWaiting] = useState<Attempt | null>(null);

  const mutation = useMutation({
    mutationFn: ({ request, policy }: { request: EditRequest; policy?: SettlementPolicy }) =>
      request({
        expectedVersion: game.version,
        ...(policy !== undefined ? { settlementPolicy: policy } : {}),
      }),
    onSuccess: ({ game: fresh }) => {
      queryClient.setQueryData(queryKeys.game(game.id), fresh);
      void queryClient.invalidateQueries({ queryKey: queryKeys.log(game.id) });
    },
  });

  const attempt = ({ request, onDone }: Attempt, policy?: SettlementPolicy) => {
    mutation.mutate(
      { request, ...(policy !== undefined ? { policy } : {}) },
      {
        onSuccess: () => {
          toast.info(t('edit.saved'));
          onDone?.();
        },
        onError: (error) => {
          if (policy === undefined && needsPolicy(error)) {
            setWaiting({ request, onDone });
            return;
          }
          if (isApiError(error, 'CONFLICT')) {
            void queryClient.invalidateQueries({ queryKey: queryKeys.game(game.id) });
          }
          toast.error(error);
        },
      },
    );
  };

  const policySheet = (
    <ChoiceSheet<SettlementPolicy>
      open={waiting !== null}
      title={t('edit.policyTitle')}
      message={t('edit.policyMessage')}
      choices={[
        { id: 'recalculate', label: t('edit.policyRecalculate') },
        { id: 'keep', label: t('edit.policyKeep'), hint: t('edit.policyKeepHint') },
      ]}
      onChoose={(policy) => {
        const pending = waiting;
        setWaiting(null);
        if (pending && policy !== null) attempt(pending, policy);
      }}
    />
  );

  return {
    run: (request, onDone) => {
      attempt({ request, onDone });
    },
    isPending: mutation.isPending,
    policySheet,
  };
}
