// The open chats and how they are laid out: groups of tabs, split side by
// side or one above another, like editor groups. Each chat is in exactly
// one group. The focused chat is the active tab of the focused group; the
// top bar, palette and activity panel follow it.
import {createStore} from '../lib/store';
import type {ChatInfo} from '../lib/types';

export const MAIN_CHAT = 'main';

export type Group = {id: string; tabs: string[]; active: string};
export type SplitDir = 'row' | 'column';
export type LayoutNode =
  | {kind: 'group'; group: Group}
  | {kind: 'split'; id: string; dir: SplitDir; children: LayoutNode[]; sizes: number[]};

export type ChatsState = {
  list: ChatInfo[];
  layout: LayoutNode;
  focusedGroup: string;
};

let seq = 0;
const newID = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

export const initialLayout = (): LayoutNode => ({kind: 'group', group: {id: 'g-main', tabs: [MAIN_CHAT], active: MAIN_CHAT}});

function readLayout(): {layout: LayoutNode; focusedGroup: string} {
  try {
    const raw = localStorage.getItem('nullbot.chatLayout');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.layout && validNode(parsed.layout)) return {layout: parsed.layout, focusedGroup: String(parsed.focusedGroup || '')};
    }
  } catch {
    /* a convenience; start fresh */
  }
  return {layout: initialLayout(), focusedGroup: 'g-main'};
}

function validNode(node: any): node is LayoutNode {
  if (node?.kind === 'group') return typeof node.group?.id === 'string' && Array.isArray(node.group.tabs);
  if (node?.kind === 'split') return (node.dir === 'row' || node.dir === 'column') && Array.isArray(node.children) && node.children.length > 0 && node.children.every(validNode);
  return false;
}

const saved = readLayout();
export const chatsStore = createStore<ChatsState>({list: [], layout: saved.layout, focusedGroup: saved.focusedGroup});

function persist(state: ChatsState) {
  try {
    localStorage.setItem('nullbot.chatLayout', JSON.stringify({layout: state.layout, focusedGroup: state.focusedGroup}));
  } catch {
    /* storage may be unavailable */
  }
}

function commit(next: Partial<ChatsState>) {
  chatsStore.set(next);
  persist(chatsStore.get());
}

// ------------------------------------------------------------- tree helpers

export function groupsOf(node: LayoutNode): Group[] {
  return node.kind === 'group' ? [node.group] : node.children.flatMap(groupsOf);
}

export function groupOfChat(node: LayoutNode, chat: string): Group | undefined {
  return groupsOf(node).find(g => g.tabs.includes(chat));
}

function mapGroups(node: LayoutNode, fn: (g: Group) => Group | null): LayoutNode | null {
  if (node.kind === 'group') {
    const next = fn(node.group);
    return next ? {kind: 'group', group: next} : null;
  }
  const children: LayoutNode[] = [];
  const sizes: number[] = [];
  node.children.forEach((child, i) => {
    const mapped = mapGroups(child, fn);
    if (mapped) {
      children.push(mapped);
      sizes.push(node.sizes[i] ?? 1);
    }
  });
  if (!children.length) return null;
  if (children.length === 1) return children[0];
  return {...node, children, sizes: normalize(sizes)};
}

function normalize(sizes: number[]): number[] {
  const total = sizes.reduce((a, b) => a + (b > 0 ? b : 0), 0) || 1;
  return sizes.map(s => (s > 0 ? s : 0) / total);
}

/** Removes empty groups (unless it is the last one) and collapses splits. */
function tidy(node: LayoutNode): LayoutNode {
  const all = groupsOf(node);
  const keepEmpty = all.every(g => g.tabs.length === 0) ? all[0]?.id : '';
  const next = mapGroups(node, g => {
    if (!g.tabs.length && g.id !== keepEmpty) return null;
    const active = g.tabs.includes(g.active) ? g.active : g.tabs[g.tabs.length - 1] || '';
    return {...g, active};
  });
  return next || initialLayout();
}

function focusFallback(layout: LayoutNode, wanted: string): string {
  const groups = groupsOf(layout);
  return groups.some(g => g.id === wanted) ? wanted : groups[0]?.id || '';
}

// ---------------------------------------------------------------- selectors

export function focusedChat(state: ChatsState = chatsStore.get()): string {
  const group = groupsOf(state.layout).find(g => g.id === state.focusedGroup) || groupsOf(state.layout)[0];
  return group?.active || MAIN_CHAT;
}

export function chatInfo(id: string, state: ChatsState = chatsStore.get()): ChatInfo | undefined {
  return state.list.find(c => c.id === id);
}

// -------------------------------------------------------------- operations

/** Takes the backend's chat list and keeps the layout in step with it. */
export function setChats(list: ChatInfo[]) {
  const state = chatsStore.get();
  const ids = new Set(list.map(c => c.id));
  ids.add(MAIN_CHAT);
  let layout = mapGroups(state.layout, g => ({...g, tabs: g.tabs.filter(t => ids.has(t))})) || initialLayout();
  const placed = new Set(groupsOf(layout).flatMap(g => g.tabs));
  const missing = [MAIN_CHAT, ...list.map(c => c.id)].filter((id, i, all) => all.indexOf(id) === i && !placed.has(id));
  if (missing.length) {
    const target = focusFallback(layout, state.focusedGroup);
    layout = mapGroups(layout, g => (g.id === target ? {...g, tabs: [...g.tabs, ...missing], active: g.active || missing[0]} : g)) || initialLayout();
  }
  layout = tidy(layout);
  commit({list, layout, focusedGroup: focusFallback(layout, state.focusedGroup)});
}

