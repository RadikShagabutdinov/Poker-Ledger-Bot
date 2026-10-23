import { useId, type ReactNode } from 'react';

export interface TextFieldProps {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly placeholder?: string;
  readonly maxLength?: number;
  readonly autoFocus?: boolean;
  readonly type?: 'text' | 'search';
  readonly inputMode?: 'text' | 'tel';
  readonly autoCapitalize?: 'off' | 'characters';
  readonly list?: string;
  /** Shown under the field unless there is an error. */
  readonly hint?: ReactNode;
  readonly error?: string | undefined;
}

export function TextField({
  label,
  value,
  onChange,
  type = 'text',
  hint,
  error,
  ...rest
}: TextFieldProps) {
  const id = useId();
  const note = error ?? hint;
  return (
    <label className="field" htmlFor={id}>
      <span className="field-label" id={`${id}-label`}>
        {label}
      </span>
      <input
        id={id}
        // The label also wraps the hint; name the input by the label text alone.
        aria-labelledby={`${id}-label`}
        {...(note !== undefined ? { 'aria-describedby': `${id}-note` } : {})}
        className={error !== undefined ? 'input input-invalid' : 'input'}
        type={type}
        value={value}
        aria-invalid={error !== undefined}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        {...rest}
      />
      {error !== undefined ? (
        <span className="field-error" id={`${id}-note`} role="alert">
          {error}
        </span>
      ) : hint !== undefined ? (
        <span className="field-hint" id={`${id}-note`}>
          {hint}
        </span>
      ) : null}
    </label>
  );
}
