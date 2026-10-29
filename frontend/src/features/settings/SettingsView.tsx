import {useEffect, useState} from 'react';
import {useStore} from '../../lib/store';
import {api} from '../../lib/bindings';
import {guard, useUnsavedEdits} from '../../lib/dirty';
import {appStore, accents, applyAppearance, applyUIState, refreshState, type SettingsSection} from '../../state/app';
import ProjectsView from '../../ProjectsView';
import {ModelsSettings} from './ModelsSettings';
import {AccountsSettings} from './AccountsSettings';
import {SecretsSettings} from './SecretsSettings';
import {AgentSettings} from './AgentSettings';
import {UsageSettings} from './UsageSettings';
import {Segmented} from '../../ui/Tabs';
import {confirmDialog} from '../../ui/dialogs';
import {toast, toastError} from '../../ui/toast';

const sections: {id: SettingsSection; label: string; hint: string}[] = [
  {id: 'projects', label: 'Projects', hint: 'Folders and permissions'},
  {id: 'models', label: 'Models', hint: 'Manager and subagents'},
  {id: 'accounts', label: 'Accounts', hint: 'Sign-in and API keys'},
  {id: 'secrets', label: 'Secrets', hint: 'Vault, GitHub, cloud accounts'},
  {id: 'agent', label: 'Agent', hint: 'Effort, limits, context'},
  {id: 'prompts', label: 'Prompts', hint: 'System instructions'},
  {id: 'appearance', label: 'Appearance', hint: 'Theme and name'},
  {id: 'usage', label: 'Usage', hint: 'Tokens and cost'},
];

export function SettingsView() {
  const section = useStore(appStore, state => state.settingsSection);
  return (
    <div className="view settings">
      <nav className="settings-nav" aria-label="Settings">
        {sections.map(item => (
          <button key={item.id} className={item.id === section ? 'settings-link active' : 'settings-link'} aria-current={item.id === section ? 'page' : undefined} onClick={() => guard(() => appStore.set({settingsSection: item.id}))}>
            <span>{item.label}</span>
            <small className="faint">{item.hint}</small>
          </button>
        ))}
      </nav>
      <div className="settings-scroll">
        <div className="settings-page">
          {section === 'projects' && <ProjectsSettings />}
          {section === 'models' && <ModelsSettings />}
          {section === 'accounts' && <AccountsSettings />}
          {section === 'secrets' && <SecretsSettings />}
          {section === 'agent' && <AgentSettings />}
          {section === 'prompts' && <PromptSettings />}
          {section === 'appearance' && <AppearanceSettings />}
          {section === 'usage' && <UsageSettings />}
        </div>
      </div>
    </div>
  );
}

function ProjectsSettings() {
  const [dirty, setDirty] = useState(false);
  useUnsavedEdits('projects', dirty);
  return (
    <ProjectsView
      onDirtyChange={setDirty}
      load={api.projects}
      save={api.saveProjects}
      onSaved={state => {
        appStore.set({projects: state});
        void refreshState().catch(() => undefined);
        toast('Projects saved.', 'success');
      }}
      confirm={(title, body) => confirmDialog({title, body, confirmLabel: 'Allow', danger: true})}
    />
  );
}

// ----------------------------------------------------------------- prompts

