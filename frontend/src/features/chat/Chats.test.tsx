// Several chats at once: tabs, splits, and each chat's activity and
// requests kept to itself.
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {act, fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import {baseState, installBridge, type FakeBridge} from '../../test/bridge';
import App from '../../App';
import {appStore} from '../../state/app';
import {chatSession, resetChatSessionsForTests} from '../../state/chat';
import {MAIN_CHAT, chatsStore, groupsOf, resetLayoutForTests} from '../../state/chats';
import {resetUnsavedEdits} from '../../lib/dirty';
import type {ChatInfo} from '../../lib/types';

let bridge: FakeBridge;
let chats: ChatInfo[];
const info = (id: string, title: string, extra: Partial<ChatInfo> = {}): ChatInfo => ({id, title, status: 'idle', queue: 0, messages: 0, history_id: id, created: '', updated: '', ...extra});

beforeEach(() => {
  localStorage.clear();
  resetLayoutForTests();
  resetChatSessionsForTests();
  appStore.set({ready: false, error: '', view: 'chat', inspectorOpen: false, paletteOpen: false, versions: {}});
  chats = [info(MAIN_CHAT, 'Main', {main: true})];
  let seq = 0;
  bridge = installBridge({
    State: () => baseState(),
    Skills: () => [], Tasks: () => [], ScheduledTasks: () => [], Plans: () => ({data: {plans: []}}), Sessions: () => [],
    Chats: () => chats,
    OpenChat: () => {
      const chat = info(`chat-${++seq}`, `Chat ${seq}`);
      chats = [...chats, chat];
      return chat;
    },
    ChatState: (id: string) => ({history: [{role: 'assistant', content: `Hello from ${id}`, time: '2026-10-28T10:00:00Z'}], data: {chat: id, submissions: {busy: false, queue: [], jobs: []}}}),
    CloseChat: (id: string) => {
      chats = chats.filter(c => c.id !== id);
    },
    SubmitChatRequest: (request: any) => ({data: {chat: request.chat || MAIN_CHAT, accepted: true, background: true, submission_status: 'started'}}),
  });
});
afterEach(() => {
  document.body.innerHTML = '';
  resetUnsavedEdits();
});

async function boot() {
  render(<App />);
  await screen.findByRole('textbox', {name: /Message NullBot/});
}

const tabs = () => screen.getAllByRole('tab').filter(tab => tab.closest('.chat-tablist')).map(tab => tab.textContent);

describe('chats', () => {
  it('opens a chat in a new tab, loads it, and sends there', async () => {
    await boot();
    expect(tabs()).toEqual(['Main']);
    fireEvent.click(screen.getByRole('button', {name: 'New chat'}));
    await screen.findByText('Hello from chat-1');
    expect(tabs()).toEqual(['Main', 'Chat 1']);
    // Only the active tab's composer is visible; it sends to its own chat.
    const composer = screen.getAllByRole('textbox', {name: /Message NullBot/}).find(el => !el.closest('[hidden]'))!;
    fireEvent.change(composer, {target: {value: 'summarize the backlog'}});
    fireEvent.keyDown(composer, {key: 'Enter'});
    await waitFor(() => expect(bridge.callsTo('SubmitChatRequest')).toHaveLength(1));
    expect(bridge.callsTo('SubmitChatRequest')[0][0]).toMatchObject({chat: 'chat-1', text: 'summarize the backlog'});
  });

  it('keeps each chat’s streamed activity in that chat', async () => {
    await boot();
    fireEvent.click(screen.getByRole('button', {name: 'New chat'}));
    await screen.findByText('Hello from chat-1');
    act(() => {
      bridge.emit('activity', [{chat: 'chat-1', seq: 1, agent_id: 'main', run_id: 'r', submission_id: 's', status: 'response delta', detail: 'streamed into chat one'}]);
      bridge.emit('activity', [{chat: MAIN_CHAT, seq: 1, agent_id: 'main', run_id: 'r', submission_id: 's', status: 'response delta', detail: 'streamed into main'}]);
    });
    await waitFor(() => expect(chatSession('chat-1').store.get().messages.some(m => m.content === 'streamed into chat one')).toBe(true));
    expect(chatSession('chat-1').store.get().messages.some(m => m.content === 'streamed into main')).toBe(false);
    expect(chatSession(MAIN_CHAT).store.get().messages.some(m => m.content === 'streamed into chat one')).toBe(false);
  });

  it('splits to show two chats side by side, each with its own composer', async () => {
    await boot();
    fireEvent.click(screen.getByRole('button', {name: 'New chat to the right'}));
    await screen.findByText('Hello from chat-1');
    const groups = document.querySelectorAll('.chat-group');
    expect(groups).toHaveLength(2);
    expect(document.querySelector('.chat-split-row')).toBeTruthy();
    const visible = screen.getAllByRole('textbox', {name: /Message NullBot/}).filter(el => !el.closest('[hidden]'));
    expect(visible).toHaveLength(2);
    expect(groupsOf(chatsStore.get().layout).map(g => g.tabs)).toEqual([[MAIN_CHAT], ['chat-1']]);
  });

  it('closes a working chat only after asking', async () => {
    await boot();
    fireEvent.click(screen.getByRole('button', {name: 'New chat'}));
    await screen.findByText('Hello from chat-1');
    act(() => bridge.emit('chats', [info(MAIN_CHAT, 'Main'), info('chat-1', 'Chat 1', {status: 'running', request: 'long task'})]));
    fireEvent.click(screen.getByRole('button', {name: 'Close Chat 1'}));
    fireEvent.click(await screen.findByRole('button', {name: 'Stop and close'}));
    await waitFor(() => expect(bridge.callsTo('CloseChat')).toEqual([['chat-1']]));
    await waitFor(() => expect(tabs()).toEqual(['Main']));
    // The main chat has no close button.
    expect(screen.queryByRole('button', {name: 'Close Main'})).toBeNull();
  });

  it('lists every chat in the activity panel, with controls', async () => {
    await boot();
    act(() => bridge.emit('chats', [info(MAIN_CHAT, 'Main'), info('chat-7', 'Release notes', {status: 'running', request: 'Draft the v0.6 notes', subagents: [{id: 'task-1', name: 'researcher', status: 'running', current: 'Reading CHANGELOG.md'}]})]));
    act(() => appStore.set({inspectorOpen: true, inspectorTab: 'chats'}));
    const overview = await waitFor(() => {
      const el = document.querySelector('.chats-overview') as HTMLElement | null;
      if (!el) throw new Error('no overview');
      return el;
    });
    const card = within(overview).getByText('Release notes').closest('article')!;
    expect(within(card).getByText('Draft the v0.6 notes')).toBeTruthy();
    expect(within(card).getByText(/Reading CHANGELOG.md/)).toBeTruthy();
    fireEvent.click(within(card).getByRole('button', {name: 'Pause'}));
    await waitFor(() => expect(bridge.callsTo('ChatControl')).toEqual([['chat-7', 'pause', '']]));
  });
});
