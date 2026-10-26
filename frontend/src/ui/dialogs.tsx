// In-app replacements for window.confirm/window.prompt, using native modal
// <dialog> for focus trapping and Escape handling.
import {useEffect, useRef, useState, type ReactNode} from 'react';
import {createStore, useStore} from '../lib/store';

type ConfirmRequest = {kind: 'confirm'; title: string; body?: ReactNode; confirmLabel: string; danger?: boolean; resolve: (value: boolean) => void};
type PromptRequest = {kind: 'prompt'; title: string; body?: ReactNode; label: string; initial: string; placeholder?: string; confirmLabel: string; optional?: boolean; resolve: (value: string | null) => void};
type Request = ConfirmRequest | PromptRequest;

const dialogStore = createStore<{queue: Request[]}>({queue: []});

export function confirmDialog(options: {title: string; body?: ReactNode; confirmLabel?: string; danger?: boolean}): Promise<boolean> {
  return new Promise(resolve => {
    dialogStore.set(state => ({queue: [...state.queue, {kind: 'confirm', confirmLabel: 'Confirm', ...options, resolve}]}));
  });
}

export function promptDialog(options: {title: string; label: string; initial?: string; placeholder?: string; body?: ReactNode; confirmLabel?: string; optional?: boolean}): Promise<string | null> {
  return new Promise(resolve => {
    dialogStore.set(state => ({queue: [...state.queue, {kind: 'prompt', initial: '', confirmLabel: 'Save', ...options, resolve}]}));
  });
}

function finish(request: Request, value: any) {
  dialogStore.set(state => ({queue: state.queue.filter(item => item !== request)}));
  (request.resolve as (value: unknown) => void)(value);
}

export function DialogHost() {
  const current = useStore(dialogStore, state => state.queue[0]);
  if (!current) return null;
  return <ModalDialog key={String(current.title) + current.kind} request={current} />;
}

function ModalDialog({request}: {request: Request}) {
  const ref = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(request.kind === 'prompt' ? request.initial : '');
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = ref.current;
    dialog?.showModal?.();
    window.setTimeout(() => (request.kind === 'prompt' ? inputRef.current?.select() : dialog?.querySelector<HTMLButtonElement>('[data-autofocus]')?.focus()), 0);
    return () => {
      dialog?.close?.();
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  const cancel = () => finish(request, request.kind === 'prompt' ? null : false);
  return (
    <dialog ref={ref} className="modal" aria-labelledby="modal-title" onCancel={event => {
      event.preventDefault();
      cancel();
    }}>
      <form method="dialog" onSubmit={event => {
        event.preventDefault();
        if (request.kind === 'prompt') {
          if (!value.trim() && !request.optional) return;
          finish(request, value.trim());
        } else finish(request, true);
      }}>
        <h2 id="modal-title">{request.title}</h2>
        {request.body && <div className="modal-body">{request.body}</div>}
        {request.kind === 'prompt' && (
          <label className="field">
            <span>{request.label}</span>
            <input ref={inputRef} className="input" value={value} placeholder={request.placeholder} onChange={event => setValue(event.target.value)} />
          </label>
        )}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={cancel}>Cancel</button>
          <button type="submit" data-autofocus className={`btn ${request.kind === 'confirm' && request.danger ? 'btn-danger-solid' : 'btn-primary'}`} disabled={request.kind === 'prompt' && !request.optional && !value.trim()}>
            {request.confirmLabel}
          </button>
        </div>
      </form>
    </dialog>
  );
}
