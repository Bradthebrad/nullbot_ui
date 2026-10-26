// Model catalog and role assignment. Kept free of runtime helpers so tests
// can execute it with a minimal hook harness.
import {useEffect, useRef, useState} from 'react';
import {ModelCatalog, Models, SetModel} from '../wailsjs/go/main/App';
import {formatTokens} from './lib/format';
import './projects-models.css';

const windowSource: Record<string, string> = {
  override: 'your setting',
  provider: 'reported by the provider',
  learned: 'learned from a provider error',
  'built-in': 'typical for this model family',
  default: 'size unknown, so the default',
};

type Props = {ui: any; refreshState: () => void};
type Target = 'manager' | 'subagent' | 'both';
const roleLabel: Record<Target, string> = {manager: 'Manager', subagent: 'Subagents', both: 'Both'};
const modelKey = (config: any) => (config?.provider && config?.model ? `${config.provider}/${config.model}` : '');

export default function ModelsView({ui, refreshState}: Props) {
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
    setLoading(true);
    setError('');
    // "Refresh list" asks the providers again; the first load may use the cache.
    (retry > 0 ? ModelCatalog(true) : Models()).then(next => {if (active) setGroups(next || []);})
      .catch(e => {if (active) setError(String(e));})
      .finally(() => {if (active) setLoading(false);});
    return () => {active = false;};
  }, [retry]);

  async function choose(providerID: string, model: string, target: Target) {
    if (choosing.current) return;
    choosing.current = true;
    setPending(`${providerID}/${model}:${target}`);
    setError('');
    setNotice('');
    try {
      await SetModel(providerID, model, target);
      await refreshState();
      setNotice(`${model} now runs ${target === 'both' ? 'the manager and subagents' : target === 'manager' ? 'the manager' : 'subagents'}.`);
    } catch (e) {
      setError(String(e));
    } finally {
      choosing.current = false;
      setPending('');
    }
  }
  const selected = groups.find(group => group.provider === provider) || groups[0];
  const q = query.trim().toLowerCase();
  const models = (selected?.models || []).filter((model: any) => !q || `${model.name || ''} ${model.id || ''} ${model.description || ''}`.toLowerCase().includes(q));

  return <section className="models" aria-label="Models">
    <header className="settings-head">
      <h2>Models</h2>
      <p className="muted">The manager talks with you and decides what to do. Subagents take on pieces of work it hands out.</p>
    </header>
    <div className="model-roles">
      <div><span className="faint">Manager</span><strong className="mono">{currentManager || 'Not set'}</strong></div>
      <div><span className="faint">Subagents</span><strong className="mono">{currentSubagent || 'Same as manager'}</strong></div>
    </div>
    <div className="model-bar">
      <div className="segmented provider-tabs" role="radiogroup" aria-label="Provider">
        {groups.map(group => (
          <button key={group.provider} type="button" role="radio" aria-checked={group.provider === selected?.provider} className={group.provider === selected?.provider ? 'active' : ''} onClick={() => setProvider(group.provider)}>
            {group.provider}<span className="num faint"> {group.models?.length || 0}</span>
          </button>
        ))}
      </div>
      <input className="input model-search" type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search models" aria-label="Search models" />
      <button type="button" className="btn" disabled={loading || !!pending} onClick={() => setRetry(n => n + 1)}>Refresh list</button>
    </div>
    {loading && <p className="muted" role="status">Loading models…</p>}
    {error && <p className="notice bad" role="alert">{error}</p>}
    {notice && <p className="notice" role="status">{notice}</p>}
    {selected?.error && <p className="notice bad" role="alert">{selected.provider}: {selected.error}</p>}
    {!loading && !models.length && <p className="muted">No models match. Try another provider or clear the search.</p>}
    <div className="model-list" aria-busy={loading || !!pending}>
      {models.map((model: any) => {
        const key = `${selected.provider}/${model.id}`;
        const manager = key === currentManager;
        const subagent = key === currentSubagent;
        return <article key={key} className={`model-row ${manager || subagent ? 'in-use' : ''}`} aria-label={model.name || model.id}>
          <div className="model-main">
            <div className="model-name">
              <strong>{model.name || model.id}</strong>
              {model.name && model.name !== model.id && <span className="mono faint">{model.id}</span>}
              {model.reasoning && <span className="tag">Reasoning</span>}
              {model.context_window ? <span className="faint num model-window" title={`Context window: ${model.context_window.toLocaleString()} tokens, ${windowSource[model.context_source] || 'as configured'}. Change it in Settings → Agent.`}>{formatTokens(model.context_window)} context</span> : null}
              {manager && <span className="tag warn">Manager</span>}
              {subagent && <span className="tag warn">Subagents</span>}
            </div>
            {model.description && <p className="muted model-desc">{model.description}</p>}
          </div>
          <div className="model-assign" role="group" aria-label={`Use ${model.name || model.id} for`}>
            {(['manager', 'subagent', 'both'] as Target[]).map(target => {
              const active = target === 'manager' ? manager : target === 'subagent' ? subagent : manager && subagent;
              return <button type="button" key={target} className={active ? 'btn btn-sm is-on' : 'btn btn-sm'} aria-pressed={active} aria-label={`Use ${model.name || model.id} for ${target === 'both' ? 'the manager and subagents' : roleLabel[target]}`} disabled={loading || !!pending || !model.id} onClick={() => choose(selected.provider, model.id, target)}>
                {pending === `${key}:${target}` ? 'Applying…' : roleLabel[target]}
              </button>;
            })}
          </div>
        </article>;
      })}
    </div>
  </section>;
}