/** Shows a chat: its group is focused and its tab made active. */
export function showChat(chat: string, inGroup?: string) {
  const state = chatsStore.get();
  let layout = state.layout;
  let group = groupOfChat(layout, chat);
  if (!group) {
    const target = focusFallback(layout, inGroup || state.focusedGroup);
    layout = mapGroups(layout, g => (g.id === target ? {...g, tabs: [...g.tabs, chat]} : g)) || initialLayout();
    group = groupOfChat(layout, chat)!;
  }
  const id = group.id;
  layout = mapGroups(layout, g => (g.id === id ? {...g, active: chat} : g)) || layout;
  commit({layout, focusedGroup: id});
}

export function focusGroup(id: string) {
  if (chatsStore.get().focusedGroup !== id) commit({focusedGroup: id});
}

/** Moves a chat's tab to another group, at index (end by default). */
export function moveChat(chat: string, toGroup: string, index?: number) {
  const state = chatsStore.get();
  if (!groupsOf(state.layout).some(g => g.id === toGroup)) return;
  let layout = mapGroups(state.layout, g => ({...g, tabs: g.tabs.filter(t => t !== chat)})) || initialLayout();
  layout = mapGroups(layout, g => {
    if (g.id !== toGroup) return g;
    const tabs = [...g.tabs];
    tabs.splice(index === undefined ? tabs.length : Math.max(0, Math.min(index, tabs.length)), 0, chat);
    return {...g, tabs, active: chat};
  }) || initialLayout();
  layout = tidy(layout);
  commit({layout, focusedGroup: focusFallback(layout, toGroup)});
}

/**
 * Splits a group: chat (moved from wherever it is) gets a new group beside
 * it, to the right (row) or below (column).
 */
export function splitWith(groupID: string, dir: SplitDir, chat: string) {
  const state = chatsStore.get();
  const created: Group = {id: newID('g'), tabs: [chat], active: chat};
  let layout = mapGroups(state.layout, g => ({...g, tabs: g.tabs.filter(t => t !== chat)})) || initialLayout();
  const insert = (node: LayoutNode): LayoutNode => {
    if (node.kind === 'group') {
      if (node.group.id !== groupID) return node;
      return {kind: 'split', id: newID('s'), dir, children: [node, {kind: 'group', group: created}], sizes: [0.5, 0.5]};
    }
    const i = node.children.findIndex(child => child.kind === 'group' && child.group.id === groupID);
    if (i >= 0 && node.dir === dir) {
      // Same direction: a sibling, sharing the space evenly.
      const children = [...node.children];
      children.splice(i + 1, 0, {kind: 'group', group: created});
      return {...node, children, sizes: children.map(() => 1 / children.length)};
    }
    return {...node, children: node.children.map(insert)};
  };
  // The source group may have emptied; keep it only if it is the target.
  layout = insert(layout);
  layout = tidy(layout);
  commit({layout, focusedGroup: created.id});
}

/** Takes a closed chat out of the layout. */
export function dropChat(chat: string) {
  const state = chatsStore.get();
  const layout = tidy(mapGroups(state.layout, g => ({...g, tabs: g.tabs.filter(t => t !== chat)})) || initialLayout());
  commit({layout, list: state.list.filter(c => c.id !== chat), focusedGroup: focusFallback(layout, state.focusedGroup)});
}

/** Closes a group, moving its tabs to the group before it. */
export function mergeGroup(groupID: string) {
  const state = chatsStore.get();
  const groups = groupsOf(state.layout);
  const i = groups.findIndex(g => g.id === groupID);
  if (i < 0 || groups.length < 2) return;
  const into = groups[i === 0 ? 1 : i - 1];
  const moving = groups[i].tabs;
  let layout = mapGroups(state.layout, g => (g.id === groupID ? {...g, tabs: []} : g.id === into.id ? {...g, tabs: [...g.tabs, ...moving]} : g)) || initialLayout();
  layout = tidy(layout);
  commit({layout, focusedGroup: focusFallback(layout, into.id)});
}

export function resizeSplit(splitID: string, sizes: number[]) {
  const update = (node: LayoutNode): LayoutNode => {
    if (node.kind === 'group') return node;
    if (node.id === splitID) return {...node, sizes: normalize(sizes)};
    return {...node, children: node.children.map(update)};
  };
  commit({layout: update(chatsStore.get().layout)});
}

/** The next or previous tab in the focused group. */
export function cycleTab(step: 1 | -1) {
  const state = chatsStore.get();
  const group = groupsOf(state.layout).find(g => g.id === state.focusedGroup);
  if (!group || group.tabs.length < 2) return;
  const i = group.tabs.indexOf(group.active);
  showChat(group.tabs[(i + step + group.tabs.length) % group.tabs.length], group.id);
}

export function resetLayoutForTests() {
  chatsStore.set({list: [], layout: initialLayout(), focusedGroup: 'g-main'});
}
