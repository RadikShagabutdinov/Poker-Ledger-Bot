import { useId, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { useLanguage } from '../i18n/hooks';
import { formatIntegerInput, parseIntegerInput, type IntegerInputError } from './integerInput';

export interface NumberFieldProps {
  readonly label: string;
  /** `null` for an empty or invalid field. */
  readonly value: number | null;
  readonly onChange: (value: number | null) => void;
  readonly placeholder?: string;
  /** Shown under the field, e.g. the money equivalent (V1-PLAY-01). */
  readonly hint?: ReactNode;
  readonly autoFocus?: boolean;
}

/**
 * Whole-number field (SPEC §12.5): numeric keyboard, grouped digits, no negatives or
 * fractions. An invalid entry keeps the typed text, shows why and reports `null`.
 */
export function NumberField({
  label,
  value,
  onChange,
  placeholder,
  hint,
  autoFocus,
}: NumberFieldProps) {
  const { t } = useTranslation();
  const language = useLanguage();
  const id = useId();
  // The typed text wins while it still stands for `value`; otherwise `value` was set from
  // outside (a quick button) and is shown formatted.
  const [draft, setDraft] = useState<string | null>(null);
  const parsed = draft === null ? null : parseIntegerInput(draft, language);
  const draftShown = parsed !== null && (parsed.ok ? parsed.value === value : value === null);
  const text = draftShown ? (draft ?? '') : formatIntegerInput(value, language);
  const error: IntegerInputError | undefined = draftShown && !parsed.ok ? parsed.error : undefined;

  return (
    <label className="field" htmlFor={id}>
      <span className="field-label">{label}</span>
      <input
        id={id}
        className={error ? 'input input-invalid' : 'input'}
        inputMode="numeric"
        autoComplete="off"
        value={text}
        placeholder={placeholder}
        autoFocus={autoFocus}
        aria-invalid={error !== undefined}
        onChange={(event) => {
          const next = parseIntegerInput(event.target.value, language);
          setDraft(next.ok ? formatIntegerInput(next.value, language) : event.target.value);
          onChange(next.ok ? next.value : null);
        }}
      />
      {error ? (
        <span className="field-error" role="alert">
          {t(`number.${error}`)}
        </span>
      ) : hint !== undefined ? (
        <span className="field-hint">{hint}</span>
      ) : null}
    </label>
  );
}
