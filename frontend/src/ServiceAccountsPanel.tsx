import {useEffect, useRef, useState} from 'react';
import {serviceDefinitions, serviceStatus, localStatus, type ServiceDefinition, type ServiceAccountSummary, type ServiceAccountsState, type SaveServiceAccountRequest} from './serviceAccounts';
import {ServiceAccountStatus, SaveServiceAccount, DeleteServiceAccount} from '../wailsjs/go/main/App';
import './service-accounts.css';

export type ServiceAccountsAPI = {
  status: () => Promise<ServiceAccountsState>;
  save: (request: SaveServiceAccountRequest) => Promise<void>;
  remove: (id: string) => Promise<void>;
};
// Only the local Wails bridge is used; no provider or package requests.
const defaultAPI: ServiceAccountsAPI = {
  status: ServiceAccountStatus,
  save: SaveServiceAccount,
  remove: DeleteServiceAccount,
};

type Editor = {service: ServiceDefinition; account?: ServiceAccountSummary};
export default function ServiceAccountsPanel({api = defaultAPI}: {api?: ServiceAccountsAPI}) {
  const [state, setState] = useState<ServiceAccountsState | null>(null);
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState('');
  const [help, setHelp] = useState<ServiceDefinition | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);

  useEffect(() => {
    let active = true;
    api.status().then(next => {if (active) setState(next);}).catch(() => {if (active) setNotice('Could not read local service account status. No connection was attempted.');});
    return () => {active = false;};
  }, [api]);

  async function refresh() {
    setWorking(true);
    try {setState(await api.status()); setNotice('Local status refreshed. Credentials were not verified; no connection was attempted.');}
    catch {setState(null); setNotice('Could not read local service account status.');}
    finally {setWorking(false);}
  }
  async function remove(account: ServiceAccountSummary) {
    if (!window.confirm(`Delete the locally saved account “${account.label}”? This removes its saved credentials; it does not revoke provider tokens or delete provider data. Restart active runs to revoke their runtime access.`)) return;
    setWorking(true);
    try {
      await api.remove(account.id);
      await reloadAfterMutation('Local account deleted. Restart active runs to revoke runtime access. Revoke provider tokens separately if needed.');
    }
    catch {setNotice('Account could not be deleted. No provider request was made.');}
    finally {setWorking(false);}
  }
  async function reloadAfterMutation(message: string) {
    try {setState(await api.status()); setNotice(message);}
    catch {setState(null); setNotice(message + ' Local status could not be refreshed; refresh before making further changes.');}
  }
  async function save(request: SaveServiceAccountRequest) {
    setWorking(true);
    try {
      await api.save(request);
      setEditor(null);
      await reloadAfterMutation('Saved locally — unverified. Restart active runs to apply changes. Saving does not install or enable an MCP, refresh tokens, or contact the provider.');
    } finally {setWorking(false);}
  }
  return <section className="service-accounts" aria-labelledby="service-accounts-title">
    <div className="accounts-toolbar"><div><h2 id="service-accounts-title">Service accounts</h2>
      <p>Email, cloud storage and business messaging. These are separate from model-provider API keys.</p></div>
      <button type="button" onClick={refresh} disabled={working}>Refresh local status</button></div>
    <p className="service-note">For this OS user on this device only. Credentials are saved locally and never returned to this panel. “Configured” is not a connection check. No package is installed or enabled here. Write/send access is off by default.</p>
    {notice && <p role="status" className="warn">{notice}</p>}
    <div className="account-grid">
      {serviceDefinitions.map(service => {
        const availability = state?.services?.find(item => item.service === service.id);
        const accounts = state?.accounts?.filter(account => account.service === service.id) || [];
        return <article key={service.id} className="account-card service-account-card">
          <div className="account-head"><strong>{service.name}</strong><small className="service-status">{serviceStatus(service, availability)}</small></div>
          <p>{service.detail}</p>
          {!service.unavailable && availability?.status === 'disabled' && <p>Enable {service.packageID} separately in MCP settings when you are ready. Saving here does not enable it.</p>}
          {!service.unavailable && <p className="service-note">{!state ? 'Local account status unavailable.' : accounts.length ? `${accounts.length} locally saved account(s).` : 'No credentials saved.'}</p>}
          {accounts.map(account => <div className="service-saved-account" key={account.id}>
            <strong>{account.label}</strong>
            <small>{localStatus(account.status)}. {account.allow_write ? 'Write and send permitted.' : 'Read only.'}</small>
            <div className="service-actions">{!service.unavailable && <button type="button" disabled={working} onClick={() => setEditor({service, account})}>Replace credentials</button>}
              <button type="button" disabled={working} onClick={() => remove(account)}>Delete account</button></div>
          </div>)}
          <div className="service-actions"><button type="button" onClick={() => setHelp(service)}>Setup help</button>
            {!service.unavailable && <button type="button" disabled={working || !state} onClick={() => setEditor({service})}>Add account</button>}</div>
        </article>;
      })}
    </div>
    {help && <ServiceModal title={`${help.name} setup`} onClose={() => setHelp(null)}>
      <p>{help.detail}</p><ol>{help.help.map((step, index) => <li key={index}>{step}</li>)}</ol>
      {!help.unavailable && <p>Requires {help.packageID}. Install and enable it separately only when you choose to. This help does not contact any provider.</p>}
    </ServiceModal>}
    {editor && <ServiceAccountEditor key={editor.account?.id || editor.service.id} editor={editor} onSave={save} onClose={() => setEditor(null)} />}
  </section>;
}

