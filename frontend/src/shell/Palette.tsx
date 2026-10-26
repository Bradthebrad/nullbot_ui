import {useEffect, useMemo, useRef, useState} from 'react';
import {Search} from 'lucide-react';
import {useStore} from '../lib/store';
import {api} from '../lib/bindings';
import {appStore, applyAppearance, applyUIState, openSettings, setView, toggleInspector, type SettingsSection} from '../state/app';
import {analyzeWorkspace, chatStore, clearConversation, compactConversation, createPlan, isBusy, resumeRuns, stopRun} from '../state/chat';
import {confirmDialog, promptDialog} from '../ui/dialogs';
import {toast, toastError} from '../ui/toast';

type Command = {id: string; title: string; group: string; keywords?: string; hint?: string; run: () => void | Promise<void>};

function useCommands(): Command[] {
  const projects = useStore(appStore, state => state.projects);
  const mcp = useStore(appStore, state => state.mcp);
  const busy = useStore(chatStore, isBusy);
  const paused = useStore(chatStore, state => !!state.submissions.paused);
  const config = useStore(appStore, state => state.config);
  return useMemo(() => {
    const go = (view: Parameters<typeof setView>[0]) => () => setView(view);
    const section = (id: SettingsSection) => () => openSettings(id);
    const list: Command[] = [
      {id: 'go-chat', group: 'Go to', title: 'Chat', hint: 'Ctrl+1', run: go('chat')},
      {id: 'go-activity', group: 'Go to', title: 'Activity: runs, plans and schedules', hint: 'Ctrl+2', run: go('activity')},
      {id: 'go-files', group: 'Go to', title: 'Files', hint: 'Ctrl+3', run: go('files')},
      {id: 'go-tools', group: 'Go to', title: 'Tools: servers, skills and marketplace', hint: 'Ctrl+4', run: go('tools')},
      {id: 'go-history', group: 'Go to', title: 'History', hint: 'Ctrl+5', run: go('history')},
      {id: 'go-projects', group: 'Settings', title: 'Projects and permissions', keywords: 'folders access workspace', run: section('projects')},
      {id: 'go-models', group: 'Settings', title: 'Models', keywords: 'provider openai anthropic codex', run: section('models')},
      {id: 'go-accounts', group: 'Settings', title: 'Accounts and API keys', keywords: 'keys credentials gmail', run: section('accounts')},
      {id: 'go-agent', group: 'Settings', title: 'Agent behavior and limits', keywords: 'iterations subagents compaction', run: section('agent')},
      {id: 'go-prompts', group: 'Settings', title: 'System prompts', run: section('prompts')},
      {id: 'go-appearance', group: 'Settings', title: 'Appearance and bot name', keywords: 'theme dark light color', run: section('appearance')},
      {id: 'go-usage', group: 'Settings', title: 'Usage and cost', keywords: 'tokens', run: section('usage')},
      {id: 'new', group: 'Conversation', title: 'New conversation', keywords: 'clear reset', run: async () => {
        if (await confirmDialog({title: 'Start a new conversation?', body: 'The visible conversation is cleared. Saved sessions are kept.', confirmLabel: 'Start new'})) await clearConversation();
      }},
      {id: 'compact', group: 'Conversation', title: 'Compact the conversation', keywords: 'summarize context', run: async () => {
        const focus = await promptDialog({title: 'Compact the conversation', label: 'Focus (optional)', placeholder: 'What to keep in detail', confirmLabel: 'Compact', optional: true, body: 'Older messages are summarized so the model has room for new work.'});
        if (focus !== null) await compactConversation(focus);
      }},
      {id: 'analyze', group: 'Conversation', title: 'Analyze the workspace', run: async () => {
        const focus = await promptDialog({title: 'Analyze', label: 'What should the analysis focus on?', confirmLabel: 'Analyze'});
        if (focus) await analyzeWorkspace(focus);
      }},
      {id: 'plan', group: 'Conversation', title: 'Create a plan', run: async () => {
        const focus = await promptDialog({title: 'Create a plan', label: 'Goal', placeholder: 'What should the plan accomplish?', confirmLabel: 'Create plan'});
        if (focus) {
          await createPlan(focus);
          appStore.set({activityTab: 'plans'});
        }
      }},
      {id: 'save', group: 'Conversation', title: 'Save the conversation as a session', run: async () => {
        const name = await promptDialog({title: 'Save conversation', label: 'Session name', confirmLabel: 'Save'});
        if (!name) return;
        try {
          await api.saveCurrentSession(name);
          toast('Session saved.', 'success');
        } catch (error) {
          toastError(error);
        }
      }},
      {id: 'inspector', group: 'View', title: 'Show or hide the activity panel', hint: 'Ctrl+.', run: () => toggleInspector()},
      ...(['system', 'light', 'dark'] as const).map(mode => ({
        id: `appearance-${mode}`, group: 'View', title: `Use ${mode === 'system' ? 'the system appearance' : `${mode} appearance`}`, keywords: 'theme',
        run: async () => {
          applyAppearance(mode, config?.ui?.accent);
          try {
            applyUIState(await api.setAppearance(mode, config?.ui?.accent || ''));
          } catch (error) {
            toastError(error);
          }
        },
      })),
    ];
    if (busy) list.unshift({id: 'stop', group: 'Run', title: 'Stop the current request', run: () => stopRun()});
    if (paused) list.unshift({id: 'resume', group: 'Run', title: 'Resume queued requests', run: () => resumeRuns()});
    for (const project of projects?.projects || []) {
      if (project.id === projects?.primary_project_id) continue;
      list.push({id: `primary-${project.id}`, group: 'Projects', title: `Work in ${project.name}`, keywords: project.path, run: async () => {
        try {
          appStore.set({projects: await api.setPrimaryProject(project.id)});
          applyUIState(await api.state());
          toast(`NullBot now works in ${project.name}.`, 'success');
        } catch (error) {
          toastError(error);
        }
      }});
    }
    for (const server of mcp.filter(s => s.enabled)) {
      list.push({id: `restart-${server.id}`, group: 'Tool servers', title: `${server.state === 'ready' ? 'Restart' : 'Start'} ${server.name}`, run: async () => {
        try {
          await (server.state === 'ready' ? api.restartMCPServer(server.id) : api.startMCPServer(server.id));
          toast(`${server.name} is running.`, 'success');
        } catch (error) {
          toastError(error);
        }
      }});
    }
    return list;
  }, [projects, mcp, busy, paused, config]);
}

