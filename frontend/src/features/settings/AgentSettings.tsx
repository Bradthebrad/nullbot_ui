import {useEffect, useMemo, useState, type ReactNode} from 'react';
import {useStore} from '../../lib/store';
import {api} from '../../lib/bindings';
import type {ModelGroup} from '../../lib/types';
import {appStore, applyUIState} from '../../state/app';
import {toast, toastError} from '../../ui/toast';

// Config paths this form owns. Saving copies only these onto the latest
// config, so edits made elsewhere (projects, servers) are never overwritten.
const managed = [
  'model', 'subagent_model', 'agent', 'compaction', 'editor.command', 'skill_dirs', 'ui.suggest_matching_skills',
  'history_recent_limit', 'artifact_recent_limit', 'brand_prefix', 'tagline',
];

function getPath(obj: any, path: string) {
  return path.split('.').reduce((cursor, key) => (cursor == null ? undefined : cursor[key]), obj);
}

function setPath(obj: any, path: string, value: unknown) {
  const parts = path.split('.');
  let cursor = obj;
  for (const part of parts.slice(0, -1)) {
    cursor[part] = cursor[part] && typeof cursor[part] === 'object' ? {...cursor[part]} : {};
    cursor = cursor[part];
  }
  cursor[parts[parts.length - 1]] = value;
}

const efforts = [
  {id: '', label: 'Provider default'},
  {id: 'minimal', label: 'Minimal'},
  {id: 'low', label: 'Low'},
  {id: 'medium', label: 'Medium'},
  {id: 'high', label: 'High'},
  {id: 'xhigh', label: 'Highest'},
];
const effortHelp: Record<string, string> = {
  '': 'The provider decides how much to think.',
  minimal: 'Barely any deliberation. Best for tiny edits and quick answers.',
  low: 'Light reasoning for straightforward tasks.',
  medium: 'Balanced reasoning for normal agent work.',
  high: 'Careful reasoning for larger, multi-step work.',
  xhigh: 'The most reasoning the provider offers. Slower and costlier.',
};

export function AgentSettings() {
  const config = useStore(appStore, state => state.config);
  const groups = useStore(appStore, state => state.models);
  const [draft, setDraft] = useState<any>(() => structuredClone(config || {}));
  const [saving, setSaving] = useState(false);
  const baseline = useMemo(() => JSON.stringify(managed.map(path => getPath(config, path) ?? null)), [config]);
  const current = JSON.stringify(managed.map(path => getPath(draft, path) ?? null));
  const dirty = baseline !== current;

  // Pick up outside changes when there are no local edits.
  useEffect(() => {
    if (!dirty) setDraft(structuredClone(config || {}));
  }, [config]);

  const set = (path: string, value: unknown) => setDraft((prev: any) => {
    const next = {...prev};
    setPath(next, path, value);
    return next;
  });
  const val = (path: string) => getPath(draft, path);

  async function save() {
    setSaving(true);
    try {
      const next = structuredClone(appStore.get().config || {});
      for (const path of managed) setPath(next, path, getPath(draft, path));
      applyUIState(await api.saveConfig(next, {}));
      toast('Settings saved. They apply from the next request.', 'success');
    } catch (error) {
      toastError(error);
    } finally {
      setSaving(false);
    }
  }

  if (!config) return null;
  return (
    <section>
      <header className="settings-head">
        <h2>Agent</h2>
        <p className="muted">How hard NullBot thinks, how far it goes on its own, and how it manages a long conversation.</p>
      </header>

      <Group title="Manager model" note="Pick models from the Models page; tune them here.">
        <ModelFields value={val('model') || {}} groups={groups} onChange={(field, value) => set(`model.${field}`, value)} />
      </Group>
      <Group title="Subagent model" note="Used for work the manager hands out. Leave the provider empty to use the manager’s model.">
        <ModelFields value={val('subagent_model') || {}} groups={groups} allowEmpty onChange={(field, value) => set(`subagent_model.${field}`, value)} />
      </Group>

      <Group title="Limits">
        <div className="form-grid">
          <NumberField label="Steps per request" help="Model turns before NullBot stops and reports back." value={val('agent.max_iterations')} onChange={v => set('agent.max_iterations', v)} />
          <NumberField label="Subagents at once" help="How many pieces of work can run in parallel." value={val('agent.max_subagents')} onChange={v => set('agent.max_subagents', v)} />
        </div>
        <Check label="Use the OpenAI Responses API when the model supports it" checked={!!val('agent.use_responses')} onChange={v => set('agent.use_responses', v)} />
      </Group>

      <Group title="Long conversations" note="Older messages are summarized so the model keeps room for new work.">
        <Check label="Summarize older messages automatically" checked={!!val('compaction.enabled')} onChange={v => set('compaction.enabled', v)} />
        <div className="form-grid">
          <NumberField label="Context size (tokens)" value={val('compaction.approx_token_limit')} onChange={v => set('compaction.approx_token_limit', v)} />
          <NumberField label="Summarize when this full (%)" value={Math.round((val('compaction.threshold_ratio') || 0.75) * 100)} onChange={v => set('compaction.threshold_ratio', Math.min(100, Math.max(10, v)) / 100)} />
          <NumberField label="Or after this many messages" value={val('compaction.message_count_limit')} onChange={v => set('compaction.message_count_limit', v)} />
          <NumberField label="Always keep the last" help="Messages kept word for word." value={val('compaction.keep_last_messages')} onChange={v => set('compaction.keep_last_messages', v)} />
          <NumberField label="Tool output kept (characters)" value={val('compaction.tool_result_char_limit')} onChange={v => set('compaction.tool_result_char_limit', v)} />
        </div>
        <TextField label="What summaries should keep" placeholder="Decisions, open questions, file paths" value={val('compaction.default_focus') || ''} onChange={v => set('compaction.default_focus', v)} />
      </Group>

      <Group title="Skills">
        <Check label="Suggest a skill when a message matches one" checked={!!val('ui.suggest_matching_skills')} onChange={v => set('ui.suggest_matching_skills', v)} />
        <label className="field">
          <span>Skill folders</span>
          <textarea className="textarea mono" rows={3} value={(val('skill_dirs') || []).join('\n')} onChange={event => set('skill_dirs', event.target.value.split('\n').map(line => line.trim()).filter(Boolean))} />
          <small>One folder per line. Each skill is a folder with a SKILL.md file.</small>
        </label>
      </Group>

      <Group title="Other">
        <div className="form-grid">
          <TextField label="Editor command" placeholder="code" value={val('editor.command') || ''} onChange={v => set('editor.command', v)} />
          <NumberField label="Recent sessions listed" value={val('history_recent_limit')} onChange={v => set('history_recent_limit', v)} />
          <NumberField label="Recent files listed" value={val('artifact_recent_limit')} onChange={v => set('artifact_recent_limit', v)} />
          <TextField label="Brand prefix" value={val('brand_prefix') || ''} onChange={v => set('brand_prefix', v)} />
          <TextField label="Tagline" value={val('tagline') || ''} onChange={v => set('tagline', v)} />
        </div>
        {config.app_dir && <p className="faint">NullBot keeps its settings, sessions and plans in <span className="mono">{config.app_dir}</span>.</p>}
      </Group>

      <footer className={`save-bar ${dirty ? 'is-dirty' : ''}`}>
        <div className="save-bar-text">{dirty ? <strong>You have unsaved changes.</strong> : <span className="muted">Settings are up to date.</span>}</div>
        {dirty && <button className="btn" onClick={() => setDraft(structuredClone(config))}>Discard</button>}
        <button className="btn btn-primary" disabled={!dirty || saving} onClick={() => void save()}>Save settings</button>
      </footer>
    </section>
  );
}

