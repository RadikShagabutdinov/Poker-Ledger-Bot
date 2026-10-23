import { BottomSheet } from './BottomSheet';

export interface Choice<T extends string> {
  readonly id: T;
  readonly label: string;
  readonly hint?: string;
}

/**
 * A question with several answers. The native `popup` would do, but it has no stand-in
 * outside Telegram for more than ok/cancel, so this sheet is used everywhere.
 */
export function ChoiceSheet<T extends string>({
  open,
  title,
  message,
  choices,
  onChoose,
}: {
  open: boolean;
  title: string;
  message: string;
  choices: readonly Choice<T>[];
  /** `null` when dismissed. */
  onChoose: (id: T | null) => void;
}) {
  return (
    <BottomSheet
      open={open}
      onClose={() => {
        onChoose(null);
      }}
      title={title}
    >
      <p className="hint">{message}</p>
      {choices.map((choice) => (
        <button
          key={choice.id}
          type="button"
          className="button button-wide button-choice"
          onClick={() => {
            onChoose(choice.id);
          }}
        >
          <span>{choice.label}</span>
          {choice.hint !== undefined ? <span className="button-sub">{choice.hint}</span> : null}
        </button>
      ))}
    </BottomSheet>
  );
}
