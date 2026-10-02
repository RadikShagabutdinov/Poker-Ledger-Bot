// Game menu actions (V1-GAME-04): rename and change the stack value.
import { gameNameSchema, type GameStateResponse } from '@pokerledger/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useApi } from '../../api/apiContext';
import { useGameMutation } from '../../api/queries';
import { BottomSheet } from '../../components/BottomSheet';
import { NumberField } from '../../components/NumberField';
import { TextField } from '../../components/TextField';
import { useToast } from '../../components/toastContext';
import { useConfirm } from '../../telegram/nativeUi';

type Props = { game: GameStateResponse; onClose: () => void };

export function RenameSheet({ game, onClose }: Props) {
  const { t } = useTranslation();
  const api = useApi();
  const toast = useToast();
  const [name, setName] = useState(game.name);
  const update = useGameMutation(game.id, (value: string) =>
    api.updateGame(game.id, { name: value }),
  );
  const valid = gameNameSchema.safeParse(name).success;
  return (
    <BottomSheet open onClose={onClose} title={t('game.renameTitle')}>
      <TextField label={t('create.name')} value={name} onChange={setName} maxLength={100} />
      <button
        type="button"
        className="button button-primary button-wide"
        disabled={!valid || update.isPending}
        onClick={() => {
          update.mutate(name.trim(), { onSuccess: onClose, onError: toast.error });
        }}
      >
        {t('common.save')}
      </button>
    </BottomSheet>
  );
}

export function StackSheet({ game, onClose }: Props) {
  const { t } = useTranslation();
  const api = useApi();
  const toast = useToast();
  const confirm = useConfirm();
  const [chips, setChips] = useState<number | null>(game.stack.chips);
  const [amount, setAmount] = useState<number | null>(game.stack.amount);
  const update = useGameMutation(game.id, (stack: { chips: number; amount: number }) =>
    api.updateGame(game.id, { stack }),
  );
  const valid = chips !== null && chips > 0 && amount !== null && amount > 0;
  const save = async () => {
    if (!valid) return;
    const ok = await confirm({ message: t('game.stackConfirm'), ok: t('game.stackOk') });
    if (ok) update.mutate({ chips, amount }, { onSuccess: onClose, onError: toast.error });
  };
  return (
    <BottomSheet open onClose={onClose} title={t('game.stackTitle')}>
      <NumberField label={t('create.stackChips')} value={chips} onChange={setChips} />
      <NumberField
        label={t('create.stackAmount', { currency: game.currency })}
        value={amount}
        onChange={setAmount}
      />
      <p className="notice">{t('game.stackWarning')}</p>
      <button
        type="button"
        className="button button-primary button-wide"
        disabled={!valid || update.isPending}
        onClick={() => void save()}
      >
        {t('common.save')}
      </button>
    </BottomSheet>
  );
}
