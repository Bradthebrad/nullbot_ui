// Structural pieces shared by the non-chat views: a list pane beside a
// detail pane, list rows, detail headers and sections.
import type {KeyboardEvent, ReactNode} from 'react';
import {statusText, statusTone, type Tone} from '../lib/format';

export function Panes({list, detail, label, listWidth}: {list: ReactNode; detail: ReactNode; label: string; listWidth?: number}) {
  return (
    <div className="panes" style={listWidth ? ({'--list-w': `${listWidth}px`} as React.CSSProperties) : undefined}>
      <div className="pane-list" role="group" aria-label={label} onKeyDown={moveFocus}>{list}</div>
      <div className="pane-detail">{detail}</div>
    </div>
  );
}

/** Arrow keys move between rows in a list pane. */
function moveFocus(event: KeyboardEvent<HTMLDivElement>) {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
  const rows = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('.list-row'));
  const index = rows.indexOf(document.activeElement as HTMLButtonElement);
  if (index < 0) return;
  event.preventDefault();
  const next = rows[Math.max(0, Math.min(rows.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))];
  next?.focus();
  next?.click();
}

export function ListGroup({title, children, count}: {title: ReactNode; children: ReactNode; count?: number}) {
  return (
    <div className="list-group">
      <div className="list-group-title">
        <span>{title}</span>
        {count != null && <span className="num faint">{count}</span>}
      </div>
      {children}
    </div>
  );
}

export function ListRow({selected, onSelect, tone, title, subtitle, meta, aside}: {
  selected?: boolean;
  onSelect: () => void;
  tone?: Tone;
  title: ReactNode;
  subtitle?: ReactNode;
  meta?: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <button type="button" className={selected ? 'list-row selected' : 'list-row'} aria-current={selected ? 'true' : undefined} onClick={onSelect}>
      {tone && <span className={`dot ${tone}`} aria-hidden="true" />}
      <span className="list-row-main">
        <span className="list-row-title">{title}</span>
        {subtitle && <span className="list-row-sub">{subtitle}</span>}
      </span>
      {(meta || aside) && (
        <span className="list-row-meta">
          {meta && <span className="num">{meta}</span>}
          {aside}
        </span>
      )}
    </button>
  );
}

export function DetailHeader({title, subtitle, status, actions}: {title: ReactNode; subtitle?: ReactNode; status?: string; actions?: ReactNode}) {
  return (
    <header className="detail-header">
      <div className="detail-heading">
        <h2>{title}</h2>
        {(status || subtitle) && (
          <div className="detail-sub">
            {status && <StatusTag status={status} />}
            {subtitle && <span className="muted">{subtitle}</span>}
          </div>
        )}
      </div>
      {actions && <div className="detail-actions">{actions}</div>}
    </header>
  );
}

export function Section({title, actions, children, className = ''}: {title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string}) {
  return (
    <section className={`section ${className}`}>
      {(title || actions) && (
        <div className="section-head">
          {title && <h3>{title}</h3>}
          {actions && <div className="section-actions">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function StatusTag({status, label}: {status?: string; label?: string}) {
  const tone = statusTone(status);
  const cls = tone === 'ok' ? 'ok' : tone === 'bad' ? 'bad' : tone === 'live' ? 'warn' : '';
  return (
    <span className={`tag ${cls}`}>
      <span className={`dot ${tone}`} aria-hidden="true" />
      {label || statusText(status)}
    </span>
  );
}

/** Label/value pairs laid out as a two-column grid. */
export function Facts({items}: {items: [ReactNode, ReactNode][]}) {
  const shown = items.filter(([, value]) => value !== undefined && value !== null && value !== '' && value !== false);
  if (!shown.length) return null;
  return (
    <dl className="facts">
      {shown.map(([label, value], index) => (
        <div key={index}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Blank({title, children, action}: {title: ReactNode; children?: ReactNode; action?: ReactNode}) {
  return (
    <div className="blank">
      <strong>{title}</strong>
      {children && <p className="muted">{children}</p>}
      {action}
    </div>
  );
}

export function Spinner({label}: {label?: string}) {
  return (
    <span className="spinner-line" role="status">
      <span className="spinner" aria-hidden="true" />
      {label}
    </span>
  );
}
