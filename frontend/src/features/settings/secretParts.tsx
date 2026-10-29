// Pieces Settings > Secrets and the cloud accounts share: the editor that
// adds or changes a secret, the agent toggle and the remove button. Values
// go in and never come back: the bridge returns names, kinds and public
// details only.
import {useEffect, useRef, useState, type ChangeEvent, type FormEvent} from 'react';
import {FileUp} from 'lucide-react';
import {api} from '../../lib/bindings';
import {useStore} from '../../lib/store';
import {appStore} from '../../state/app';
import type {SecretInfo, SecretInput, SecretKind} from '../../lib/types';
import {confirmDialog} from '../../ui/dialogs';
import {toast, toastError} from '../../ui/toast';

export const message = (err: unknown) => String(err instanceof Error ? err.message : err);

/** base, or base-2, base-3… whichever no secret has yet. */
export function freeName(base: string, taken: string[]) {
  if (!taken.includes(base)) return base;
  for (let n = 2; ; n++) if (!taken.includes(`${base}-${n}`)) return `${base}-${n}`;
}

export function toInput(secret: SecretInfo): SecretInput {
  return {name: secret.name, kind: secret.kind, description: secret.description || '', agent_use: secret.agent_use, servers: secret.servers || [], values: {}};
}

export function AgentToggle({secret, compact}: {secret: SecretInfo; compact?: boolean}) {
  const [busy, setBusy] = useState(false);
  async function change(next: boolean) {
    if (next && !(await confirmDialog({
      title: `Let agents use ${secret.name}?`,
      body: <p>Agents will be able to run commands with this secret in their environment, in projects that allow running programs. They never see the value, but a command can use it to act for you.</p>,
      confirmLabel: 'Allow',
    }))) return;
    setBusy(true);
    try {
      await api.saveSecret({...toInput(secret), agent_use: next});
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  }
  return (
    <label className={compact ? 'check compact' : 'check'}>
      <input type="checkbox" checked={secret.agent_use} disabled={busy} onChange={event => void change(event.target.checked)} />
      {compact ? <span className="sr-only">Agents may use {secret.name}</span> : 'Agents may use'}
    </label>
  );
}

const issuer: Record<string, string> = {github_token: 'GitHub', aws: 'AWS (in IAM)', gcp: 'Google Cloud (in IAM)'};

export function RemoveButton({secret, small}: {secret: SecretInfo; small?: boolean}) {
  async function remove() {
    const ok = await confirmDialog({
      title: `Remove ${secret.name}?`,
      body: <p>The secret is deleted from this computer. This does not revoke it with {issuer[secret.kind] || 'the service that issued it'}; do that there.</p>,
      confirmLabel: 'Remove',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.removeSecret(secret.name);
      toast(`Removed ${secret.name}.`);
    } catch (err) {
      toastError(err);
    }
  }
  return <button className={small ? 'btn btn-sm' : 'btn'} aria-label={`Remove ${secret.name}`} onClick={() => void remove()}>Remove</button>;
}

/** Key files are small; anything larger is not one. */
const maxKeyFile = 64 * 1024;

function readText(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

type EditorProps = {
  kinds: SecretKind[];
  initialKind?: string;
  /** For a new secret: its suggested name and public fields. */
  initialName?: string;
  initialPublic?: Record<string, string>;
  /** Hides the kind picker, for an editor opened to add one kind. */
  lockKind?: boolean;
  title?: string;
  /** Replaces the kind's own description. */
  description?: string;
  /** Leaves out giving the secret to tool servers (kept as it was). */
  noServers?: boolean;
  secret?: SecretInfo;
  onClose: () => void;
  onSaved: (saved: SecretInfo) => void;
};

export function SecretEditor({kinds, initialKind, initialName, initialPublic, lockKind, title, description: intro, noServers, secret, onClose, onSaved}: EditorProps) {
  const servers = useStore(appStore, state => state.mcp);
  const ref = useRef<HTMLDialogElement>(null);
  const [kindID, setKindID] = useState(secret?.kind || initialKind || 'generic');
  const [name, setName] = useState(secret?.name || initialName || '');
  const [description, setDescription] = useState(secret?.description || '');
  const [values, setValues] = useState<Record<string, string>>({});
  const [publicFields, setPublic] = useState<Record<string, string>>({...(secret?.public || initialPublic || {})});
  const [agentUse, setAgentUse] = useState(secret ? secret.agent_use : false);
  const [bound, setBound] = useState<string[]>(secret?.servers || []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const kind = kinds.find(k => k.kind === kindID) || kinds[0];
  const fileBased = kind.file_based || (kind.kind === 'generic' && publicFields.as_file === 'yes');
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = ref.current;
    dialog?.showModal?.();
    return () => {
      dialog?.close?.();
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (agentUse && !secret?.agent_use && !(await confirmDialog({
      title: 'Let agents use this secret?',
      body: <p>Agents will be able to run commands with it in their environment, in projects that allow running programs. They never see the value.</p>,
      confirmLabel: 'Allow',
    }))) return;
    setBusy(true);
    setError('');
    const pub: Record<string, string> = {};
    for (const field of kind.fields) if (!field.secret && !field.derived) pub[field.name] = publicFields[field.name] || '';
    try {
      const saved = await api.saveSecret({name: name.trim(), kind: kind.kind, description, values, public: pub, agent_use: agentUse, servers: fileBased ? [] : bound});
      setValues({});
      toast(`${secret ? 'Saved' : 'Added'} ${name.trim()}.`, 'success');
      onSaved(saved);
    } catch (err) {
      // Backend messages name fields, never values; the inputs are cleared anyway.
      setValues({});
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }
  const set = (field: string, value: string) => setValues(current => ({...current, [field]: value}));
  async function readFile(field: string, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > maxKeyFile) {
      setError(`${file.name} is larger than a key file; choose the key itself.`);
      return;
    }
    try {
      set(field, await readText(file));
      setError('');
    } catch {
      setError(`${file.name} could not be read.`);
    }
  }
  return (
    <dialog ref={ref} className="modal modal-wide secret-editor" aria-labelledby="secret-editor-title" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
      <form onSubmit={submit} autoComplete="off">
        <h2 id="secret-editor-title">{secret ? `Change ${secret.name}` : title || 'Add a secret'}</h2>
        <div className="modal-body">
          {!secret && !lockKind && (
            <label className="field">
              <span>Kind</span>
              <select className="select" value={kindID} onChange={event => { setKindID(event.target.value); setValues({}); }}>
                {kinds.map(k => <option key={k.kind} value={k.kind}>{k.label}</option>)}
              </select>
            </label>
          )}
          <p className="muted">{intro || kind.description}</p>
          <label className="field">
            <span>Name</span>
            <input className="input mono" value={name} disabled={!!secret} onChange={event => setName(event.target.value)} placeholder="aws-prod" required />
          </label>
          {kind.fields.filter(f => !f.derived).map(field => {
            const saved = !!secret?.set.includes(field.name);
            const label = `${field.label}${field.required ? '' : ' (optional)'}`;
            if (!field.secret) {
              return (
                <label className="field" key={field.name}>
                  <span>{label}</span>
                  <input className="input mono" value={publicFields[field.name] || ''} placeholder={field.hint} onChange={event => setPublic(current => ({...current, [field.name]: event.target.value}))} />
                </label>
              );
            }
            const placeholder = saved ? 'Saved; leave empty to keep it' : field.hint || '';
            // A key that comes as a file (a private key, a service account's
            // JSON) can be read from it instead of pasted.
            const fromFile = field.multiline && kind.file_based;
            return (
              <div key={field.name}>
                <label className="field">
                  <span>{label}</span>
                  {field.multiline ? (
                    <textarea className="textarea mono secret-text" rows={5} spellCheck={false} value={values[field.name] || ''} placeholder={placeholder} onChange={event => set(field.name, event.target.value)} required={field.required && !saved} />
                  ) : (
                    <input className="input mono" type="password" autoComplete="new-password" spellCheck={false} value={values[field.name] || ''} placeholder={placeholder} onChange={event => set(field.name, event.target.value)} required={field.required && !saved} />
                  )}
                </label>
                {fromFile && (
                  <label className="btn btn-sm file-pick">
                    <FileUp size={13} aria-hidden="true" />
                    {kind.kind === 'gcp' ? 'Choose the key file…' : 'Choose a file…'}
                    <input type="file" className="sr-only" accept={kind.kind === 'gcp' ? '.json,application/json' : undefined} onChange={event => void readFile(field.name, event)} />
                  </label>
                )}
              </div>
            );
          })}
          <label className="field">
            <span>Description (optional)</span>
            <input className="input" value={description} onChange={event => setDescription(event.target.value)} placeholder="What it is for; never the secret itself" />
          </label>
          <label className="check"><input type="checkbox" checked={agentUse} onChange={event => setAgentUse(event.target.checked)} />Agents may use it with secret_run{kind.kind === 'aws' || kind.kind === 'gcp' ? ' and cloud plans' : ''}</label>
          {!fileBased && !noServers && servers.length > 0 && (
            <fieldset className="server-picks">
              <legend>Give it to these tool servers when they start</legend>
              {servers.map(server => (
                <label className="check" key={server.id}>
                  <input type="checkbox" checked={bound.includes(server.id)} onChange={event => setBound(current => event.target.checked ? [...current, server.id] : current.filter(id => id !== server.id))} />
                  {server.name || server.id}
                </label>
              ))}
            </fieldset>
          )}
          {fileBased && <p className="faint">Passed to commands as a temporary file, which tool servers cannot get.</p>}
          {error && <p className="notice bad" role="alert">{error}</p>}
        </div>
        <div className="modal-actions">
          <button type="button" className="btn" disabled={busy} onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy || !name.trim()}>{busy ? 'Saving…' : secret ? 'Save' : 'Add'}</button>
        </div>
      </form>
    </dialog>
  );
}
