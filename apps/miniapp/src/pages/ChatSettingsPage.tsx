// Chat settings: stack value, currency, game name template, bot language, quick buy-ins.
// Existing games keep the settings they were created with.
import {
  currencySchema,
  formatChipValue,
  gameNameTemplateSchema,
  renderGameName,
  type ChatResponse,
  type ChatSettingsPatch,
  type Language,
} from '@pokerledger/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import { useApi } from '../api/apiContext';
import { queryKeys, useChat } from '../api/queries';
import { Section } from '../components/List';
import { NumberField } from '../components/NumberField';
import { QueryView } from '../components/Status';
import { TextField } from '../components/TextField';
import { useToast } from '../components/toastContext';
import { useLanguage } from '../i18n/hooks';
import { QUICK_BUYIN_PRESETS, useStackFractionLabel } from '../i18n/stackFraction';
import { BackButton, MainButton } from '../telegram/TelegramUi';

const MAX_QUICK_BUYINS = 4;
const COMMON_CURRENCIES = ['RUB', 'USD', 'EUR', 'KZT', 'BYN', 'UAH', 'GEL', 'AMD', 'TRY', 'GBP'];

export function ChatSettingsPage() {
  const { chatId = '' } = useParams();
  const { t } = useTranslation();
  const chat = useChat(chatId);
  return (
    <main className="page">
      <BackButton />
      <h1 className="page-title">{t('settings.title')}</h1>
      <QueryView query={chat}>{(data) => <SettingsForm chat={data} />}</QueryView>
    </main>
  );
}

const sameNumbers = (a: readonly number[], b: readonly number[]) =>
  a.length === b.length && a.every((value, index) => value === b[index]);

function SettingsForm({ chat }: { chat: ChatResponse }) {
  const { t } = useTranslation();
  const language = useLanguage();
  const api = useApi();
  const toast = useToast();
  const queryClient = useQueryClient();
  const stackLabel = useStackFractionLabel();

  const [chips, setChips] = useState<number | null>(chat.stack.chips);
  const [amount, setAmount] = useState<number | null>(chat.stack.amount);
  const [currency, setCurrency] = useState(chat.currency);
  const [template, setTemplate] = useState(chat.gameNameTemplate);
  const [botLanguage, setBotLanguage] = useState<Language>(chat.language);
  const [now] = useState(() => Date.now());
  const [quick, setQuick] = useState<number[]>(() => [...chat.quickBuyins].sort((a, b) => a - b));

  const save = useMutation({
    mutationFn: (patch: ChatSettingsPatch) => api.updateChatSettings(chat.id, patch),
    onSuccess: (fresh) => {
      queryClient.setQueryData(queryKeys.chat(chat.id), fresh);
      toast.info(t('settings.saved'));
    },
    onError: toast.error,
  });

  const stackValid = chips !== null && chips > 0 && amount !== null && amount > 0;
  const currencyValid = currencySchema.safeParse(currency).success;
  const templateValid = gameNameTemplateSchema.safeParse(template).success;
  const valid = stackValid && currencyValid && templateValid && quick.length > 0;

  const patch: ChatSettingsPatch = {
    ...(stackValid && (chips !== chat.stack.chips || amount !== chat.stack.amount)
      ? { stack: { chips, amount } }
      : {}),
    ...(currency !== chat.currency ? { currency } : {}),
    ...(template.trim() !== chat.gameNameTemplate ? { gameNameTemplate: template.trim() } : {}),
    ...(botLanguage !== chat.language ? { language: botLanguage } : {}),
    ...(sameNumbers(
      quick,
      [...chat.quickBuyins].sort((a, b) => a - b),
    )
      ? {}
      : { quickBuyins: quick }),
  };
  const changed = Object.keys(patch).length > 0;

  // Presets plus any other size the chat already has.
  const sizes = [...new Set([...QUICK_BUYIN_PRESETS, ...chat.quickBuyins])].sort((a, b) => a - b);
  const toggle = (size: number) => {
    setQuick((current) =>
      current.includes(size)
        ? current.filter((value) => value !== size)
        : [...current, size].sort((a, b) => a - b),
    );
  };

  const preview = templateValid
    ? renderGameName(template.trim(), {
        language: botLanguage,
        now,
        n: chat.nextGameNumber,
      })
    : null;

  return (
    <>
      <Section
        title={t('create.stack')}
        {...(stackValid && currencyValid
          ? {
              footer: t('create.chipValue', {
                value: formatChipValue({ chips, amount }, currency, language),
              }),
            }
          : {})}
      >
        <div className="section-field">
          <NumberField label={t('create.stackChips')} value={chips} onChange={setChips} />
        </div>
        <div className="section-field">
          <NumberField
            label={t('create.stackAmount', { currency })}
            value={amount}
            onChange={setAmount}
          />
        </div>
      </Section>

      <Section>
        <div className="section-field">
          <TextField
            label={t('settings.currency')}
            value={currency}
            onChange={(value) => {
              setCurrency(value.trim().toUpperCase());
            }}
            maxLength={3}
            autoCapitalize="characters"
            list="currencies"
            hint={t('settings.currencyHint')}
            {...(currencyValid ? {} : { error: t('settings.currencyInvalid') })}
          />
          <datalist id="currencies">
            {COMMON_CURRENCIES.map((code) => (
              <option key={code} value={code} />
            ))}
          </datalist>
        </div>
      </Section>

      <Section
        title={t('settings.template')}
        {...(preview !== null ? { footer: t('settings.templatePreview', { name: preview }) } : {})}
      >
        <div className="section-field">
          <TextField
            label={t('settings.templateLabel')}
            value={template}
            onChange={setTemplate}
            maxLength={100}
            hint={t('settings.templateHint')}
            {...(templateValid ? {} : { error: t('settings.templateInvalid') })}
          />
        </div>
      </Section>

      <Section title={t('settings.botLanguage')}>
        <div className="choices" role="radiogroup" aria-label={t('settings.botLanguage')}>
          {(['ru', 'en'] as const).map((value) => (
            <label key={value} className="choice">
              <input
                type="radio"
                name="bot-language"
                checked={botLanguage === value}
                onChange={() => {
                  setBotLanguage(value);
                }}
              />
              {value === 'ru' ? 'Русский' : 'English'}
            </label>
          ))}
        </div>
      </Section>

      <Section title={t('settings.quickBuyins')} footer={t('settings.quickBuyinsHint')}>
        <div className="quick-buttons quick-toggles">
          {sizes.map((size) => {
            const selected = quick.includes(size);
            return (
              <button
                key={size}
                type="button"
                className={selected ? 'button button-primary' : 'button'}
                aria-pressed={selected}
                disabled={
                  (selected && quick.length === 1) ||
                  (!selected && quick.length >= MAX_QUICK_BUYINS)
                }
                onClick={() => {
                  toggle(size);
                }}
              >
                {stackLabel(size)}
              </button>
            );
          })}
        </div>
      </Section>

      <p className="hint">{t('settings.existingGames')}</p>

      <MainButton
        text={t('common.save')}
        disabled={!valid || !changed}
        loading={save.isPending}
        onClick={() => {
          if (valid && changed) save.mutate(patch);
        }}
      />
    </>
  );
}