function score(command: Command, query: string): number {
  if (!query) return 1;
  const hay = `${command.title} ${command.group} ${command.keywords || ''}`.toLowerCase();
  const q = query.toLowerCase().trim();
  if (command.title.toLowerCase().startsWith(q)) return 3;
  if (hay.includes(q)) return 2;
  const words = q.split(/\s+/);
  return words.every(word => hay.includes(word)) ? 1 : 0;
}

export function Palette() {
  const open = useStore(appStore, state => state.paletteOpen);
  if (!open) return null;
  return <PaletteDialog />;
}

function PaletteDialog() {
  const commands = useCommands();
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const ref = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const results = commands.map(command => ({command, s: score(command, query)})).filter(r => r.s > 0).sort((a, b) => b.s - a.s).map(r => r.command).slice(0, 40);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.showModal?.();
    input.current?.focus();
    return () => {
      ref.current?.close?.();
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  useEffect(() => setIndex(0), [query]);
  const close = () => appStore.set({paletteOpen: false});
  const run = (command: Command) => {
    close();
    void Promise.resolve(command.run()).catch(toastError);
  };
  let lastGroup = '';
  return (
    <dialog ref={ref} className="palette" aria-label="Commands" onCancel={event => {event.preventDefault(); close();}} onClick={event => {if (event.target === event.currentTarget) close();}}>
      <div className="palette-search">
        <Search size={15} />
        <input
          ref={input}
          value={query}
          placeholder="Search views, settings and actions"
          onChange={event => setQuery(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'ArrowDown') {event.preventDefault(); setIndex(i => Math.min(results.length - 1, i + 1));}
            else if (event.key === 'ArrowUp') {event.preventDefault(); setIndex(i => Math.max(0, i - 1));}
            else if (event.key === 'Enter' && results[index]) {event.preventDefault(); run(results[index]);}
          }}
          aria-activedescendant={results[index] ? `cmd-${results[index].id}` : undefined}
        />
      </div>
      <div className="palette-list" role="listbox">
        {results.length === 0 && <p className="palette-empty faint">No matching commands.</p>}
        {results.map((command, i) => {
          const heading = command.group !== lastGroup && !query ? command.group : '';
          lastGroup = command.group;
          return (
            <div key={command.id}>
              {heading && <div className="palette-group">{heading}</div>}
              <button id={`cmd-${command.id}`} role="option" aria-selected={i === index} className={i === index ? 'palette-item active' : 'palette-item'} onMouseEnter={() => setIndex(i)} onClick={() => run(command)}>
                <span>{command.title}</span>
                {command.hint && <kbd>{command.hint}</kbd>}
              </button>
            </div>
          );
        })}
      </div>
    </dialog>
  );
}