function Group({title, note, children}: {title: string; note?: string; children: ReactNode}) {
  return (
    <div className="settings-group">
      <h3>{title}</h3>
      {note && <p className="muted">{note}</p>}
      {children}
    </div>
  );
}

function NumberField({label, value, onChange, help}: {label: string; value: number | undefined; onChange: (value: number) => void; help?: string}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input className="input num" type="number" min={0} value={value ?? ''} onChange={event => onChange(Number(event.target.value || 0))} />
      {help && <small>{help}</small>}
    </label>
  );
}

function TextField({label, value, onChange, placeholder}: {label: string; value: string; onChange: (value: string) => void; placeholder?: string}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input className="input" value={value} placeholder={placeholder} onChange={event => onChange(event.target.value)} />
    </label>
  );
}

function Check({label, checked, onChange}: {label: string; checked: boolean; onChange: (value: boolean) => void}) {
  return <label className="check"><input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} />{label}</label>;
}

function ModelFields({value, groups, onChange, allowEmpty}: {value: any; groups: ModelGroup[]; onChange: (field: string, value: unknown) => void; allowEmpty?: boolean}) {
  const providers = [...new Set([...(value.provider ? [value.provider] : []), ...groups.map(g => g.provider)])];
  const models = groups.find(g => g.provider === value.provider)?.models || [];
  const ids = [...new Set([...(value.model ? [value.model] : []), ...models.map(m => m.id)])];
  return (
    <div className="form-grid">
      <label className="field">
        <span>Provider</span>
        <select className="select" value={value.provider || ''} onChange={event => {
          const provider = event.target.value;
          onChange('provider', provider);
          const first = groups.find(g => g.provider === provider)?.models?.[0]?.id;
          onChange('model', provider ? first || '' : '');
        }}>
          {(allowEmpty || !value.provider) && <option value="">{allowEmpty ? 'Same as manager' : 'Choose'}</option>}
          {providers.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
      </label>
      <label className="field">
        <span>Model</span>
        <select className="select" value={value.model || ''} disabled={!value.provider} onChange={event => onChange('model', event.target.value)}>
          {!value.model && <option value="">Choose</option>}
          {ids.map(id => <option key={id} value={id}>{models.find(m => m.id === id)?.name || id}</option>)}
        </select>
      </label>
      <label className="field">
        <span>Thinking effort</span>
        <select className="select" value={value.reasoning_effort || ''} disabled={!value.provider} onChange={event => onChange('reasoning_effort', event.target.value)}>
          {efforts.map(e => <option key={e.id} value={e.id}>{e.label}</option>)}
          {value.reasoning_effort && !efforts.some(e => e.id === value.reasoning_effort) && <option value={value.reasoning_effort}>{value.reasoning_effort}</option>}
        </select>
        <small>{effortHelp[value.reasoning_effort || ''] || ''}</small>
      </label>
      <label className="field">
        <span>Reply length limit (tokens)</span>
        <input className="input num" type="number" min={0} placeholder="Provider default" value={value.max_tokens || ''} disabled={!value.provider} onChange={event => onChange('max_tokens', Number(event.target.value || 0))} />
      </label>
    </div>
  );
}
