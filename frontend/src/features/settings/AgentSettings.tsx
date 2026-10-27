// Agent behavior: limits, context management, skills and other settings.
// Models and their tuning live on the Models page.
import {Check, Group, NumberField, PercentField, SaveBar, TextField, useConfigDraft} from './form';

// Config paths this page owns. Saving copies only these onto the latest
// config, so edits made elsewhere (models, projects, servers) are kept.
const managed = [
  'agent.max_iterations', 'agent.use_responses',
  'compaction.enabled', 'compaction.shorten_ratio', 'compaction.summarize_ratio', 'compaction.history_ratio',
  'compaction.tool_digest_chars', 'compaction.tool_result_char_limit', 'compaction.approx_token_limit', 'compaction.default_focus',
  'editor.command', 'skill_dirs', 'ui.suggest_matching_skills', 'history_recent_limit', 'artifact_recent_limit', 'brand_prefix', 'tagline',
];

export function AgentSettings() {
  const {config, set, val, dirty, saving, save, discard} = useConfigDraft('agent-settings', managed);
  if (!config) return null;
  return (
    <section>
      <header className="settings-head">
        <h2>Agent</h2>
        <p className="muted">How far NullBot goes on its own, how it manages a long conversation, and where it finds skills. Models are on the Models page.</p>
      </header>

      <Group title="Limits">
        <div className="form-grid">
          <NumberField label="Steps per request" help="Model turns before NullBot stops and reports back." value={val('agent.max_iterations')} onChange={v => set('agent.max_iterations', v)} />
        </div>
        <Check label="Use the OpenAI Responses API when the model supports it" checked={!!val('agent.use_responses')} onChange={v => set('agent.use_responses', v)} />
      </Group>

      <Group title="Context" note="NullBot measures every request against the model’s context window and makes room in two steps, so long work doesn’t overflow it.">
        <div className="form-grid">
          <PercentField label="Shorten tool results at" help="Results the model has already read become the tool, its arguments and the start of the output. Skills are never shortened." value={val('compaction.shorten_ratio')} fallback={0.6} onChange={v => set('compaction.shorten_ratio', v)} />
          <PercentField label="Summarize at" help="If shortening isn’t enough, the model summarizes older messages. Recent ones stay word for word." value={val('compaction.summarize_ratio')} fallback={0.85} onChange={v => set('compaction.summarize_ratio', v)} />
        </div>
        <Check label="Shorten and summarize automatically" checked={!!val('compaction.enabled')} onChange={v => set('compaction.enabled', v)} />
        {!val('compaction.enabled') && <p className="faint">Off: nothing is shortened or summarized, so long requests can fail once the window fills. Tool results that wouldn’t fit are still cut.</p>}
        <div className="form-grid">
          <PercentField label="Earlier messages in a new request" help="How much of the window the conversation so far may take. Older messages stay readable through history search." value={val('compaction.history_ratio')} fallback={0.3} max={60} onChange={v => set('compaction.history_ratio', v)} />
          <NumberField label="Characters kept from a shortened result" value={val('compaction.tool_digest_chars')} onChange={v => set('compaction.tool_digest_chars', v)} />
          <NumberField label="Most of an oversized result shown" help="Characters. A tool result that wouldn’t fit is cut to this, with a note giving its full size." value={val('compaction.tool_result_char_limit')} onChange={v => set('compaction.tool_result_char_limit', v)} />
          <NumberField label="Window for an unknown model" help="Tokens. Used when a model’s size isn’t reported or known." value={val('compaction.approx_token_limit')} onChange={v => set('compaction.approx_token_limit', v)} />
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

      <SaveBar dirty={dirty} saving={saving} onSave={() => void save()} onDiscard={discard} />
    </section>
  );
}
