import {beforeEach, describe, expect, it} from 'vitest';
import {
  MAIN_CHAT, chatsStore, cycleTab, dropChat, focusedChat, groupsOf, mergeGroup, moveChat, resetLayoutForTests, setChats, showChat, splitWith,
} from './chats';
import type {ChatInfo} from '../lib/types';

const chat = (id: string, title = id): ChatInfo => ({id, title, status: 'idle', queue: 0, messages: 0, history_id: id, created: '', updated: ''});

beforeEach(() => {
  localStorage.clear();
  resetLayoutForTests();
});

describe('chat layout', () => {
  it('keeps every open chat in exactly one group', () => {
    setChats([chat(MAIN_CHAT, 'Main'), chat('chat-1'), chat('chat-2')]);
    const groups = groupsOf(chatsStore.get().layout);
    expect(groups).toHaveLength(1);
    expect(groups[0].tabs).toEqual([MAIN_CHAT, 'chat-1', 'chat-2']);
    // A chat closed elsewhere (by the main chat, say) leaves the layout.
    setChats([chat(MAIN_CHAT, 'Main'), chat('chat-2')]);
    expect(groupsOf(chatsStore.get().layout)[0].tabs).toEqual([MAIN_CHAT, 'chat-2']);
  });

  it('splits, moves, merges and closes', () => {
    setChats([chat(MAIN_CHAT), chat('chat-1'), chat('chat-2')]);
    const first = groupsOf(chatsStore.get().layout)[0].id;
    splitWith(first, 'row', 'chat-1');
    let state = chatsStore.get();
    expect(state.layout.kind).toBe('split');
    let groups = groupsOf(state.layout);
    expect(groups.map(g => g.tabs)).toEqual([[MAIN_CHAT, 'chat-2'], ['chat-1']]);
    expect(focusedChat()).toBe('chat-1');
    // Splitting the same way again adds a sibling instead of nesting.
    splitWith(groups[1].id, 'row', 'chat-2');
    groups = groupsOf(chatsStore.get().layout);
    expect(groups.map(g => g.tabs)).toEqual([[MAIN_CHAT], ['chat-1'], ['chat-2']]);
    expect((chatsStore.get().layout as any).children).toHaveLength(3);
    // A group emptied by a move disappears, and the split collapses.
    moveChat('chat-2', groups[0].id, 1);
    moveChat('chat-1', groups[0].id);
    state = chatsStore.get();
    expect(state.layout.kind).toBe('group');
    expect(groupsOf(state.layout)[0].tabs).toEqual([MAIN_CHAT, 'chat-2', 'chat-1']);
    splitWith(groupsOf(state.layout)[0].id, 'column', 'chat-1');
    mergeGroup(groupsOf(chatsStore.get().layout)[1].id);
    expect(groupsOf(chatsStore.get().layout)).toHaveLength(1);
    dropChat('chat-2');
    expect(groupsOf(chatsStore.get().layout)[0].tabs).toEqual([MAIN_CHAT, 'chat-1']);
  });

  it('shows and cycles tabs in the focused group', () => {
    setChats([chat(MAIN_CHAT), chat('chat-1'), chat('chat-2')]);
    showChat('chat-2');
    expect(focusedChat()).toBe('chat-2');
    cycleTab(1);
    expect(focusedChat()).toBe(MAIN_CHAT);
    cycleTab(-1);
    expect(focusedChat()).toBe('chat-2');
  });

  it('survives a stored layout that names chats no longer open', () => {
    localStorage.setItem('nullbot.chatLayout', JSON.stringify({layout: {kind: 'split', id: 's', dir: 'row', sizes: [0.5, 0.5], children: [{kind: 'group', group: {id: 'a', tabs: ['gone'], active: 'gone'}}, {kind: 'group', group: {id: 'b', tabs: [MAIN_CHAT], active: MAIN_CHAT}}]}, focusedGroup: 'a'}));
    chatsStore.set(JSON.parse(localStorage.getItem('nullbot.chatLayout')!));
    setChats([chat(MAIN_CHAT)]);
    const state = chatsStore.get();
    expect(state.layout.kind).toBe('group');
    expect(focusedChat()).toBe(MAIN_CHAT);
  });
});