function ServiceModal({title, onClose, children, busy = false}: {title: string; onClose: () => void; children: React.ReactNode; busy?: boolean}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = dialog.current;
    element?.showModal();
    return () => {element?.close(); if (previous?.isConnected) previous.focus();};
  }, []);
  return <dialog ref={dialog} className="service-modal" aria-modal="true" aria-labelledby="service-modal-title" onCancel={event => {event.preventDefault(); if (!busy) onClose();}}>
    <h2 id="service-modal-title">{title}</h2>{children}<button type="button" disabled={busy} onClick={onClose}>Close</button>
  </dialog>;
}

function ServiceAccountEditor({editor: {service, account}, onSave, onClose}: {editor: Editor; onSave: (request: SaveServiceAccountRequest) => Promise<void>; onClose: () => void}) {
  const [label, setLabel] = useState(account?.label || '');
  const [fields, setFields] = useState<Record<string, string>>({});
  // A replacement also defaults to read-only; consent must be deliberate each time.
  const [allowWrite, setAllowWrite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (allowWrite && !window.confirm('Allow write/send operations for this account? Depending on the service, tools may send messages, change or delete files, sync changes, and incur provider charges. Enable only for a trusted MCP and actions you authorize.')) return;
    if (account && !window.confirm('Replace all saved credentials for this account? Blank optional fields will be removed, not preserved.')) return;
    setBusy(true); setError('');
    try {
      await onSave({id: account?.id || '', service: service.id, label: label.trim(), fields, allow_write: allowWrite});
      setFields({});
    } catch {
      // Do not render raw backend exceptions: they could contain credential input.
      setFields({});
      setError('Could not save this account. Check the required fields and local credential-store permissions, then re-enter credentials. No connection was attempted.');
    } finally {setBusy(false);}
  }
  return <ServiceModal title={`${account ? 'Replace' : 'Add'} ${service.name} account`} onClose={onClose} busy={busy}>
    <p>Save locally only. All credential fields start blank and are never read back. Use a label that does not contain secrets. {account && 'Replacement overwrites the entire credential set, including removing previously saved optional fields.'}</p>
    <form onSubmit={submit} autoComplete="off">
      <fieldset disabled={busy}>
        <label>Account label<input required maxLength={120} value={label} onChange={event => setLabel(event.target.value)} autoComplete="off" /></label>
        {service.fields.map(field => <label key={field.key}>{field.label}{field.optional ? ' (optional)' : ''}
          <input maxLength={16384} type={field.secret ? 'password' : 'text'} required={!field.optional} value={fields[field.key] || ''}
            autoComplete={field.secret ? 'new-password' : 'off'} spellCheck={false} autoCapitalize="none"
            onChange={event => setFields(current => ({...current, [field.key]: event.target.value}))} />
        </label>)}
        <label className="service-write-toggle"><input type="checkbox" checked={allowWrite} onChange={event => setAllowWrite(event.target.checked)} />Allow write/send operations</label>
        <p className="warn">Off by default. Enabling can permit sending messages, changing or deleting data, and provider charges. Local iCloud writes can sync to other devices. Provider permissions still apply.</p>
        {service.id === 'twilio' && <p className="warn">Twilio usage can incur charges. No test message is sent on save.</p>}
        {error && <p role="alert" className="warn">{error}</p>}
        <button type="submit" className="primary" disabled={busy || !label.trim()}>{busy ? 'Saving locally…' : account ? 'Replace saved credentials' : 'Save account locally'}</button>
      </fieldset>
    </form>
  </ServiceModal>;
}
