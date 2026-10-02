import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export interface BottomSheetProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title: string;
  readonly children: ReactNode;
}

/** A panel sliding up from the bottom; a tap on the backdrop closes it. */
export function BottomSheet({ open, onClose, title, children }: BottomSheetProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        <div className="sheet-handle" />
        <h2 className="sheet-title">{title}</h2>
        {children}
      </div>
    </div>,
    document.body,
  );
}
