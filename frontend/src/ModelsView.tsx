import {useEffect, useRef, useState, type ReactNode} from 'react';
import {Models, SetModel} from '../wailsjs/go/main/App';
import './projects-models.css';

type Props = {ui: any; refreshState: () => void; accountsPanel?: ReactNode};
type Target = 'manager' | 'subagent' | 'both';
const roleLabel: Record<Target, string> = {manager: 'Manager', subagent: 'Subagent', both: 'Both'};
const modelKey = (config: any) => config?.provider && config?.model ? `${config.provider}/${config.model}` : 'Not configured';

export default function ModelsView({ui, refreshState, accountsPanel}: Props) {
  const [tab, setTab] = useState('models');
  const [groups, setGroups] = useState<any[]>(ui.models || []);
  const [provider, setProvider] = useState(ui.config?.model?.provider || '');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [retry, setRetry] = useState(0);
  const choosing = useRef(false);
  const currentManager = modelKey(ui.config?.model);
  const currentSubagent = modelKey(ui.config?.subagent_model);
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    Models().then(next => {if (active) setGroups(next || []);})
      .catch(e => {if (active) setError(String(e));})
      .finally(() => {if (active) setLoading(false);});
    return () => {active = false;};
  }, [retry]);

  async function choose(providerID: string, model: string, target: Target) {
    if (choosing.current) return;
    choosing.current = true;
    setPending(`${providerID}/${model}:${target}`); setError(''); setNotice('');
    try {
      await SetModel(providerID, model, target);
      await refreshState();
      setNotice(`${providerID}/${model} assigned to ${target === 'both' ? 'Manager and Subagent' : roleLabel[target]}.`);
    } catch (e) {setError(String(e));} finally {choosing.current = false; setPending('');}
  }
  const selected = groups.find(group => group.provider === provider) || groups[0];
  const models = (selected?.models || []).filter((model: any) => `${selected?.provider || ''} ${model.name || ''} ${model.id || ''} ${model.description || ''}`.toLowerCase().includes(query.trim().toLowerCase()));

  return <section className="view-column pm-models" aria-label="Models and accounts">
    <nav className="sticky-tabs" aria-label="Models sections">
      <button type="button" className={tab === 'models' ? 'active' : ''} aria-pressed={tab === 'models'} onClick={() => setTab('models')}>Models</button>
      <button type="button" className={tab === 'accounts' ? 'active' : ''} aria-pressed={tab === 'accounts'} onClick={() => setTab('accounts')}>Accounts</button>
    </nav>
    {tab === 'accounts' ? (accountsPanel ?? <p className="pm-notice">Manage provider credentials in Settings → Accounts.</p>) : <>
      <header className="pm-heading"><div><h2>Choose models</h2><p>Assign a model directly to Manager, Subagent, or both roles.</p></div></header>
      <div className="pm-current-roles"><div><span>Current Manager</span><strong>{currentManager}</strong></div><div><span>Current Subagent</span><strong>{currentSubagent}</strong></div></div>
      <div className="pm-model-toolbar">
        <label className="pm-field"><span>Provider</span><select value={selected?.provider || ''} onChange={e => setProvider(e.target.value)} disabled={!groups.length}>{!groups.length && <option value="">No providers</option>}{groups.map(group => <option key={group.provider} value={group.provider}>{group.provider} ({group.models?.length || 0})</option>)}</select></label>
        <label className="pm-field pm-path"><span>Search this provider</span><input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Model name, ID or description" /></label>
        <button type="button" disabled={loading || !!pending} onClick={() => setRetry(n => n + 1)}>Refresh models</button>
      </div>
      {loading && <p className="loading-inline" role="status"><span className="spinner" aria-hidden="true" />Loading models…</p>}
      {pending && <p role="status">Applying model selection…</p>}
      {error && <p className="pm-notice" role="alert">{error}</p>}
      {notice && <p className="pm-notice" role="status">{notice}</p>}
      {selected?.error && <p className="pm-notice" role="alert">{selected.provider}: {selected.error}</p>}
      {!loading && !models.length && <p className="empty-state small">No models match this provider and search. Try another provider, clear your search, or refresh.</p>}
      <div className="pm-model-catalog" aria-busy={loading || !!pending}>
        {models.map((model: any) => {
          const key = `${selected.provider}/${model.id}`;
          const manager = key === currentManager;
          const subagent = key === currentSubagent;
          return <article key={key} className={`pm-model-card ${manager || subagent ? 'is-selected' : ''}`} aria-label={model.name || model.id}>
            <header className="pm-card-heading"><div><h3>{model.name || model.id}</h3><small>{model.id}</small></div><div className="pm-role-badges">{manager && <span className="pm-badge">Manager active</span>}{subagent && <span className="pm-badge">Subagent active</span>}</div></header>
            <p>{model.description || `Model offered by ${selected.provider}.`}</p>
            <small className="pm-muted">{model.reasoning ? 'Reasoning' : 'Standard'}{model.responses ? ' · Responses API' : ''}</small>
            <div className="pm-model-actions" role="group" aria-label={`Assign ${model.name || model.id}`}>
              {(['manager', 'subagent', 'both'] as Target[]).map(target => {
                const active = target === 'manager' ? manager : target === 'subagent' ? subagent : manager && subagent;
                return <button type="button" key={target} className={active ? 'is-active' : ''} aria-pressed={active} aria-label={`Use ${model.name || model.id} for ${target === 'both' ? 'Manager and Subagent' : roleLabel[target]}`} disabled={loading || !!pending || !model.id} onClick={() => choose(selected.provider, model.id, target)}>{pending === `${key}:${target}` ? 'Applying…' : `${active ? '✓ ' : ''}${roleLabel[target]}`}</button>;
              })}
            </div>
          </article>;
        })}
      </div>
    </>}
  </section>;
}
