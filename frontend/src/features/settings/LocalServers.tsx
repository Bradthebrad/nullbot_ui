// Model servers you host: Ollama, llama.cpp, LM Studio, vLLM or another
// OpenAI-compatible server, here or on another machine. Each one's models
// join the model lists; Ollama servers can also pull new models.
import {useEffect, useState} from 'react';
import {api} from '../../lib/bindings';
import {onModelPull} from '../../lib/events';
import {formatWindow as formatTokens} from '../../lib/format';
import type {LocalEndpoint, LocalEndpointInfo, LocalModel, LocalServerFound, LocalServerKind, ModelPullEvent, SecretInfo} from '../../lib/types';
import {appStore, refreshState} from '../../state/app';
import {StatusTag} from '../../ui/layout';
import {confirmDialog} from '../../ui/dialogs';
import {toast, toastError} from '../../ui/toast';
import {Group} from './form';

type Pull = ModelPullEvent & {startedAt: number};

const blank: LocalEndpoint = {id: '', kind: 'ollama', base_url: '', name: '', key_secret: ''};

/** After a change, the model lists and the config the other pages save from. */
async function refreshAfterChange() {
  await refreshState().catch(() => undefined);
  appStore.set({models: await api.modelCatalog(true).catch(() => appStore.get().models)});
}

export function LocalServers() {
  const [servers, setServers] = useState<LocalEndpointInfo[] | null>(null);
  const [kinds, setKinds] = useState<LocalServerKind[]>([]);
  const [found, setFound] = useState<LocalServerFound[] | null>(null);
  const [finding, setFinding] = useState(false);
  const [editing, setEditing] = useState<{endpoint: LocalEndpoint; previous: string} | null>(null);
  const [pulls, setPulls] = useState<Record<string, Pull>>({});
  const [checking, setChecking] = useState(false);

  async function load(check = true) {
    setChecking(true);
    try {
      const list = await api.localEndpoints(check);
      setServers(Array.isArray(list) ? list : []);
    } catch (e) {
      toastError(e);
      setServers([]);
    } finally {
      setChecking(false);
    }
  }
  useEffect(() => {
    void load();
    api.localServerKinds().then(list => setKinds(Array.isArray(list) ? list : [])).catch(() => undefined);
    return onModelPull(event => {
      const key = `${event.server}/${event.model}`;
      setPulls(prev => ({...prev, [key]: {...event, startedAt: prev[key]?.startedAt || Date.now()}}));
      if (event.done) {
        if (event.error) toastError(new Error(`Pulling ${event.model}: ${event.error}`));
        else if (event.status === 'success') toast(`Pulled ${event.model}.`, 'success');
        void load().then(refreshAfterChange);
      }
    });
  }, []);

  async function find() {
    setFinding(true);
    try {
      const list = await api.findLocalServers();
      setFound(Array.isArray(list) ? list : []);
    } catch (e) {
      toastError(e);
    } finally {
      setFinding(false);
    }
  }

  async function add(f: LocalServerFound) {
    try {
      const saved = await api.saveLocalEndpoint({id: '', kind: f.kind, base_url: f.base_url});
      toast(`Added ${f.label} as ${saved.id}.`, 'success');
      setFound(prev => prev?.map(x => (x.base_url === f.base_url ? {...x, configured_as: saved.id} : x)) || null);
      await load();
      await refreshAfterChange();
    } catch (e) {
      toastError(e);
    }
  }

  async function remove(server: LocalEndpointInfo) {
    if (!(await confirmDialog({title: `Remove ${server.title}?`, body: 'Its models leave the model lists. Nothing on the server changes.', confirmLabel: 'Remove', danger: true}))) return;
    try {
      await api.removeLocalEndpoint(server.id);
      await load(false);
      await refreshAfterChange();
    } catch (e) {
      toastError(e);
    }
  }

  return (
    <Group
      title="Model servers"
      note="Models you run yourself: Ollama, llama.cpp, LM Studio, vLLM or another OpenAI-compatible server, on this computer or another machine. Their models join the lists below."
      actions={
        <div className="row-actions">
          <button type="button" className="btn" disabled={finding} onClick={() => void find()}>{finding ? 'Looking…' : 'Find servers on this computer'}</button>
          <button type="button" className="btn" onClick={() => setEditing({endpoint: {...blank}, previous: ''})}>Add a server</button>
        </div>
      }
    >
      {found && (
        <div className="local-found" aria-label="Servers found">
          {found.length === 0 && <p className="muted">No model servers are answering at their usual addresses here. Start one, or add a server on another machine by its address.</p>}
          {found.map(f => (
            <div key={f.base_url} className="local-found-row">
              <span><strong>{f.label}</strong> <span className="mono faint">{f.base_url}</span> <span className="faint">{f.models === 1 ? '1 model' : `${f.models} models`}</span></span>
              {f.configured_as ? <span className="faint">Added as {f.configured_as}</span> : <button type="button" className="btn btn-sm" onClick={() => void add(f)}>Add</button>}
            </div>
          ))}
        </div>
      )}

      {editing && <ServerForm kinds={kinds} value={editing.endpoint} previous={editing.previous} onCancel={() => setEditing(null)} onSaved={async () => {
        setEditing(null);
        await load();
        await refreshAfterChange();
      }} />}

      {servers === null ? <p className="muted">Checking servers…</p> : servers.length === 0 && !editing ? (
        <p className="muted">No servers yet. Find the ones running here, or add one by its address.</p>
      ) : (
        <div className="account-list">
          {servers.map(server => (
            <Server key={server.id} server={server} pulls={pulls} checking={checking} onCheck={() => void load()} onEdit={() => setEditing({endpoint: {id: server.id, name: server.name, kind: server.kind, base_url: server.base_url, key_secret: server.key_secret}, previous: server.id})} onRemove={() => void remove(server)} onChanged={async () => {
              await load();
              await refreshAfterChange();
            }} />
          ))}
        </div>
      )}
    </Group>
  );
}

