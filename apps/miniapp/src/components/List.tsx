import type { ReactNode } from 'react';

export function Section({
  title,
  children,
  footer,
}: {
  title?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <section className="section">
      {title !== undefined ? <h2 className="section-title">{title}</h2> : null}
      <div className="section-body">{children}</div>
      {footer !== undefined ? <p className="section-footer">{footer}</p> : null}
    </section>
  );
}

export interface ListItemProps {
  readonly title: ReactNode;
  readonly subtitle?: ReactNode;
  readonly after?: ReactNode;
  readonly onClick?: () => void;
  readonly className?: string;
  readonly id?: string;
}

/** A row of a section; clickable when `onClick` is set. */
export function ListItem({ title, subtitle, after, onClick, className, id }: ListItemProps) {
  const content = (
    <>
      <span className="item-main">
        <span className="item-title">{title}</span>
        {subtitle !== undefined ? <span className="item-subtitle">{subtitle}</span> : null}
      </span>
      {after !== undefined ? <span className="item-after">{after}</span> : null}
    </>
  );
  const classes = ['item', className].filter(Boolean).join(' ');
  return onClick ? (
    <button type="button" id={id} className={`${classes} item-button`} onClick={onClick}>
      {content}
    </button>
  ) : (
    <div id={id} className={classes}>
      {content}
    </div>
  );
}
