import {createStore} from '../lib/store';
import {api} from '../lib/bindings';
import {guard} from '../lib/dirty';
import type {MCPServerStatus, ModelGroup, ProjectsState, UIState} from '../lib/types';

export type View = 'chat' | 'activity' | 'files' | 'visuals' | 'tools' | 'history' | 'cloud' | 'settings';
export type SettingsSection = 'projects' | 'models' | 'accounts' | 'secrets' | 'agent' | 'prompts' | 'appearance' | 'usage';

export type AppState = {
  ready: boolean;
  error: string;
  view: View;
  settingsSection: SettingsSection;
  toolsTab: 'servers' | 'skills' | 'market';
  activityTab: 'runs' | 'plans' | 'schedules';
  ui: UIState | null;
  config: any;
  runtime: Record<string, any>;
  projects: ProjectsState | null;
  mcp: MCPServerStatus[];
  models: ModelGroup[];
  inspectorOpen: boolean;
  inspectorTab: 'activity' | 'side' | 'chats';
  paletteOpen: boolean;
  fileRequest: {path: string; nonce: number} | null;
  /** A visual to select in the Visuals view. */
  visualRequest: string;
  selectedServer: string;
  focusStep: string;
  /** Bumped when the backend announces a change; views refetch on demand. */
  versions: Record<string, number>;
};

function readPref<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function writePref(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage can be unavailable; preferences are a convenience */
  }
}

export const appStore = createStore<AppState>({
  ready: false,
  error: '',
  view: 'chat',
  settingsSection: 'projects',
  toolsTab: 'servers',
  activityTab: 'runs',
  ui: null,
  config: null,
  runtime: {},
  projects: null,
  mcp: [],
  models: [],
  inspectorOpen: readPref('nullbot.inspectorOpen', true),
  inspectorTab: 'activity',
  paletteOpen: false,
  fileRequest: null,
  visualRequest: '',
  selectedServer: '',
  focusStep: '',
  versions: {},
});

export function bumpVersion(topic: string) {
  appStore.set(state => ({versions: {...state.versions, [topic]: (state.versions[topic] || 0) + 1}}));
}

export function applyUIState(ui: UIState) {
  appStore.set({
    ui,
    config: ui.config,
    runtime: ui.runtime || {},
    projects: ui.projects || null,
    mcp: ui.mcp || [],
    models: ui.models || [],
  });
  applyAppearance(ui.config?.ui?.appearance, ui.config?.ui?.accent);
}

/** Re-reads state from the backend. Cheap: no network calls. */
export async function refreshState() {
  const ui = await api.state();
  applyUIState(ui);
  return ui;
}

// Navigation asks before discarding unsaved edits in the view being left.
export function setView(view: View) {
  if (appStore.get().view === view) return;
  guard(() => appStore.set({view}));
}

export function openSettings(section: SettingsSection) {
  const state = appStore.get();
  if (state.view === 'settings' && state.settingsSection === section) return;
  guard(() => appStore.set({view: 'settings', settingsSection: section}));
}

export function toggleInspector(open?: boolean) {
  const next = open ?? !appStore.get().inspectorOpen;
  appStore.set({inspectorOpen: next});
  writePref('nullbot.inspectorOpen', next);
}

export function openFile(path: string) {
  guard(() => appStore.set({view: 'files', fileRequest: {path, nonce: Date.now()}}));
}

// ---------------------------------------------------------------- appearance

export const accents = ['amber', 'teal', 'blue', 'violet', 'rose'] as const;
let systemQuery: MediaQueryList | null = null;
let systemListener: (() => void) | null = null;

/** Applies system/light/dark and the signal accent to the document root. */
export function applyAppearance(appearance?: string, accent?: string) {
  const root = document.documentElement;
  const mode = appearance === 'light' || appearance === 'dark' ? appearance : 'system';
  if (systemQuery && systemListener) systemQuery.removeEventListener('change', systemListener);
  systemQuery = null;
  systemListener = null;
  const resolve = () => {
    const dark = mode === 'dark' || (mode === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
    root.dataset.appearance = dark ? 'dark' : 'light';
  };
  resolve();
  if (mode === 'system' && window.matchMedia) {
    systemQuery = window.matchMedia('(prefers-color-scheme: dark)');
    systemListener = resolve;
    systemQuery.addEventListener('change', resolve);
  }
  const chosen = (accents as readonly string[]).includes(String(accent)) ? String(accent) : 'amber';
  if (chosen === 'amber') delete root.dataset.accent;
  else root.dataset.accent = chosen;
}
