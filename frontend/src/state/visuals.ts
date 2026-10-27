// Visuals the agent shows: which are waiting for the person, and the window
// they open in.
import {createStore} from '../lib/store';
import {api} from '../lib/bindings';
import type {VisualDelivery, Visualization} from '../lib/types';
import {toast, toastError} from '../ui/toast';

export type WindowRect = {x: number; y: number; w: number; h: number};

export type VisualState = {
  /** Visuals waiting for a response, oldest first. */
  live: Visualization[];
  /** Every visual seen this session, by id, so chat can show them. */
  known: Record<string, Visualization>;
  /** Visuals open as tabs in the window, in order. */
  tabs: string[];
  active: string;
  minimized: boolean;
  maximized: boolean;
  rect: WindowRect | null;
};

function readRect(): WindowRect | null {
  try {
    const raw = localStorage.getItem('nullbot.visualWindow');
    const rect = raw ? JSON.parse(raw) : null;
    return rect && [rect.x, rect.y, rect.w, rect.h].every(n => typeof n === 'number' && Number.isFinite(n)) ? rect : null;
  } catch {
    return null;
  }
}

export const visualStore = createStore<VisualState>({live: [], known: {}, tabs: [], active: '', minimized: false, maximized: false, rect: readRect()});

export function saveWindowRect(rect: WindowRect) {
  visualStore.set({rect});
  try {
    localStorage.setItem('nullbot.visualWindow', JSON.stringify(rect));
  } catch {
    /* a convenience only */
  }
}

// Visuals already popped up, so each opens by itself once.
const popped = new Set<string>();

/** The backend's list of waiting visuals: new ones open in the window. */
export function handleLiveVisuals(list: Visualization[] | null) {
  const live = Array.isArray(list) ? list.filter(v => v && typeof v.id === 'string') : [];
  const state = visualStore.get();
  const known = {...state.known};
  for (const visual of live) known[visual.id] = visual;
  // Visuals no longer live were answered or stopped being waited on: refresh
  // them so chat shows their status.
  for (const visual of state.live) {
    if (!live.some(v => v.id === visual.id)) {
      api.visualization(visual.id).then(updateKnown).catch(() => undefined);
    }
  }
  const fresh = live.filter(visual => !popped.has(visual.id));
  fresh.forEach(visual => popped.add(visual.id));
  let {tabs, active, minimized} = state;
  if (fresh.length) {
    tabs = [...tabs, ...fresh.map(v => v.id).filter(id => !tabs.includes(id))];
    active = fresh[fresh.length - 1].id;
    minimized = false;
  }
  visualStore.set({live, known, tabs, active, minimized});
}

export function updateKnown(visual: Visualization) {
  visualStore.set(state => ({
    known: {...state.known, [visual.id]: visual},
    live: state.live.map(v => (v.id === visual.id ? {...v, ...visual} : v)).filter(v => v.status === 'open' || v.waiting),
  }));
}

/** Opens a visual in the window, as a tab. */
export function openVisual(visual: Visualization | string) {
  const id = typeof visual === 'string' ? visual : visual.id;
  if (typeof visual !== 'string') updateKnown(visual);
  popped.add(id);
  visualStore.set(state => ({tabs: state.tabs.includes(id) ? state.tabs : [...state.tabs, id], active: id, minimized: false}));
}

export function closeVisual(id: string) {
  visualStore.set(state => {
    const tabs = state.tabs.filter(tab => tab !== id);
    const at = state.tabs.indexOf(id);
    const active = state.active === id ? tabs[Math.min(at, tabs.length - 1)] || '' : state.active;
    return {tabs, active};
  });
}

export function setVisualWindow(patch: Partial<Pick<VisualState, 'minimized' | 'maximized' | 'active'>>) {
  visualStore.set(patch);
}

const deliveredText: Record<VisualDelivery['how'], string> = {
  tool: 'Sent to NullBot.',
  steer: 'Sent to NullBot. It joins the request that’s running.',
  started: 'Sent to NullBot.',
  queued: 'Sent. NullBot reads it after the current request.',
  saved: 'Saved.',
};

/** Sends the person's response (or skips the visual) and closes its tab. */
export async function respondToVisual(id: string, response: unknown, note: string, dismiss = false) {
  try {
    const delivery = await api.respondVisualization(id, response, note, dismiss);
    updateKnown(delivery.visual);
    closeVisual(id);
    toast(dismiss ? 'Skipped. NullBot carries on without it.' : delivery.how === 'saved' && delivery.message ? delivery.message : deliveredText[delivery.how], dismiss ? 'info' : 'success');
    return delivery;
  } catch (error) {
    toastError(error);
    return null;
  }
}

/** Restores visuals that were waiting when the window loaded. */
export async function bootstrapVisuals() {
  try {
    handleLiveVisuals(await api.liveVisualizations());
  } catch {
    /* older backends have no visuals */
  }
}

export const kindNames: Record<string, string> = {poll: 'Poll', html: 'Page', svg: 'Drawing', image: 'Picture', chart: 'Chart', drawio: 'Diagram', file: 'File'};

/** For tests: forget what has popped up and close everything. */
export function resetVisuals() {
  popped.clear();
  visualStore.set({live: [], known: {}, tabs: [], active: '', minimized: false, maximized: false, rect: null});
}