function Server({server, pulls, checking, onCheck, onEdit, onRemove, onChanged}: {server: LocalEndpointInfo; pulls: Record<string, Pull>; checking: boolean; onCheck: () => void; onEdit: () => void; onRemove: () => void; onChanged: () => Promise<void>}) {
  const [pullName, setPullName] = useState('');
  const ollama = server.kind === 'ollama';
  const models = (server.models || []).filter(m => !m.embedding);
  const running = Object.values(pulls).filter(p => p.server === server.id && !p.done);
  const state = server.disabled ? 'Turned off' : server.status.reachable ? 'Answering' : 'Not answering';

  async function pull() {
    const name = pullName.trim();
    if (!name) return;
    try {
      await api.pullLocalModel(server.id, name);
      setPullName('');
    } catch (e) {
      toastError(e);
    }
  }

  return (
    <article className="account local-server" aria-label={server.title}>
      <div className="account-main">
        <strong>{server.title} <span className="mono faint">local:{server.id}</span></strong>
        <p className="muted"><span className="mono">{server.base_url}</span>{server.title !== server.kind_label ? ` · ${server.kind_label}` : ''}{server.status.version ? ` ${server.status.version}` : ''}</p>
        {!server.status.reachable && server.status.error && <p className="bad-text">{server.status.error}</p>}
        {server.insecure && <p className="notice">Its key goes to another machine over plain http, where others on the network could read it. Use an https address if the server offers one.</p>}
        {models.length > 0 && (
          <ul className="local-models">
            {models.map(m => <LocalModelRow key={m.id} server={server} model={m} onChanged={onChanged} />)}
          </ul>
        )}
        {server.status.reachable && models.length === 0 && <p className="faint">No models yet.{ollama ? ' Pull one below.' : ''}</p>}
        {running.map(p => (
          <div key={p.model} className="local-pull" aria-label={`Pulling ${p.model}`}>
            <span className="faint">{p.model}: {p.status}{p.total ? ` · ${Math.floor(((p.completed || 0) * 100) / p.total)}%` : ''}</span>
            {p.total ? <div className="progress"><span style={{width: `${Math.min(100, ((p.completed || 0) * 100) / p.total)}%`}} /></div> : null}
            <button type="button" className="btn btn-sm" onClick={() => void api.cancelLocalPull(server.id, p.model)}>Cancel</button>
          </div>
        ))}
        {ollama && server.status.reachable && (
          <form className="local-pull-form" onSubmit={event => {
            event.preventDefault();
            void pull();
          }}>
            <input className="input mono" value={pullName} onChange={e => setPullName(e.target.value)} placeholder="Model to pull, such as qwen2.5:7b or hf.co/owner/repo:Q4_K_M" aria-label={`Model to pull into ${server.title}`} />
            <button type="submit" className="btn btn-sm" disabled={!pullName.trim()}>Pull</button>
          </form>
        )}
      </div>
      <div className="account-state">
        <StatusTag status={server.disabled ? 'idle' : server.status.reachable ? 'ok' : 'error'} label={state} />
        <div className="row-actions">
          <button type="button" className="btn btn-sm" disabled={checking} onClick={onCheck}>Check</button>
          <button type="button" className="btn btn-sm" onClick={onEdit}>Edit</button>
          <button type="button" className="btn btn-sm" onClick={onRemove}>Remove</button>
        </div>
      </div>
    </article>
  );
}

