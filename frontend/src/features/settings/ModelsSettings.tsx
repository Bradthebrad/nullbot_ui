// Which models do the work. The manager and the subagents each have their
// own model, from any provider, or subagents can follow the manager.
import {useEffect, useState} from 'react';
import {useStore} from '../../lib/store';
import {api} from '../../lib/bindings';
import {formatTokens} from '../../lib/format';
import type {ModelGroup} from '../../lib/types';
import {appStore} from '../../state/app';
import {toastError} from '../../ui/toast';
import {Group, NumberField, SaveBar, useConfigDraft} from './form';
import {ModelFields, invalidWindows, providerNames, providerReady, type ModelValue} from './modelFields';

const managed = ['model', 'subagent_model', 'agent.max_subagents', 'compaction.context_windows'];

const sameAsManager = (value?: ModelValue) => !value?.provider && !value?.model;
const keyOf = (value?: ModelValue) => (value?.provider && value?.model ? `${value.provider}/${value.model}` : '');

export function ModelsSettings() {
  const {config, set, val, dirty, saving, save, discard} = useConfigDraft('models-settings', managed);
  const groups = useStore(appStore, state => state.models);
  const runtime = useStore(appStore, state => state.runtime);
  const manager: ModelValue = val('model') || {};
  const subagent: ModelValue = val('subagent_model') || {};
  const following = sameAsManager(subagent);
  const windows: Record<string, number> = val('compaction.context_windows') || {};
  // Remembers the subagents' own model while "same as the manager" is on,
  // so switching back doesn't lose it.
  const [ownSubagent, setOwnSubagent] = useState<ModelValue>(() => (sameAsManager(subagent) ? {...manager} : subagent));

  if (!config) return null;
  const invalid = invalidWindows(windows) ? 'A context window must be at least 1,024 tokens.' : !manager.provider || !manager.model ? 'Choose a model for the manager.' : !following && (!subagent.provider || !subagent.model) ? 'Choose a model for subagents, or use the manager’s.' : '';

  function assign(target: 'manager' | 'subagent', provider: string, model: string) {
    if (target === 'manager') {
      set('model', {...manager, provider, model});
      return;
    }
    const next = {...(following ? ownSubagent : subagent), provider, model};
    setOwnSubagent(next);
    set('subagent_model', next);
  }

  return (
    <section>
      <header className="settings-head">
        <h2>Models</h2>
        <p className="muted">The manager talks with you and decides what to do. Subagents take on pieces of work it hands out. Each can use any model from any provider you’ve set up.</p>
      </header>

      <Group title="Manager" note="Answers you, plans, and hands work to subagents.">
        <ModelFields value={manager} groups={groups} runtime={runtime} onChange={next => set('model', next)} overrides={windows} onOverride={next => set('compaction.context_windows', next)} />
      </Group>

      <Group title="Subagents" note="Work on the pieces the manager hands out, in parallel, each with its own context window.">
        <div className="segmented model-follow" role="radiogroup" aria-label="Subagent model">
          <button type="button" role="radio" aria-checked={following} className={following ? 'active' : ''} onClick={() => {
            if (!following) setOwnSubagent(subagent);
            set('subagent_model', {});
          }}>Same model as the manager</button>
          <button type="button" role="radio" aria-checked={!following} className={!following ? 'active' : ''} onClick={() => following && set('subagent_model', ownSubagent.provider ? ownSubagent : {...manager})}>Their own model</button>
        </div>
        {following ? (
          <p className="faint">Subagents use {keyOf(manager) ? <span className="mono">{keyOf(manager)}</span> : 'the manager’s model'}, and follow it when you change it.</p>
        ) : (
          <ModelFields value={subagent} groups={groups} runtime={runtime} onChange={next => {
            setOwnSubagent(next);
            set('subagent_model', next);
          }} overrides={windows} onOverride={next => set('compaction.context_windows', next)} />
        )}
        <div className="form-grid">
          <NumberField label="Subagents at once" min={1} max={16} value={val('agent.max_subagents')} onChange={v => set('agent.max_subagents', Math.max(1, Math.min(16, v || 1)))} help="The most the manager runs in parallel. More finishes sooner but uses more tokens at once." />
        </div>
      </Group>

      <Catalog groups={groups} runtime={runtime} manager={keyOf(manager)} subagent={following ? keyOf(manager) : keyOf(subagent)} onAssign={assign} />

      <SaveBar dirty={dirty} saving={saving} error={dirty ? invalid : ''} onSave={() => void save('Models saved. They apply from the next request.')} onDiscard={discard} />
    </section>
  );
}

