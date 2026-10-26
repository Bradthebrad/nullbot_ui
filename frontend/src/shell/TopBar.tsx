import {ChevronDown, Folder, PanelRight, Play, Search, Square} from 'lucide-react';
import {useStore, shallowEqual} from '../lib/store';
import {api} from '../lib/bindings';
import {appStore, applyUIState, openSettings, setView, toggleInspector, type View} from '../state/app';
import {chatStore, isBusy, resumeRuns, stopRun} from '../state/chat';
import {MenuButton, type MenuItem} from '../ui/Menu';
import {toast, toastError} from '../ui/toast';
import {formatDuration, permissionLabel, shorten} from '../lib/format';
import {useNow} from '../lib/useNow';

const titles: Record<View, string> = {
  chat: 'Chat',
  activity: 'Activity',
  files: 'Files',
  tools: 'Tools',
  history: 'History',
  settings: 'Settings',
};

export function TopBar() {
  const view = useStore(appStore, state => state.view);
  const inspectorOpen = useStore(appStore, state => state.inspectorOpen);
  return (
    <header className="topbar">
      <div className="topbar-left">
        {view === 'chat' ? (
          <>
            <ProjectSwitcher />
            <ModelSwitcher />
          </>
        ) : (
          <h1 className="topbar-title">{titles[view]}</h1>
        )}
      </div>
      <div className="topbar-right">
        <RunState />
        <ToolHealth />
        <button className="btn btn-ghost palette-trigger" onClick={() => appStore.set({paletteOpen: true})} title="Search and commands (Ctrl+K)">
          <Search size={14} />
          <span>Commands</span>
          <kbd>Ctrl K</kbd>
        </button>
        {view === 'chat' && (
          <button className={`btn btn-ghost btn-icon ${inspectorOpen ? 'is-on' : ''}`} aria-pressed={inspectorOpen} title="Activity panel (Ctrl+.)" aria-label="Toggle activity panel" onClick={() => toggleInspector()}>
            <PanelRight size={16} />
          </button>
        )}
      </div>
    </header>
  );
}

function ProjectSwitcher() {
  const projects = useStore(appStore, state => state.projects);
  if (!projects) return null;
  const primary = projects.projects.find(p => p.id === projects.primary_project_id);
  const items: MenuItem[] = [
    {kind: 'heading', label: 'Primary project'},
    ...projects.projects.map(project => ({
      label: project.name || project.path,
      hint: permissionLabel(project.permission, project.allow),
      checked: project.id === projects.primary_project_id,
      onSelect: async () => {
        if (project.id === projects.primary_project_id) return;
        try {
          const next = await api.setPrimaryProject(project.id);
          appStore.set({projects: next});
          applyUIState(await api.state());
          toast(`NullBot now works in ${project.name}.`, 'success');
        } catch (error) {
          toastError(error);
        }
      },
    })),
    {kind: 'separator'},
    {label: 'Manage projects and permissions…', onSelect: () => openSettings('projects')},
  ];
  return (
    <MenuButton
      className="btn btn-ghost chip-button"
      title={primary?.path}
      label={<><Folder size={14} /><span className="chip-main">{primary?.name || 'No project'}</span><span className="chip-sub">{primary ? permissionLabel(primary.permission, primary.allow) : ''}</span><ChevronDown size={13} /></>}
      items={items}
    />
  );
}

function ModelSwitcher() {
  const {model, provider, effort} = useStore(appStore, state => ({model: state.runtime.model, provider: state.runtime.provider, effort: state.runtime.reasoning_effort}), shallowEqual);
  const models = useStore(appStore, state => state.models);
  const group = models.find(g => g.provider === provider);
  const options = (group?.models || []).slice(0, 14);
  const items: MenuItem[] = [
    {kind: 'heading', label: provider ? `${provider} models` : 'Models'},
    ...options.map(option => ({
      label: option.name || option.id,
      hint: option.name && option.name !== option.id ? shorten(option.id, 28) : undefined,
      checked: option.id === model,
      onSelect: async () => {
        try {
          applyUIState(await api.setModel(provider, option.id, 'manager'));
          toast(`Using ${option.name || option.id}.`, 'success');
        } catch (error) {
          toastError(error);
        }
      },
    })),
    {kind: 'separator'},
    {label: 'All models and providers…', onSelect: () => openSettings('models')},
  ];
  return (
    <MenuButton
      className="btn btn-ghost chip-button"
      label={<><span className="chip-main">{model || 'Choose a model'}</span>{effort && <span className="chip-sub">{effort}</span>}<ChevronDown size={13} /></>}
      items={items}
    />
  );
}

function RunState() {
  const busy = useStore(chatStore, isBusy);
  const paused = useStore(chatStore, state => !!state.submissions.paused);
  const startedAt = useStore(chatStore, state => {
    const turns = state.activity.turns;
    for (let i = turns.length - 1; i >= 0; i--) if (turns[i].state === 'running' && turns[i].lane !== 'also') return turns[i].startedAt || '';
    return '';
  });
  const now = useNow(busy);
  if (paused) {
    return (
      <div className="runstate">
        <span className="dot idle" />
        <span>Paused</span>
        <button className="btn btn-sm" onClick={() => void resumeRuns()}><Play size={12} />Resume</button>
      </div>
    );
  }
  if (!busy) return null;
  const elapsed = startedAt ? now - Date.parse(startedAt) : NaN;
  return (
    <div className="runstate" role="status">
      <span className="dot live" />
      <span>Working{Number.isFinite(elapsed) ? <span className="num faint"> {formatDuration(elapsed)}</span> : null}</span>
      <button className="btn btn-sm" onClick={() => void stopRun()}><Square size={11} />Stop</button>
    </div>
  );
}

function ToolHealth() {
  const servers = useStore(appStore, state => state.mcp);
  const enabled = servers.filter(s => s.enabled);
  if (!servers.length) return null;
  const failed = enabled.filter(s => s.state === 'error');
  const starting = enabled.some(s => s.state === 'starting');
  const label = failed.length ? `${failed.length} tool server${failed.length === 1 ? '' : 's'} failed` : `${enabled.length} tool server${enabled.length === 1 ? '' : 's'}`;
  return (
    <button className="btn btn-ghost tool-health" title="Tool servers" onClick={() => {
      if (failed[0]) appStore.set({selectedServer: failed[0].id});
      appStore.set({toolsTab: 'servers'});
      setView('tools');
    }}>
      <span className={`dot ${failed.length ? 'bad' : starting ? 'live' : enabled.length ? 'ok' : 'off'}`} />
      {label}
    </button>
  );
}
