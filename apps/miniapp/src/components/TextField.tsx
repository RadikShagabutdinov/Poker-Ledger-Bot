import { useId } from 'react';

export interface TextFieldProps {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly placeholder?: string;
  readonly maxLength?: number;
  readonly autoFocus?: boolean;
  readonly type?: 'text' | 'search';
}

export function TextField({ label, value, onChange, type = 'text', ...rest }: TextFieldProps) {
  const id = useId();
  return (
    <label className="field" htmlFor={id}>
      <span className="field-label">{label}</span>
      <input
        id={id}
        className="input"
        type={type}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        {...rest}
      />
    </label>
  );
}
