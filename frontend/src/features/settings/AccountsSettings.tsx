import {useEffect, useRef, useState} from 'react';
import {Copy, RefreshCw} from 'lucide-react';
import {api} from '../../lib/bindings';
import {refreshState} from '../../state/app';
import ServiceAccountsPanel from '../../ServiceAccountsPanel';
import {StatusTag} from '../../ui/layout';
import {toast, toastError} from '../../ui/toast';

type Account = {id: string; label: string; kind: string; status: string; masked?: string; detail?: string; can_login?: boolean; can_save_key?: boolean; unsupported?: boolean};
type AccountState = {accounts: Account[]; keys_path: string; codex_auth_path: string};
type CodexFlow = {user_code: string; verification_uri?: string; interval_seconds?: number; expires_at?: string; expires_in?: number};

const keyProviders = ['openai', 'anthropic', 'openrouter', 'google', 'brave'];
const sleep = (ms: number) => new Promise(resolve => window.setTimeout(resolve, ms));

function accountTone(status?: string) {
  const value = String(status || '').toLowerCase();
  if (/signed in|configured|set|ready|active|authorized/.test(value) && !/not/.test(value)) return 'done';
  if (/expired|error|invalid/.test(value)) return 'error';
  return 'idle';
}

export function AccountsSettings() {
  const [state, setState] = useState<AccountState | null>(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  async function load() {
    setRefreshing(true);
    try {
      setState(await api.accountStatus());
      setError('');
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setRefreshing(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  const byID = Object.fromEntries((state?.accounts || []).map(account => [account.id, account]));
  const others = (state?.accounts || []).filter(account => !['codex', 'other', ...keyProviders].includes(account.id));
  return (
    <section>
      <header className="settings-head settings-head-row">
        <div>
          <h2>Accounts</h2>
          <p className="muted">Model providers NullBot can use. Keys are stored on this computer and never shown again after saving.</p>
        </div>
        <button className="btn" disabled={refreshing} onClick={() => void load()}>{refreshing ? <span className="spinner" /> : <RefreshCw size={13} />}Check again</button>
      </header>
      {error && <p className="notice bad">{error}</p>}
      <div className="settings-group">
        <h3>Model providers</h3>
        <div className="account-list">
          <CodexRow account={byID.codex} authPath={state?.codex_auth_path} onState={setState} />
          {keyProviders.map(id => <KeyRow key={id} id={id} account={byID[id]} onState={setState} />)}
          <OtherKeyRow onState={setState} />
          {others.map(account => (
            <div className="account" key={account.id}>
              <div className="account-main">
                <strong>{account.label || account.id}</strong>
                {account.detail && <p className="muted">{account.detail}</p>}
              </div>
              <div className="account-state"><StatusTag status={accountTone(account.status)} label={account.status} />{account.masked && <span className="mono faint">{account.masked}</span>}</div>
            </div>
          ))}
        </div>
        {state?.keys_path && <p className="faint">Keys file: <span className="mono">{state.keys_path}</span></p>}
      </div>
      <div className="settings-group">
        <ServiceAccountsPanel />
      </div>
    </section>
  );
}

function CodexRow({account, authPath, onState}: {account?: Account; authPath?: string; onState: (state: AccountState) => void}) {
  const [flow, setFlow] = useState<CodexFlow | null>(null);
  const [message, setMessage] = useState('');
  const [working, setWorking] = useState(false);
  const alive = useRef(true);
  useEffect(() => () => {
    alive.current = false;
  }, []);

  async function signIn() {
    setWorking(true);
    setFlow(null);
    try {
      const started: CodexFlow = await api.beginCodexLogin();
      if (!alive.current) return;
      setFlow(started);
      setMessage('Your browser opened. Enter the code there to approve NullBot.');
      let interval = Math.max(Number(started.interval_seconds || 5), 3);
      const expires = Date.parse(started.expires_at || '') || Date.now() + Number(started.expires_in || 900) * 1000;
      while (alive.current && Date.now() < expires) {
        await sleep(interval * 1000);
        const result = await api.pollCodexLogin(started);
        if (result.account_state) onState(result.account_state);
        if (result.status === 'authorized') {
          setMessage('Signed in. OpenAI and Codex models can now use your ChatGPT subscription.');
          setFlow(null);
          void refreshState().catch(() => undefined);
          toast('Signed in with ChatGPT.', 'success');
          return;
        }
        if (result.status === 'slow_down') {
          interval = Math.max(Number(result.interval_seconds || interval + 2), interval + 1);
          continue;
        }
        if (result.status === 'expired' || result.status === 'denied') {
          setMessage(result.status === 'denied' ? 'Sign-in was declined in the browser.' : 'The code expired. Start again when you’re ready.');
          setFlow(null);
          return;
        }
      }
      if (alive.current) {
        setMessage('The code expired. Start again when you’re ready.');
        setFlow(null);
      }
    } catch (err) {
      setMessage(`Sign-in couldn’t start: ${err instanceof Error ? err.message : err}`);
    } finally {
      if (alive.current) setWorking(false);
    }
  }

  return (
    <div className="account">
      <div className="account-main">
        <strong>{account?.label || 'ChatGPT subscription (Codex)'}</strong>
        <p className="muted">{account?.detail || 'Sign in with ChatGPT so OpenAI and Codex models run on your subscription instead of an API key.'}</p>
        {flow && (
          <div className="device-code">
            <span className="muted">Code</span>
            <strong className="mono">{flow.user_code}</strong>
            <button className="btn btn-sm" onClick={() => void navigator.clipboard?.writeText(flow.user_code).then(() => toast('Code copied.'))}><Copy size={12} />Copy</button>
            {flow.verification_uri && <a href={flow.verification_uri}>{flow.verification_uri}</a>}
          </div>
        )}
        {message && <p className="account-message" role="status">{message}</p>}
        {authPath && <p className="faint mono">{authPath}</p>}
      </div>
      <div className="account-state">
        <StatusTag status={accountTone(account?.status)} label={account?.status || 'Not signed in'} />
        <button className="btn" disabled={working || account?.can_login === false} onClick={() => void signIn()}>{working ? <span className="spinner" /> : null}{working ? 'Waiting for approval' : 'Sign in with ChatGPT'}</button>
      </div>
    </div>
  );
}

function KeyRow({id, account, onState}: {id: string; account?: Account; onState: (state: AccountState) => void}) {
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const label = account?.label || id;
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!value.trim()) return;
    setSaving(true);
    try {
      const keys: Record<string, any> = {openai: '', anthropic: '', openrouter: '', google: '', other: {}};
      if (id === 'brave') keys.other = {brave: value.trim()};
      else keys[id] = value.trim();
      onState(await api.saveAccountKeys(keys));
      setValue('');
      void refreshState().catch(() => undefined);
      toast(`${label} key saved.`, 'success');
    } catch (err) {
      toastError(err);
    } finally {
      setSaving(false);
    }
  }
  return (
    <form className="account" onSubmit={save}>
      <div className="account-main">
        <strong>{label}</strong>
        {account?.detail && <p className="muted">{account.detail}</p>}
        <div className="inline-form">
          <input className="input mono" type="password" autoComplete="off" value={value} onChange={event => setValue(event.target.value)} placeholder={account?.masked ? `Replace ${account.masked}` : 'Paste an API key'} aria-label={`${label} API key`} />
          <button type="submit" className="btn" disabled={saving || !value.trim()}>Save key</button>
        </div>
      </div>
      <div className="account-state">
        <StatusTag status={accountTone(account?.status)} label={account?.status || 'Not set'} />
        {account?.masked && <span className="mono faint">{account.masked}</span>}
      </div>
    </form>
  );
}

function OtherKeyRow({onState}: {onState: (state: AccountState) => void}) {
  const [provider, setProvider] = useState('');
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      onState(await api.saveAccountKeys({openai: '', anthropic: '', openrouter: '', google: '', other: {[provider.trim().toLowerCase()]: value.trim()}}));
      setProvider('');
      setValue('');
      toast('Key saved.', 'success');
    } catch (err) {
      toastError(err);
    } finally {
      setSaving(false);
    }
  }
  return (
    <form className="account" onSubmit={save}>
      <div className="account-main">
        <strong>Another service</strong>
        <p className="muted">Store a key that a tool server reads by name, such as perplexity.</p>
        <div className="inline-form">
          <input className="input mono narrow" value={provider} onChange={event => setProvider(event.target.value)} placeholder="Service name" aria-label="Service name" />
          <input className="input mono" type="password" autoComplete="off" value={value} onChange={event => setValue(event.target.value)} placeholder="API key" aria-label="API key" />
          <button type="submit" className="btn" disabled={saving || !provider.trim() || !value.trim()}>Save key</button>
        </div>
      </div>
    </form>
  );
}
