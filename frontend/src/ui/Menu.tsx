import {useEffect, useId, useRef, useState, type ReactNode} from 'react';

export type MenuItem =
  | {kind?: 'item'; label: ReactNode; hint?: ReactNode; onSelect: () => void; disabled?: boolean; checked?: boolean; danger?: boolean}
  | {kind: 'separator'}
  | {kind: 'heading'; label: ReactNode};

/** A button that opens a small menu. Keyboard: arrows, Enter, Escape. */
export function MenuButton({label, items, className = 'btn', align = 'start', placement = 'below', title, disabled}: {
  label: ReactNode;
  items: MenuItem[] | (() => MenuItem[]);
  className?: string;
  align?: 'start' | 'end';
  placement?: 'below' | 'above';
  title?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    window.setTimeout(() => root.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not([disabled])')?.focus(), 0);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const list = open ? (typeof items === 'function' ? items() : items) : [];
  function onKeyDown(event: React.KeyboardEvent) {
    if (!open) return;
    const buttons = Array.from(root.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])') || []);
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      root.current?.querySelector<HTMLButtonElement>('[aria-haspopup]')?.focus();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      buttons[(index + 1) % buttons.length]?.focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      buttons[(index - 1 + buttons.length) % buttons.length]?.focus();
    }
  }
  return (
    <div className="menu-root" ref={root} onKeyDown={onKeyDown}>
      <button type="button" className={className} aria-haspopup="menu" aria-expanded={open} aria-controls={id} title={title} disabled={disabled} onClick={() => setOpen(value => !value)}>
        {label}
      </button>
      {open && (
        <div id={id} role="menu" className={`menu menu-${align} menu-${placement}`}>
          {list.map((item, index) => {
            if (item.kind === 'separator') return <div key={index} className="menu-separator" role="separator" />;
            if (item.kind === 'heading') return <div key={index} className="menu-heading">{item.label}</div>;
            return (
              <button
                key={index}
                type="button"
                role="menuitem"
                className={`menu-item ${item.danger ? 'danger' : ''}`}
                disabled={item.disabled}
                aria-checked={item.checked}
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
              >
                <span className="menu-check" aria-hidden="true">{item.checked ? '✓' : ''}</span>
                <span className="menu-label">{item.label}</span>
                {item.hint && <span className="menu-hint">{item.hint}</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** A menu at the pointer, for right-click actions. */
export function ContextMenu({x, y, items, onClose}: {x: number; y: number; items: MenuItem[]; onClose: () => void}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({x, y});
  useEffect(() => {
    const el = ref.current;
    if (el) {
      const rect = el.getBoundingClientRect();
      setPos({x: Math.min(x, window.innerWidth - rect.width - 8), y: Math.min(y, window.innerHeight - rect.height - 8)});
      el.querySelector<HTMLButtonElement>('[role="menuitem"]:not([disabled])')?.focus();
    }
    const close = (event: Event) => {
      if (event.type === 'keydown' && (event as KeyboardEvent).key !== 'Escape') return;
      if (event.type === 'mousedown' && ref.current?.contains(event.target as Node)) return;
      onClose();
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    window.addEventListener('blur', onClose);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
      window.removeEventListener('blur', onClose);
      window.removeEventListener('resize', onClose);
    };
  }, [x, y, onClose]);
  return (
    <div ref={ref} role="menu" className="menu menu-context" style={{left: pos.x, top: pos.y}} onKeyDown={event => {
      const buttons = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])') || []);
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (event.key === 'ArrowDown') {event.preventDefault(); buttons[(index + 1) % buttons.length]?.focus();}
      if (event.key === 'ArrowUp') {event.preventDefault(); buttons[(index - 1 + buttons.length) % buttons.length]?.focus();}
    }}>
      {items.map((item, index) => {
        if (item.kind === 'separator') return <div key={index} className="menu-separator" role="separator" />;
        if (item.kind === 'heading') return <div key={index} className="menu-heading">{item.label}</div>;
        return (
          <button key={index} type="button" role="menuitem" className={`menu-item ${item.danger ? 'danger' : ''}`} disabled={item.disabled} onClick={() => {onClose(); item.onSelect();}}>
            <span className="menu-check" aria-hidden="true">{item.checked ? '✓' : ''}</span>
            <span className="menu-label">{item.label}</span>
            {item.hint && <span className="menu-hint">{item.hint}</span>}
          </button>
        );
      })}
    </div>
  );
}
