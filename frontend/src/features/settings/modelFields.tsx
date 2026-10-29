// Fields for one model role: provider, model, thinking effort, reply length
// and context window.
import {useEffect, useState} from 'react';
import {api} from '../../lib/bindings';
import {formatTokens} from '../../lib/format';
import type {ModelGroup} from '../../lib/types';
import {openSettings} from '../../state/app';

export type ModelValue = {provider?: string; model?: string; reasoning_effort?: string; max_tokens?: number; temperature?: number};

export const efforts = [
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

/** A provider's name for people: a local server goes by its own title. */
export function providerLabel(provider: string, groups: ModelGroup[] = []): string {
  return providerNames[provider] || groups.find(g => g.provider === provider)?.title || (provider.startsWith('local:') ? provider.slice(6) : provider);
}

export const providerNames: Record<string, string> = {codex: 'ChatGPT subscription (Codex)', 'claude-cli': 'Claude subscription (Claude CLI)', openai: 'OpenAI', anthropic: 'Anthropic', openrouter: 'OpenRouter'};

/** Whether NullBot has what it needs to call a provider, from runtime status. */
export function providerReady(runtime: Record<string, any>, provider?: string): boolean | undefined {
  switch (provider) {
    case 'codex': return !!runtime.codex_auth_set;
    case 'claude-cli': return !!runtime.claude_cli_found;
    case 'openai': return !!runtime.openai_api_key_set;
    case 'anthropic': return !!runtime.anthropic_api_key_set;
    case 'openrouter': return !!runtime.openrouter_api_key_set;
    default: return undefined;
  }
}

export const minWindow = 1024;

export function invalidWindows(windows?: Record<string, number>): boolean {
  return Object.values(windows || {}).some(tokens => tokens > 0 && tokens < minWindow);
}

const windowSource: Record<string, string> = {
  override: 'Your setting',
  provider: 'Reported by the provider',
  learned: 'Learned from a provider error',
  'built-in': 'Typical for this model family',
  default: 'Unknown model, so the default for unknown models',
};

/** The context window a model gets without an override, and its source. */
function useBaseWindow(provider?: string, model?: string) {
  const [base, setBase] = useState<{tokens: number; source: string} | null>(null);
  useEffect(() => {
    setBase(null);
    if (!provider || !model) return;
    let live = true;
    api.contextWindow(provider, model).then(w => {if (live && w?.tokens) setBase(w);}).catch(() => undefined);
    return () => {live = false;};
  }, [provider, model]);
  return base;
}

export function ContextWindowField({provider, model, overrides, onOverride}: {provider?: string; model?: string; overrides: Record<string, number>; onOverride: (windows: Record<string, number>) => void}) {
  const key = provider && model ? `${provider.toLowerCase()}/${model}` : '';
  const base = useBaseWindow(provider, model);
  const override = key ? overrides[key] : undefined;
  // Keep what is typed, even while it is still too small to save, so the
  // field can be edited digit by digit; saving waits until it is valid.
  const set = (tokens: number) => {
    const next = {...overrides};
    if (tokens > 0) next[key] = Math.floor(tokens);
    else delete next[key];
    onOverride(next);
  };
  const sourceText = base ? windowSource[base.source] || '' : '';
  const tooSmall = !!override && override < minWindow;
  return (
    <label className="field">
      <span>Context window (tokens)</span>
      <input className="input num" type="number" min={0} disabled={!key} aria-invalid={tooSmall} placeholder={base ? base.tokens.toLocaleString() : ''} value={override || ''} onChange={event => set(Number(event.target.value || 0))} />
      <small className={tooSmall ? 'bad-text' : undefined}>
        {tooSmall ? `Use at least ${minWindow.toLocaleString()} tokens, or clear the field.`
          : !base ? 'Looking up the size…'
            : override ? `Your setting. Clear it to use ${base.tokens.toLocaleString()} (${sourceText.toLowerCase()}).`
              : `${sourceText}. Enter a number to override it.`}
      </small>
    </label>
  );
}

const customOption = '__custom__';

/** A model from the provider's list, or any model ID typed in. */
function ModelPicker({provider, value, groups, onChange}: {provider?: string; value?: string; groups: ModelGroup[]; onChange: (model: string) => void}) {
  const models = groups.find(g => g.provider === provider)?.models || [];
  const listed = models.find(m => m.id === value);
  const [typing, setTyping] = useState(false);
  const custom = typing || !models.length || (!!value && !listed);
  const detail = listed ? [listed.reasoning ? 'Reasoning model' : '', listed.context_window ? `${formatTokens(listed.context_window)} context` : ''].filter(Boolean).join(', ') : '';
  if (custom) {
    return (
      <label className="field">
        <span>Model</span>
        <input className="input mono" value={value || ''} disabled={!provider} placeholder="Model ID, as the provider names it" onChange={event => onChange(event.target.value.trim())} />
        <small>
          {models.length > 0 ? <button type="button" className="link-button" onClick={() => {
            setTyping(false);
            if (!listed) onChange(models[0].id);
          }}>Choose from the list</button> : 'Refresh the list on this page to load this provider’s models.'}
        </small>
      </label>
    );
  }
  return (
    <label className="field">
      <span>Model</span>
      <select className="select" value={value || ''} disabled={!provider} onChange={event => {
        if (event.target.value === customOption) setTyping(true);
        else onChange(event.target.value);
      }}>
        {!value && <option value="">Choose</option>}
        {models.map(m => <option key={m.id} value={m.id}>{m.name || m.id}</option>)}
        <option value={customOption}>Another model ID…</option>
      </select>
      {detail && <small>{detail}.</small>}
    </label>
  );
}

export function ModelFields({value, groups, runtime, onChange, overrides, onOverride}: {
  value: ModelValue;
  groups: ModelGroup[];
  runtime: Record<string, any>;
  onChange: (next: ModelValue) => void;
  overrides: Record<string, number>;
  onOverride: (windows: Record<string, number>) => void;
}) {
  const providers = [...new Set([...groups.map(g => g.provider), ...(value.provider ? [value.provider] : [])])];
  const ready = providerReady(runtime, value.provider);
  const set = (patch: Partial<ModelValue>) => onChange({...value, ...patch});
  return (
    <>
      <div className="form-grid">
        <label className="field">
          <span>Provider</span>
          <select className="select" value={value.provider || ''} onChange={event => {
            const provider = event.target.value;
            set({provider, model: groups.find(g => g.provider === provider)?.models?.[0]?.id || ''});
          }}>
            {!value.provider && <option value="">Choose</option>}
            {providers.map(p => <option key={p} value={p}>{providerLabel(p, groups)}{providerReady(runtime, p) === false ? ' (not set up)' : ''}</option>)}
          </select>
        </label>
        <ModelPicker provider={value.provider} value={value.model} groups={groups} onChange={model => set({model})} />
        <label className="field">
          <span>Thinking effort</span>
          <select className="select" value={value.reasoning_effort || ''} disabled={!value.provider} onChange={event => set({reasoning_effort: event.target.value})}>
            {efforts.map(e => <option key={e.id} value={e.id}>{e.label}</option>)}
            {value.reasoning_effort && !efforts.some(e => e.id === value.reasoning_effort) && <option value={value.reasoning_effort}>{value.reasoning_effort}</option>}
          </select>
          <small>{effortHelp[value.reasoning_effort || ''] || ''}</small>
        </label>
        <label className="field">
          <span>Reply length limit (tokens)</span>
          <input className="input num" type="number" min={0} placeholder="Provider default" value={value.max_tokens || ''} disabled={!value.provider} onChange={event => set({max_tokens: Number(event.target.value || 0)})} />
          <small>Room kept for the reply is taken out of the context window.</small>
        </label>
        {value.provider && value.model && <ContextWindowField provider={value.provider} model={value.model} overrides={overrides} onOverride={onOverride} />}
      </div>
      {ready === false && (
        <p className="notice bad">
          {providerNames[value.provider || ''] || value.provider} isn’t set up yet, so requests to it will fail.{' '}
          <button type="button" className="link-button" onClick={() => openSettings('accounts')}>Set it up in Accounts</button>
        </p>
      )}
    </>
  );
}
