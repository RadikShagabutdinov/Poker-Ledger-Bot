// Game creation (SPEC §12.4, V1-GAME-02): name from the template, stack value; type hidden.
import { formatChipValue, type ChatResponse } from '@pokerledger/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router';

import { useApi } from '../api/apiContext';
import { isApiError } from '../api/client';
import { queryKeys, useChat } from '../api/queries';
import { Section } from '../components/List';
import { NumberField } from '../components/NumberField';
import { QueryView } from '../components/Status';
import { TextField } from '../components/TextField';
import { useToast } from '../components/toastContext';
import { useLanguage } from '../i18n/hooks';
import { BackButton, MainButton } from '../telegram/TelegramUi';

export function CreateGamePage() {
  const { chatId = '' } = useParams();
  const { t } = useTranslation();
  const chat = useChat(chatId);
  return (
    <main className="page">
      <BackButton />
      <h1 className="page-title">{t('create.title')}</h1>
      <QueryView query={chat}>{(data) => <CreateGameForm chat={data} />}</QueryView>
    </main>
  );
}

function CreateGameForm({ chat }: { chat: ChatResponse }) {
  const { t } = useTranslation();
  const language = useLanguage();
  const api = useApi();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(chat.nextGameName);
  const [chips, setChips] = useState<number | null>(chat.stack.chips);
  const [amount, setAmount] = useState<number | null>(chat.stack.amount);

  const create = useMutation({
    mutationFn: (body: { name: string; stackChips: number; stackAmount: number }) =>
      api.createGame(chat.id, body),
    onSuccess: ({ game }) => {
      queryClient.setQueryData(queryKeys.game(game.id), game);
      void queryClient.invalidateQueries({ queryKey: ['chat', chat.id, 'games'] });
      void navigate(`/games/${game.id}`, { replace: true });
    },
    onError: (error) => {
      const activeId = isApiError(error, 'ACTIVE_GAME_EXISTS') ? error.details?.gameId : undefined;
      if (typeof activeId === 'string') {
        toast.info(t('create.activeExists'));
        void navigate(`/games/${activeId}`, { replace: true });
      } else {
        toast.error(error);
      }
    },
  });

  const stackValid = chips !== null && chips > 0 && amount !== null && amount > 0;
  const valid = name.trim() !== '' && stackValid;

  return (
    <>
      <Section>
        <TextField label={t('create.name')} value={name} onChange={setName} maxLength={100} />
      </Section>
      <Section
        title={t('create.stack')}
        {...(stackValid
          ? {
              footer: t('create.chipValue', {
                value: formatChipValue({ chips, amount }, chat.currency, language),
              }),
            }
          : {})}
      >
        <NumberField label={t('create.stackChips')} value={chips} onChange={setChips} />
        <NumberField
          label={t('create.stackAmount', { currency: chat.currency })}
          value={amount}
          onChange={setAmount}
        />
      </Section>
      <MainButton
        text={t('create.start')}
        disabled={!valid}
        loading={create.isPending}
        onClick={() => {
          if (valid) {
            create.mutate({ name: name.trim(), stackChips: chips, stackAmount: amount });
          }
        }}
      />
    </>
  );
}
