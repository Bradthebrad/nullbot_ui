import type {ReactNode} from 'react';

export function Tabs<T extends string>({value, onChange, tabs, label}: {value: T; onChange: (value: T) => void; tabs: {id: T; label: ReactNode; count?: number}[]; label: string}) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {tabs.map(tab => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={tab.id === value}
          className={tab.id === value ? 'tab active' : 'tab'}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
          {tab.count ? <span className="tab-count num">{tab.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function Segmented<T extends string>({value, onChange, options, label}: {value: T; onChange: (value: T) => void; options: {id: T; label: ReactNode}[]; label: string}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map(option => (
        <button key={option.id} type="button" role="radio" aria-checked={option.id === value} className={option.id === value ? 'active' : ''} onClick={() => onChange(option.id)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function ViewHeader({title, children, subtitle}: {title: ReactNode; subtitle?: ReactNode; children?: ReactNode}) {
  return (
    <header className="view-header">
      <div className="view-header-text">
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
      </div>
      {children && <div className="view-header-actions">{children}</div>}
    </header>
  );
}