/** Every model the providers offer, to pick from for either role. */
function Catalog({groups, runtime, manager, subagent, onAssign}: {groups: ModelGroup[]; runtime: Record<string, any>; manager: string; subagent: string; onAssign: (target: 'manager' | 'subagent', provider: string, model: string) => void}) {
  const [provider, setProvider] = useState(manager.split('/')[0] || groups[0]?.provider || '');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function refresh(force: boolean) {
    setLoading(true);
    setError('');
    try {
      appStore.set({models: await api.modelCatalog(force)});
    } catch (e) {
      setError(String(e));
      toastError(e);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    if (!groups.length) void refresh(false);
  }, []);

  const selected = groups.find(group => group.provider === provider) || groups[0];
  const q = query.trim().toLowerCase();
  const models = (selected?.models || []).filter(model => !q || `${model.name || ''} ${model.id} ${model.description || ''}`.toLowerCase().includes(q));
  const ready = providerReady(runtime, selected?.provider);

  return (
    <Group title="All models" note="Pick a model for either role. Changes apply when you save.">
      <div className="model-bar">
        <div className="segmented provider-tabs" role="radiogroup" aria-label="Provider">
          {groups.map(group => (
            <button key={group.provider} type="button" role="radio" aria-checked={group.provider === selected?.provider} className={group.provider === selected?.provider ? 'active' : ''} onClick={() => setProvider(group.provider)}>
              {providerNames[group.provider] || group.provider}<span className="num faint"> {group.models?.length || 0}</span>
            </button>
          ))}
        </div>
        <input className="input model-search" type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search models" aria-label="Search models" />
        <button type="button" className="btn" disabled={loading} onClick={() => void refresh(true)}>{loading ? 'Refreshing…' : 'Refresh list'}</button>
      </div>
      {error && <p className="notice bad" role="alert">{error}</p>}
      {selected?.error && <p className="notice bad" role="alert">{providerNames[selected.provider] || selected.provider}: {selected.error}</p>}
      {ready === false && <p className="notice">This provider isn’t set up yet. You can still pick its models; set it up in Accounts before using them.</p>}
      {!models.length && <p className="muted">{q ? 'No models match. Clear the search or try another provider.' : 'No models listed. Refresh the list.'}</p>}
      <div className="model-list">
        {models.map(model => {
          const key = `${selected!.provider}/${model.id}`;
          const isManager = key === manager;
          const isSubagent = key === subagent;
          return (
            <article key={key} className={`model-row ${isManager || isSubagent ? 'in-use' : ''}`} aria-label={model.name || model.id}>
              <div className="model-main">
                <div className="model-name">
                  <strong>{model.name || model.id}</strong>
                  {model.name && model.name !== model.id && <span className="mono faint">{model.id}</span>}
                  {model.reasoning && <span className="tag">Reasoning</span>}
                  {model.context_window ? <span className="faint num model-window">{formatTokens(model.context_window)} context</span> : null}
                  {isManager && <span className="tag warn">Manager</span>}
                  {isSubagent && <span className="tag warn">Subagents</span>}
                </div>
                {model.description && <p className="muted model-desc">{model.description}</p>}
              </div>
              <div className="model-assign" role="group" aria-label={`Use ${model.name || model.id} for`}>
                <button type="button" className={isManager ? 'btn btn-sm is-on' : 'btn btn-sm'} aria-pressed={isManager} aria-label={`Use ${model.name || model.id} for the manager`} onClick={() => onAssign('manager', selected!.provider, model.id)}>Manager</button>
                <button type="button" className={isSubagent ? 'btn btn-sm is-on' : 'btn btn-sm'} aria-pressed={isSubagent} aria-label={`Use ${model.name || model.id} for subagents`} onClick={() => onAssign('subagent', selected!.provider, model.id)}>Subagents</button>
              </div>
            </article>
          );
        })}
      </div>
    </Group>
  );
}
