// Shared pieces for settings pages that edit part of the config: a draft of
// the paths the page owns, and the form fields.
import {useEffect, useMemo, useState, type ReactNode} from 'react';
import {useStore} from '../../lib/store';
import {api} from '../../lib/bindings';
import {appStore, applyUIState} from '../../state/app';
import {toast, toastError} from '../../ui/toast';
import {useUnsavedEdits} from '../../lib/dirty';

export function getPath(obj: any, path: string) {
  return path.split('.').reduce((cursor, key) => (cursor == null ? undefined : cursor[key]), obj);
}

export function setPath(obj: any, path: string, value: unknown) {
  const parts = path.split('.');
  let cursor = obj;
  for (const part of parts.slice(0, -1)) {
    cursor[part] = cursor[part] && typeof cursor[part] === 'object' ? {...cursor[part]} : {};
    cursor = cursor[part];
  }
  cursor[parts[parts.length - 1]] = value;
}

/**
 * A draft of the config paths a page owns. Saving copies only those paths
 * onto the latest config, so edits made on other pages are never undone.
 */
export function useConfigDraft(key: string, managed: string[]) {
  const config = useStore(appStore, state => state.config);
  const [draft, setDraft] = useState<any>(() => structuredClone(config || {}));
  const [saving, setSaving] = useState(false);
  const baseline = useMemo(() => JSON.stringify(managed.map(path => getPath(config, path) ?? null)), [config]);
  const dirty = baseline !== JSON.stringify(managed.map(path => getPath(draft, path) ?? null));
  useUnsavedEdits(key, dirty);

  // Pick up outside changes when there are no local edits.
  useEffect(() => {
    if (!dirty) setDraft(structuredClone(config || {}));
  }, [config]);

  const set = (path: string, value: unknown) => setDraft((prev: any) => {
    const next = {...prev};
    setPath(next, path, value);
    return next;
  });
  const val = (path: string) => getPath(draft, path);

  async function save(message = 'Settings saved. They apply from the next request.') {
    setSaving(true);
    try {
      const next = structuredClone(appStore.get().config || {});
      for (const path of managed) setPath(next, path, getPath(draft, path));
      applyUIState(await api.saveConfig(next, {}));
      toast(message, 'success');
    } catch (error) {
      toastError(error);
    } finally {
      setSaving(false);
    }
  }

  return {config, draft, set, val, dirty, saving, save, discard: () => setDraft(structuredClone(config || {}))};
}

export function SaveBar({dirty, saving, error, onSave, onDiscard}: {dirty: boolean; saving: boolean; error?: string; onSave: () => void; onDiscard: () => void}) {
  return (
    <footer className={`save-bar ${dirty ? 'is-dirty' : ''}`}>
      <div className="save-bar-text">{error ? <strong className="bad-text">{error}</strong> : dirty ? <strong>You have unsaved changes.</strong> : <span className="muted">Settings are up to date.</span>}</div>
      {dirty && <button className="btn" onClick={onDiscard}>Discard</button>}
      <button className="btn btn-primary" disabled={!dirty || saving || !!error} onClick={onSave}>Save settings</button>
    </footer>
  );
}

export function Group({title, note, children, actions}: {title: string; note?: ReactNode; children: ReactNode; actions?: ReactNode}) {
  return (
    <div className="settings-group">
      <div className="settings-group-head">
        <h3>{title}</h3>
        {actions}
      </div>
      {note && <p className="muted">{note}</p>}
      {children}
    </div>
  );
}

export function NumberField({label, value, onChange, help, min = 0, max, placeholder}: {label: string; value: number | undefined; onChange: (value: number) => void; help?: ReactNode; min?: number; max?: number; placeholder?: string}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input className="input num" type="number" min={min} max={max} placeholder={placeholder} value={value ?? ''} onChange={event => onChange(Number(event.target.value || 0))} />
      {help && <small>{help}</small>}
    </label>
  );
}

export function PercentField({label, value, fallback, onChange, help, max = 95}: {label: string; value: number | undefined; fallback: number; onChange: (value: number) => void; help?: string; max?: number}) {
  return (
    <label className="field">
      <span>{label}</span>
      <span className="input-suffix">
        <input className="input num" type="number" min={10} max={max} value={Math.round((value || fallback) * 100)} onChange={event => onChange(Math.min(max, Math.max(5, Number(event.target.value || 0))) / 100)} />
        <span className="faint">% full</span>
      </span>
      {help && <small>{help}</small>}
    </label>
  );
}

export function TextField({label, value, onChange, placeholder}: {label: string; value: string; onChange: (value: string) => void; placeholder?: string}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input className="input" value={value} placeholder={placeholder} onChange={event => onChange(event.target.value)} />
    </label>
  );
}

export function Check({label, checked, onChange}: {label: string; checked: boolean; onChange: (value: boolean) => void}) {
  return <label className="check"><input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} />{label}</label>;
}