function PromptSettings() {
  const prompts = useStore(appStore, state => state.config?.prompts || {});
  const [defaults, setDefaults] = useState<{manager: string; subagent: string} | null>(null);
  const [manager, setManager] = useState('');
  const [subagent, setSubagent] = useState('');
  const [saving, setSaving] = useState(false);
  const withAppend = (base: string, append?: string) => (append?.trim() ? `${base}\n\n${append.trim()}` : base);
  useEffect(() => {
    api.promptDefaults().then(next => {
      setDefaults(next);
      setManager(prompts.manager_prompt || withAppend(next.manager, prompts.manager_append));
      setSubagent(prompts.subagent_prompt || withAppend(next.subagent, prompts.subagent_append));
    }).catch(toastError);
  }, []);
  const same = (a: string, b: string) => a.trim() === b.trim();
  const managerCustom = !!defaults && !same(manager, defaults.manager);
  const subagentCustom = !!defaults && !same(subagent, defaults.subagent);
  async function save() {
    if (!defaults) return;
    setSaving(true);
    try {
      applyUIState(await api.savePrompts({
        ...prompts,
        manager_prompt: managerCustom ? manager : '',
        subagent_prompt: subagentCustom ? subagent : '',
        manager_append: '',
        subagent_append: '',
      }));
      toast('Prompts saved. They apply from the next request.', 'success');
    } catch (error) {
      toastError(error);
    } finally {
      setSaving(false);
    }
  }
  return (
    <section>
      <header className="settings-head">
        <h2>Prompts</h2>
        <p className="muted">The standing instructions each agent gets. Leave a prompt as it is to keep receiving improvements to the default.</p>
      </header>
      {!defaults ? <p className="muted">Loading the default prompts…</p> : (
        <>
          <PromptField label="Manager" value={manager} onChange={setManager} custom={managerCustom} onReset={() => setManager(defaults.manager)} />
          <PromptField label="Subagents" value={subagent} onChange={setSubagent} custom={subagentCustom} onReset={() => setSubagent(defaults.subagent)} />
          <div className="form-actions">
            <button className="btn btn-primary" disabled={saving} onClick={() => void save()}>Save prompts</button>
          </div>
        </>
      )}
    </section>
  );
}

function PromptField({label, value, onChange, custom, onReset}: {label: string; value: string; onChange: (value: string) => void; custom: boolean; onReset: () => void}) {
  return (
    <div className="settings-group">
      <div className="group-head">
        <h3>{label}</h3>
        {custom ? <span className="tag warn">Customized</span> : <span className="tag">Default</span>}
        <span className="project-spacer" />
        {custom && <button className="btn btn-sm" onClick={onReset}>Use the default</button>}
      </div>
      <textarea className="textarea mono prompt-editor" spellCheck={false} rows={16} value={value} onChange={event => onChange(event.target.value)} aria-label={`${label} prompt`} />
    </div>
  );
}

// -------------------------------------------------------------- appearance

const accentNames: Record<string, string> = {amber: 'Amber', teal: 'Teal', blue: 'Blue', violet: 'Violet', rose: 'Rose'};

function AppearanceSettings() {
  const appearance = useStore(appStore, state => state.config?.ui?.appearance || 'system');
  const accent = useStore(appStore, state => state.config?.ui?.accent || 'amber');
  const botName = useStore(appStore, state => state.config?.bot_name || state.runtime.bot_name || 'NullBot');
  const [name, setName] = useState(botName);
  useEffect(() => setName(botName), [botName]);
  async function set(nextAppearance: string, nextAccent: string) {
    applyAppearance(nextAppearance, nextAccent);
    try {
      applyUIState(await api.setAppearance(nextAppearance, nextAccent));
    } catch (error) {
      toastError(error);
    }
  }
  return (
    <section>
      <header className="settings-head">
        <h2>Appearance</h2>
        <p className="muted">How NullBot looks on this computer.</p>
      </header>
      <div className="settings-group">
        <h3>Theme</h3>
        <Segmented label="Theme" value={appearance} onChange={value => void set(value, accent)} options={[{id: 'system', label: 'Match the system'}, {id: 'light', label: 'Light'}, {id: 'dark', label: 'Dark'}]} />
      </div>
      <div className="settings-group">
        <h3>Signal color</h3>
        <p className="muted">Marks live work, such as a running step, and keyboard focus.</p>
        <div className="swatches" role="radiogroup" aria-label="Signal color">
          {accents.map(id => (
            <button key={id} role="radio" aria-checked={id === accent} className={id === accent ? 'swatch active' : 'swatch'} data-swatch={id} onClick={() => void set(appearance, id)}>
              <span className="swatch-chip" aria-hidden="true" />
              {accentNames[id]}
            </button>
          ))}
        </div>
      </div>
      <form className="settings-group" onSubmit={async event => {
        event.preventDefault();
        try {
          applyUIState(await api.setBotName(name.trim()));
          toast('Name saved.', 'success');
        } catch (error) {
          toastError(error);
        }
      }}>
        <h3>Bot name</h3>
        <p className="muted">What the assistant is called in the conversation and in its own replies.</p>
        <div className="inline-form">
          <input className="input" value={name} onChange={event => setName(event.target.value)} aria-label="Bot name" maxLength={40} />
          <button type="submit" className="btn" disabled={!name.trim() || name.trim() === botName}>Save name</button>
        </div>
      </form>
    </section>
  );
}
