// Profile: interface language and payment details shared by all chats.
import {
  payBankSchema,
  payNoteSchema,
  payPhoneSchema,
  type Language,
  type ProfilePatch,
  type ProfileResponse,
} from '@pokerledger/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { z } from 'zod';

import { useApi } from '../api/apiContext';
import { queryKeys, useMe } from '../api/queries';
import { Section } from '../components/List';
import { QueryView } from '../components/Status';
import { TextField } from '../components/TextField';
import { useToast } from '../components/toastContext';
import { useConfirm } from '../telegram/nativeUi';
import { BackButton, MainButton } from '../telegram/TelegramUi';

const NOTE_MAX = 200;

export function ProfilePage() {
  const { t } = useTranslation();
  const me = useMe();
  return (
    <main className="page">
      <BackButton />
      <h1 className="page-title">{t('profile.title')}</h1>
      <QueryView query={me}>{(data) => <ProfileForm profile={data} />}</QueryView>
    </main>
  );
}

function useUpdateProfile() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: ProfilePatch) => api.updateMe(patch),
    onSuccess: (profile) => {
      queryClient.setQueryData(queryKeys.me, profile);
    },
  });
}

/** An empty field clears the value; otherwise the trimmed text must pass `schema`. */
function fieldValue(
  text: string,
  schema: z.ZodType<string>,
): { ok: boolean; value: string | null } {
  if (text.trim() === '') return { ok: true, value: null };
  const parsed = schema.safeParse(text);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, value: null };
}

function ProfileForm({ profile }: { profile: ProfileResponse }) {
  const { t } = useTranslation();
  const toast = useToast();
  const confirm = useConfirm();
  const update = useUpdateProfile();
  const [phone, setPhone] = useState(profile.payPhone ?? '');
  const [bank, setBank] = useState(profile.payBank ?? '');
  const [note, setNote] = useState(profile.payNote ?? '');

  const fields = {
    payPhone: fieldValue(phone, payPhoneSchema),
    payBank: fieldValue(bank, payBankSchema),
    payNote: fieldValue(note, payNoteSchema),
  };
  const valid = Object.values(fields).every((f) => f.ok);
  const changed =
    fields.payPhone.value !== profile.payPhone ||
    fields.payBank.value !== profile.payBank ||
    fields.payNote.value !== profile.payNote;
  const hasDetails =
    profile.payPhone !== null || profile.payBank !== null || profile.payNote !== null;

  const setLanguage = (language: Language | null) => {
    update.mutate({ language }, { onError: toast.error });
  };

  const save = () => {
    if (!valid || !changed) return;
    update.mutate(
      {
        payPhone: fields.payPhone.value,
        payBank: fields.payBank.value,
        payNote: fields.payNote.value,
      },
      {
        onSuccess: () => {
          toast.info(t('profile.saved'));
        },
        onError: toast.error,
      },
    );
  };

  const clear = async () => {
    const ok = await confirm({
      message: t('profile.clearConfirm'),
      ok: t('profile.clearOk'),
      destructive: true,
    });
    if (!ok) return;
    update.mutate(
      { payPhone: null, payBank: null, payNote: null },
      {
        onSuccess: () => {
          setPhone('');
          setBank('');
          setNote('');
          toast.info(t('profile.cleared'));
        },
        onError: toast.error,
      },
    );
  };

  const languages: [Language | null, string][] = [
    [null, t('profile.languageTelegram')],
    ['ru', 'Русский'],
    ['en', 'English'],
  ];

  return (
    <>
      <Section title={t('profile.language')}>
        <div className="choices" role="radiogroup" aria-label={t('profile.language')}>
          {languages.map(([value, label]) => (
            <label key={value ?? 'telegram'} className="choice">
              <input
                type="radio"
                name="language"
                checked={profile.language === value}
                disabled={update.isPending}
                onChange={() => {
                  setLanguage(value);
                }}
              />
              {label}
            </label>
          ))}
        </div>
      </Section>

      <Section title={t('profile.payment')} footer={t('profile.paymentVisibility')}>
        <div className="section-field">
          <TextField
            label={t('profile.phone')}
            value={phone}
            onChange={setPhone}
            inputMode="tel"
            maxLength={32}
            {...(fields.payPhone.ok ? {} : { error: t('profile.invalid') })}
          />
        </div>
        <div className="section-field">
          <TextField
            label={t('profile.bank')}
            value={bank}
            onChange={setBank}
            maxLength={100}
            {...(fields.payBank.ok ? {} : { error: t('profile.invalid') })}
          />
        </div>
        <div className="section-field">
          <TextField
            label={t('profile.note')}
            value={note}
            onChange={setNote}
            maxLength={NOTE_MAX}
            placeholder={t('profile.notePlaceholder')}
            hint={`${String(note.length)} / ${String(NOTE_MAX)}`}
            {...(fields.payNote.ok ? {} : { error: t('profile.invalid') })}
          />
        </div>
      </Section>

      {hasDetails ? (
        <button
          type="button"
          className="button button-destructive button-wide"
          disabled={update.isPending}
          onClick={() => void clear()}
        >
          {t('profile.clear')}
        </button>
      ) : null}

      <MainButton
        text={t('common.save')}
        disabled={!valid || !changed}
        loading={update.isPending}
        onClick={save}
      />
    </>
  );
}
