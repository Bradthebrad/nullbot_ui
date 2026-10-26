import {X} from 'lucide-react';
import {createStore, useStore} from '../lib/store';

export type Toast = {id: number; message: string; kind: 'info' | 'error' | 'success'};

const toastStore = createStore<{toasts: Toast[]}>({toasts: []});
let nextID = 1;

export function toast(message: string, kind: Toast['kind'] = 'info') {
  const text = String(message || '').replace(/^Error:\s*/, '').trim();
  if (!text) return;
  const id = nextID++;
  toastStore.set(state => ({toasts: [...state.toasts.filter(t => t.message !== text), {id, message: text, kind}].slice(-4)}));
  window.setTimeout(() => dismiss(id), kind === 'error' ? 8000 : 3500);
}

export function toastError(error: unknown) {
  toast(error instanceof Error ? error.message : String(error), 'error');
}

function dismiss(id: number) {
  toastStore.set(state => ({toasts: state.toasts.filter(t => t.id !== id)}));
}

export function ToastHost() {
  const toasts = useStore(toastStore, state => state.toasts);
  return (
    <div className="toast-host" role="status" aria-live="polite">
      {toasts.map(item => (
        <div key={item.id} className={`toast toast-${item.kind}`}>
          <span>{item.message}</span>
          <button className="btn btn-ghost btn-icon btn-sm" aria-label="Dismiss" onClick={() => dismiss(item.id)}>
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