function LocalModelRow({server, model, onChanged}: {server: LocalEndpointInfo; model: LocalModel; onChanged: () => Promise<void>}) {
  const [busy, setBusy] = useState(false);
  const ollama = server.kind === 'ollama';
  const small = !!model.context_window && model.context_window < 16384;
  const larger = Math.min(model.max_context || 32768, 32768);
  const details = [model.parameters, model.quantization, model.capabilities?.includes('tools') ? 'tools' : '', model.capabilities?.includes('vision') ? 'vision' : ''].filter(Boolean).join(', ');

  async function widen() {
    setBusy(true);
    try {
      const name = await api.copyLocalModelWithContext(server.id, model.id, larger);
      toast(`Made ${name} with a ${formatTokens(larger)} context. Choose it in the model lists.`, 'success');
      await onChanged();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!(await confirmDialog({title: `Delete ${model.id}?`, body: `It is removed from ${server.title} and its files are deleted. You can pull it again later.`, confirmLabel: 'Delete', danger: true}))) return;
    setBusy(true);
    try {
      await api.deleteLocalModel(server.id, model.id);
      await onChanged();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li>
      <span className="mono">{model.id}</span>
      {details && <span className="faint"> {details}</span>}
      {model.context_window ? <span className={small ? 'warn-text' : 'faint'}> · {formatTokens(model.context_window)} context</span> : null}
      {model.loaded && <span className="tag">Loaded</span>}
      {small && <span className="faint"> · NullBot’s instructions and tools need about 16k; {model.context_note || 'a larger context works better'}</span>}
      {ollama && (
        <span className="row-actions">
          {small && larger > (model.context_window || 0) && <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void widen()}>Make a {formatTokens(larger)} copy</button>}
          <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void remove()}>Delete</button>
        </span>
      )}
    </li>
  );
}

function ServerForm({kinds, value, previous, onCancel, onSaved}: {kinds: LocalServerKind[]; value: LocalEndpoint; previous: string; onCancel: () => void; onSaved: () => Promise<void>}) {
  const [draft, setDraft] = useState<LocalEndpoint>(value);
  const [secrets, setSecrets] = useState<SecretInfo[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    api.secrets().then(list => setSecrets((Array.isArray(list) ? list : []).filter(s => s.kind === 'api_key'))).catch(() => undefined);
  }, []);
  const kind = kinds.find(k => k.id === draft.kind);
  const set = (patch: Partial<LocalEndpoint>) => setDraft(prev => ({...prev, ...patch}));
  const id = (draft.id || draft.kind).trim().toLowerCase();
  // A server only gets a key meant for it: provider "local" or its own ID.
  const usable = secrets.filter(s => keyFits(s, id) || s.name === draft.key_secret);
  const plain = Boolean(draft.key_secret) && sendsKeyInTheClear(draft.base_url || kind?.default_url || '');

  async function save() {
    setSaving(true);
    setError('');
    try {
      await api.saveLocalEndpoint({...draft, plain_http: plain && Boolean(draft.plain_http)}, previous);
      await onSaved();
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="local-form" aria-label={previous ? `Edit ${previous}` : 'Add a model server'} onSubmit={event => {
      event.preventDefault();
      void save();
    }}>
      <div className="form-grid">
        <label className="field">
          <span>Kind</span>
          <select className="select" value={draft.kind} onChange={e => set({kind: e.target.value})}>
            {(kinds.length ? kinds : [{id: 'ollama', label: 'Ollama', default_url: 'http://localhost:11434'}]).map(k => <option key={k.id} value={k.id}>{k.label}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Address</span>
          <input className="input mono" value={draft.base_url} onChange={e => set({base_url: e.target.value})} placeholder={kind?.default_url || 'http://host:port'} />
          <small>{kind?.default_url ? `Empty uses ${kind.default_url}.` : 'Its address, such as http://gpu-box.lan:8000.'} Another machine works too.</small>
        </label>
        <label className="field">
          <span>ID</span>
          <input className="input mono" value={draft.id} onChange={e => set({id: e.target.value})} placeholder={draft.kind} />
          <small>Used in model names: local:{draft.id || draft.kind}/MODEL.</small>
        </label>
        <label className="field">
          <span>Name</span>
          <input className="input" value={draft.name || ''} onChange={e => set({name: e.target.value})} placeholder={kind?.label || ''} />
        </label>
        <label className="field">
          <span>API key</span>
          <select className="select" value={draft.key_secret || ''} onChange={e => set({key_secret: e.target.value})}>
            <option value="">None</option>
            {usable.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
          </select>
          <small>Only for a server started with a key: an API key in Secrets with provider <code>local</code> or <code>{id}</code>.</small>
        </label>
      </div>
      {plain && (
        <label className="check notice warn">
          <input type="checkbox" checked={Boolean(draft.plain_http)} onChange={e => set({plain_http: e.target.checked})} />
          <span>Send the key over plain http. Anyone on the network between here and the server could read it; https or an SSH tunnel keeps it private.</span>
        </label>
      )}
      {error && <p className="notice bad" role="alert">{error}</p>}
      <div className="row-actions">
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : previous ? 'Save server' : 'Add server'}</button>
      </div>
    </form>
  );
}

function keyFits(secret: SecretInfo, id: string) {
  const provider = (secret.public?.provider || '').toLowerCase();
  return provider === 'local' || provider === id || provider === `local-${id}`;
}

// sendsKeyInTheClear: plain http to anything but this computer.
export function sendsKeyInTheClear(address: string) {
  const raw = address.trim();
  if (!raw) return false;
  let url: URL;
  try {
    url = new URL(raw.includes('://') ? raw : `http://${raw}`);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:') return false;
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return !(host === 'localhost' || host.endsWith('.localhost') || host === '::1' || /^127\./.test(host));
}
