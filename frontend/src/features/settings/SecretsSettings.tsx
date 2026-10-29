// Settings > Secrets: the encrypted vault, GitHub credentials and every
// other secret. Values go in and never come back: the bridge returns names,
// kinds and public details only.
import {useEffect, useRef, useState, type FormEvent, type ReactNode} from 'react';
import {Copy, KeyRound, Lock, Plus, RefreshCw} from 'lucide-react';
import {api} from '../../lib/bindings';
import {useResource} from '../../lib/useResource';
import {useStore} from '../../lib/store';
import {appStore} from '../../state/app';
import type {SecretInfo, SecretInput, SecretKind, VaultInfo} from '../../lib/types';
import {confirmDialog} from '../../ui/dialogs';
import {StatusTag} from '../../ui/layout';
import {toast, toastError} from '../../ui/toast';

const message = (err: unknown) => String(err instanceof Error ? err.message : err);

export function SecretsSettings() {
  const vault = useResource(api.vaultStatus, {topics: ['secrets']});
  const secrets = useResource(api.secrets, {topics: ['secrets']});
  const kinds = useResource(api.secretKinds);
  const [editing, setEditing] = useState<{kind?: string; secret?: SecretInfo} | null>(null);
  const reload = () => {
    vault.reload();
    secrets.reload();
  };
  const list = secrets.data || [];
  const tokens = list.filter(s => s.kind === 'github_token');
  const keys = list.filter(s => s.kind === 'ssh_key');
  const info = vault.data;
  const open = !!info && (!info.exists || info.unlocked);

  return (
    <section className="secrets">
      <header className="settings-head settings-head-row">
        <div>
          <h2>Secrets</h2>
          <p className="muted">Kept encrypted on this computer. Agents can use a secret you allow without seeing it: they run commands with it, and its value is removed from everything they read.</p>
        </div>
        <button className="btn" onClick={reload}><RefreshCw size={13} />Check again</button>
      </header>
      {info && <VaultPanel info={info} onChange={next => vault.setData(next)} onReload={reload} />}
      {secrets.error && open && <p className="notice bad">{secrets.error}</p>}

      {open && (
        <>
          <div className="settings-group">
            <div className="settings-group-head">
              <h3>GitHub</h3>
            </div>
            <p className="muted">A token lets commands use <span className="mono">gh</span> and push over HTTPS; an SSH key signs git in over SSH. Each is given only to the commands that ask for it.</p>
            <div className="account-list">
              {tokens.map(token => <TokenRow key={token.name} token={token} onEdit={() => setEditing({secret: token})} />)}
              {tokens.length === 0 && <NewTokenRow />}
              {keys.map(key => <SSHKeyRow key={key.name} sshKey={key} tokens={tokens} onEdit={() => setEditing({secret: key})} />)}
              <SSHKeyActions taken={list.map(s => s.name)} hasKeys={keys.length > 0} onImport={() => setEditing({kind: 'ssh_key'})} />
            </div>
          </div>

          <div className="settings-group">
            <div className="settings-group-head">
              <h3>All secrets</h3>
              <button className="btn" onClick={() => setEditing({})}><Plus size={13} />Add a secret</button>
            </div>
            <p className="muted">Provider keys from Accounts are here too. Turn on <em>Agents may use</em> only for secrets an agent should act with.</p>
            {list.length === 0 ? (
              <p className="faint">No secrets yet.</p>
            ) : (
              <table className="table secrets-table">
                <thead>
                  <tr><th>Name</th><th>Kind</th><th>Gives commands</th><th>Agents may use</th><th><span className="sr-only">Actions</span></th></tr>
                </thead>
                <tbody>
                  {list.map(secret => <SecretRow key={secret.name} secret={secret} onEdit={() => setEditing({secret})} />)}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
      {editing && kinds.data && (
        <SecretEditor kinds={kinds.data} initialKind={editing.kind} secret={editing.secret} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />
      )}
    </section>
  );
}

// ------------------------------------------------------------------- vault

function VaultPanel({info, onChange, onReload}: {info: VaultInfo; onChange: (info: VaultInfo) => void; onReload: () => void}) {
  const [passphrase, setPassphrase] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function run(action: () => Promise<VaultInfo>, done: string) {
    setBusy(true);
    setError('');
    try {
      onChange(await action());
      setPassphrase('');
      setAgain('');
      toast(done, 'success');
      onReload();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }
  const locked = info.exists && !info.unlocked;
  const needsPassphrase = !info.exists && !info.keychain;
  let summary: ReactNode;
  if (!info.exists) {
    summary = info.keychain ? <>Made when you save the first secret, protected by {info.keychain_label}.</> : <>This system has no keychain NullBot can use. Set a passphrase to make the vault.</>;
  } else if (locked) {
    summary = <>Protected by {info.protection_label || 'a passphrase'}, and locked.</>;
  } else {
    summary = <>Protected by {info.protection_label}. {info.secrets === 1 ? '1 secret' : `${info.secrets} secrets`}.</>;
  }
  return (
    <div className="vault-panel">
      <div className="vault-line">
        <KeyRound size={15} aria-hidden="true" />
        <div className="vault-text">
          <strong>{summary}</strong>
          <span className="mono faint">{info.path}</span>
        </div>
        {info.exists && info.unlocked && info.protection === 'passphrase' && (
          <button className="btn" disabled={busy} onClick={() => void run(api.lockVault, 'Vault locked.')}><Lock size={13} />Lock</button>
        )}
      </div>
      {locked && (
        <form className="inline-form" onSubmit={(event: FormEvent) => { event.preventDefault(); if (passphrase) void run(() => api.unlockVault(passphrase), 'Vault unlocked.'); }}>
          <input className="input" type="password" autoComplete="current-password" value={passphrase} onChange={event => setPassphrase(event.target.value)} placeholder="Passphrase" aria-label="Vault passphrase" />
          <button className="btn btn-primary" type="submit" disabled={busy || !passphrase}>Unlock</button>
        </form>
      )}
      {needsPassphrase && (
        <form className="inline-form" onSubmit={(event: FormEvent) => { event.preventDefault(); void run(() => api.createVault('passphrase', passphrase), 'Vault created.'); }}>
          <input className="input" type="password" autoComplete="new-password" value={passphrase} onChange={event => setPassphrase(event.target.value)} placeholder="New passphrase (8 or more characters)" aria-label="New vault passphrase" />
          <input className="input" type="password" autoComplete="new-password" value={again} onChange={event => setAgain(event.target.value)} placeholder="Type it again" aria-label="Type the passphrase again" />
          <button className="btn btn-primary" type="submit" disabled={busy || passphrase.length < 8 || passphrase !== again}>Make the vault</button>
        </form>
      )}
      {locked && <p className="faint">On a server, set NULLBOT_VAULT_PASSPHRASE or NULLBOT_VAULT_PASSPHRASE_FILE instead.</p>}
      {(info.plaintext || []).map(path => (
        <p key={path} className="notice warn">Still in plain text: <span className="mono">{path}</span>. It moves into the vault once the vault can be written{info.keychain ? '' : ' (set a passphrase above)'}.</p>
      ))}
      {error && <p className="notice bad" role="alert">{error}</p>}
    </div>
  );
}

// ------------------------------------------------------------------ GitHub

function TokenRow({token, onEdit}: {token: SecretInfo; onEdit: () => void}) {
  const [checking, setChecking] = useState(false);
  const login = token.public?.login;
  const host = token.public?.host || 'github.com';
  async function check() {
    setChecking(true);
    try {
      const id = await api.verifyGitHubToken(token.name);
      toast(`Signs in to ${id.host} as ${id.login}.`, 'success');
    } catch (err) {
      toastError(err);
    } finally {
      setChecking(false);
    }
  }
  return (
    <div className="account">
      <div className="account-main">
        <strong>Token <span className="mono">{token.name}</span></strong>
        <p className="muted">
          {login ? <>Signs in to {host} as <strong>{login}</strong>{token.public?.scopes ? <>; scopes: <span className="mono">{token.public.scopes}</span></> : null}.</> : <>Not checked yet. Check asks {host} who the token belongs to.</>}
        </p>
        <div className="row-actions">
          <button className="btn" disabled={checking} onClick={() => void check()}>{checking ? <span className="spinner" /> : null}Check</button>
          <button className="btn" onClick={onEdit}>Replace or change</button>
          <RemoveButton secret={token} />
        </div>
      </div>
      <div className="account-state">
        <StatusTag status={login ? 'ok' : 'idle'} label={login ? 'Checked' : 'Saved'} />
        {token.hint && <span className="mono faint">{token.hint}</span>}
        <AgentToggle secret={token} />
      </div>
    </div>
  );
}

function NewTokenRow() {
  const [name, setName] = useState('github');
  const [value, setValue] = useState('');
  const [host, setHost] = useState('');
  const [agents, setAgents] = useState(true);
  const [saving, setSaving] = useState(false);
  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      await api.saveSecret({name: name.trim(), kind: 'github_token', values: {token: value.trim()}, public: host.trim() ? {host: host.trim()} : {}, agent_use: agents});
      setValue('');
      toast('GitHub token saved. Check it to see who it signs in as.', 'success');
      try {
        await api.verifyGitHubToken(name.trim());
      } catch {
        /* checking is optional; the row offers it again */
      }
    } catch (err) {
      toastError(err);
    } finally {
      setSaving(false);
    }
  }
  return (
    <form className="account" onSubmit={save}>
      <div className="account-main">
        <strong>Add a GitHub token</strong>
        <p className="muted">A fine-grained token limited to the repositories NullBot should touch is safest. It is checked with GitHub after saving.</p>
        <div className="inline-form">
          <input className="input mono narrow" value={name} onChange={event => setName(event.target.value)} aria-label="Name" placeholder="Name" />
          <input className="input mono" type="password" autoComplete="off" value={value} onChange={event => setValue(event.target.value)} placeholder="github_pat_… or ghp_…" aria-label="GitHub token" />
          <input className="input mono narrow" value={host} onChange={event => setHost(event.target.value)} placeholder="github.com" aria-label="Host" />
        </div>
        <label className="check"><input type="checkbox" checked={agents} onChange={event => setAgents(event.target.checked)} />Agents may use it</label>
        <div className="row-actions"><button className="btn btn-primary" type="submit" disabled={saving || !name.trim() || !value.trim()}>Save token</button></div>
      </div>
    </form>
  );
}

function SSHKeyRow({sshKey, tokens, onEdit}: {sshKey: SecretInfo; tokens: SecretInfo[]; onEdit: () => void}) {
  const [adding, setAdding] = useState(false);
  const publicKey = sshKey.public?.public_key || '';
  const writable = tokens[0];
  async function addToGitHub() {
    if (!writable) return;
    setAdding(true);
    try {
      await api.addSSHKeyToGitHub(sshKey.name, writable.name);
      toast(`Public key added to ${writable.public?.login || 'the GitHub account'}.`, 'success');
    } catch (err) {
      toastError(err);
    } finally {
      setAdding(false);
    }
  }
  return (
    <div className="account">
      <div className="account-main">
        <strong>SSH key <span className="mono">{sshKey.name}</span></strong>
        <p className="muted">
          {sshKey.public?.added_to ? <>Added to {sshKey.public.added_to}. </> : null}
          Fingerprint <span className="mono">{sshKey.public?.fingerprint}</span>
        </p>
        {publicKey && (
          <div className="public-key">
            <code>{publicKey}</code>
            <button className="btn btn-sm" onClick={() => void navigator.clipboard?.writeText(publicKey).then(() => toast('Public key copied.'))}><Copy size={12} />Copy</button>
          </div>
        )}
        <div className="row-actions">
          {writable && <button className="btn" disabled={adding} onClick={() => void addToGitHub()}>{adding ? <span className="spinner" /> : null}Add to GitHub</button>}
          <button className="btn" onClick={onEdit}>Change</button>
          <RemoveButton secret={sshKey} />
        </div>
      </div>
      <div className="account-state">
        <StatusTag status="ok" label="Saved" />
        <AgentToggle secret={sshKey} />
      </div>
    </div>
  );
}

function freeName(base: string, taken: string[]) {
  if (!taken.includes(base)) return base;
  for (let n = 2; ; n++) if (!taken.includes(`${base}-${n}`)) return `${base}-${n}`;
}

function SSHKeyActions({taken, hasKeys, onImport}: {taken: string[]; hasKeys: boolean; onImport: () => void}) {
  const [name, setName] = useState(() => freeName('github-ssh', taken));
  useEffect(() => {
    setName(current => (taken.includes(current) ? freeName('github-ssh', taken) : current));
  }, [taken.join(',')]);
  const [busy, setBusy] = useState(false);
  async function generate(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const info = await api.generateSSHKey(name.trim(), 'github.com', '', true);
      toast(`Made ${info.name}. Add its public key to GitHub.`, 'success');
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="account" onSubmit={generate}>
      <div className="account-main">
        <strong>{hasKeys ? 'Another SSH key' : 'An SSH key'}</strong>
        <p className="muted">NullBot makes an Ed25519 key and keeps its private half in the vault. Or import a key that has no passphrase.</p>
        <div className="inline-form">
          <input className="input mono narrow" value={name} onChange={event => setName(event.target.value)} aria-label="Key name" placeholder="Name" />
          <button className="btn" type="submit" disabled={busy || !name.trim()}>Make a key</button>
          <button className="btn" type="button" onClick={onImport}>Import a key</button>
        </div>
      </div>
    </form>
  );
}

// -------------------------------------------------------------- all secrets

function SecretRow({secret, onEdit}: {secret: SecretInfo; onEdit: () => void}) {
  const servers = secret.servers || [];
  return (
    <tr>
      <td>
        <span className="mono">{secret.name}</span>
        {secret.description && <span className="faint secret-desc">{secret.description}</span>}
        {secret.created_by === 'agent' && <span className="tag">Made by an agent</span>}
      </td>
      <td>
        {secret.label || secret.kind}
        {secret.hint && <span className="faint secret-desc">{secret.hint}</span>}
      </td>
      <td>
        <span className="mono provides">{secret.provides.join(', ')}</span>
        {servers.length > 0 && <span className="faint secret-desc">Also given to {servers.join(', ')}</span>}
      </td>
      <td><AgentToggle secret={secret} compact /></td>
      <td>
        <div className="row-actions end">
          <button className="btn btn-sm" onClick={onEdit}>Edit</button>
          <RemoveButton secret={secret} small />
        </div>
      </td>
    </tr>
  );
}

function toInput(secret: SecretInfo): SecretInput {
  return {name: secret.name, kind: secret.kind, description: secret.description || '', agent_use: secret.agent_use, servers: secret.servers || [], values: {}};
}

function AgentToggle({secret, compact}: {secret: SecretInfo; compact?: boolean}) {
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

function RemoveButton({secret, small}: {secret: SecretInfo; small?: boolean}) {
  async function remove() {
    const ok = await confirmDialog({
      title: `Remove ${secret.name}?`,
      body: <p>The secret is deleted from this computer. This does not revoke it with {secret.kind === 'github_token' ? 'GitHub' : 'the service that issued it'}; do that there.</p>,
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
  return <button className={small ? 'btn btn-sm' : 'btn'} onClick={() => void remove()}>Remove</button>;
}

// ------------------------------------------------------------------ editor

function SecretEditor({kinds, initialKind, secret, onClose, onSaved}: {kinds: SecretKind[]; initialKind?: string; secret?: SecretInfo; onClose: () => void; onSaved: () => void}) {
  const servers = useStore(appStore, state => state.mcp);
  const ref = useRef<HTMLDialogElement>(null);
  const [kindID, setKindID] = useState(secret?.kind || initialKind || 'generic');
  const [name, setName] = useState(secret?.name || '');
  const [description, setDescription] = useState(secret?.description || '');
  const [values, setValues] = useState<Record<string, string>>({});
  const [publicFields, setPublic] = useState<Record<string, string>>({...(secret?.public || {})});
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
      await api.saveSecret({name: name.trim(), kind: kind.kind, description, values, public: pub, agent_use: agentUse, servers: fileBased ? [] : bound});
      setValues({});
      toast(`${secret ? 'Saved' : 'Added'} ${name.trim()}.`, 'success');
      onSaved();
    } catch (err) {
      // Backend messages name fields, never values; the inputs are cleared anyway.
      setValues({});
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }
  const set = (field: string, value: string) => setValues(current => ({...current, [field]: value}));
  return (
    <dialog ref={ref} className="modal modal-wide secret-editor" aria-labelledby="secret-editor-title" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
      <form onSubmit={submit} autoComplete="off">
        <h2 id="secret-editor-title">{secret ? `Change ${secret.name}` : 'Add a secret'}</h2>
        <div className="modal-body">
          {!secret && (
            <label className="field">
              <span>Kind</span>
              <select className="select" value={kindID} onChange={event => { setKindID(event.target.value); setValues({}); }}>
                {kinds.map(k => <option key={k.kind} value={k.kind}>{k.label}</option>)}
              </select>
            </label>
          )}
          <p className="muted">{kind.description}</p>
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
            return (
              <label className="field" key={field.name}>
                <span>{label}</span>
                {field.multiline ? (
                  <textarea className="textarea mono secret-text" rows={5} spellCheck={false} value={values[field.name] || ''} placeholder={placeholder} onChange={event => set(field.name, event.target.value)} required={field.required && !saved} />
                ) : (
                  <input className="input mono" type="password" autoComplete="new-password" spellCheck={false} value={values[field.name] || ''} placeholder={placeholder} onChange={event => set(field.name, event.target.value)} required={field.required && !saved} />
                )}
              </label>
            );
          })}
          <label className="field">
            <span>Description (optional)</span>
            <input className="input" value={description} onChange={event => setDescription(event.target.value)} placeholder="What it is for; never the secret itself" />
          </label>
          <label className="check"><input type="checkbox" checked={agentUse} onChange={event => setAgentUse(event.target.checked)} />Agents may use it with secret_run</label>
          {!fileBased && servers.length > 0 && (
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
