// The shell end to end, against a fake bridge: boot, navigation, links,
// live activity and the memory bounds that matter over a long session.
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {act, fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import {baseState, installBridge, type FakeBridge} from './test/bridge';
import App from './App';
import {appStore} from './state/app';
import {chatStore, flushActivityNow} from './state/chat';
import {emptyActivity} from './features/activity/model';

let bridge: FakeBridge;

beforeEach(() => {
  appStore.set({ready: false, error: '', view: 'chat', inspectorOpen: true, inspectorTab: 'activity', paletteOpen: false, versions: {}});
  chatStore.set({messages: [], activity: emptyActivity, side: [], submissions: {busy: false, queue: [], jobs: []}, sending: false, commandOutput: null});
  bridge = installBridge({Skills: () => [], Tasks: () => [], ScheduledTasks: () => [], Plans: () => ({data: {plans: []}}), Sessions: () => []});
});
afterEach(() => {
  document.body.innerHTML = '';
});

async function boot(state = baseState()) {
  bridge.set('State', () => state);
  const view = render(<App />);
  await screen.findByRole('textbox', {name: /Message NullBot/});
  return view;
}

const rec = (seq: number, patch: Record<string, unknown>) => ({seq, agent_id: 'main', submission_id: 's1', time: new Date(Date.UTC(2026, 9, 26, 9, 0, seq)).toISOString(), ...patch});

describe('App', () => {
  it('boots from State without a model network call when the catalog is fresh', async () => {
    await boot();
    expect(bridge.callsTo('ModelCatalog')).toHaveLength(0);
    expect(screen.getByText('What should NullBot work on?')).toBeTruthy();
  });

  it('keeps the chat mounted, with its draft, while other views are open', async () => {
    await boot();
    const box = screen.getByRole('textbox', {name: /Message NullBot/}) as HTMLTextAreaElement;
    fireEvent.change(box, {target: {value: 'half-written thought'}});
    fireEvent.click(screen.getByRole('button', {name: /^Files/}));
    await waitFor(() => expect(appStore.get().view).toBe('files'));
    expect((box.closest('.view-slot') as HTMLElement).hidden).toBe(true);
    fireEvent.keyDown(window, {key: '1', ctrlKey: true});
    await waitFor(() => expect(appStore.get().view).toBe('chat'));
    expect(screen.getByRole('textbox', {name: /Message NullBot/})).toBe(box);
    expect(box.value).toBe('half-written thought');
  });

  it('opens links from replies in the system browser, not the app window', async () => {
    const state = baseState();
    state.reply.history = [{role: 'assistant', content: 'See [the status page](https://status.example/history) and [notes](reports/q3.md).'}] as any;
    await boot(state);
    fireEvent.click(await screen.findByText('the status page'));
    expect(bridge.callsTo('OpenExternal')).toEqual([['https://status.example/history']]);
    fireEvent.click(screen.getByText('notes'));
    await waitFor(() => expect(appStore.get().view).toBe('files'));
  });

  it('describes live tool calls in words and explains permission blocks', async () => {
    await boot();
    act(() => {
      bridge.emit('activity', [
        rec(1, {status: 'submission running'}),
        rec(2, {status: 'tool start', call_id: 'a', tool: 'web_search', args: {query: 'acme outage'}}),
        rec(3, {status: 'tool complete', call_id: 'a', tool: 'web_search', result: '…', result_meta: {items: 8}, duration_ms: 900}),
        rec(4, {status: 'tool start', call_id: 'b', tool: 'write_file', args: {path: 'D:\\docs\\notes.md'}}),
        rec(5, {status: 'tool error', call_id: 'b', tool: 'write_file', error: 'permission denied', permission: {allowed: false, capability: 'write', source: 'builtin', rule: 'builtin', reason: 'docs is read only, so files there can’t be changed.', project: 'docs', permission: 'read-only'}}),
      ]);
      flushActivityNow();
    });
    const trace = screen.getByRole('complementary', {name: 'Activity'});
    expect(within(trace).getByText('Searched the web for “acme outage”')).toBeTruthy();
    expect(within(trace).getByText('8 results')).toBeTruthy();
    expect(trace.textContent).not.toMatch(/\{"query"/);
    fireEvent.click(within(trace).getByText(/^Blocked: writing/));
    expect(within(trace).getByText('Not run.')).toBeTruthy();
    expect(within(trace).getAllByText(/docs is read only/).length).toBeGreaterThan(0);
  });

  it('stays bounded over a long session of streamed turns', async () => {
    await boot();
    let seq = 0;
    act(() => {
      for (let turn = 0; turn < 300; turn++) {
        const id = `s${turn}`;
        const records = [rec(++seq, {submission_id: id, status: 'submission running'})];
        for (let i = 0; i < 5; i++) {
          records.push(rec(++seq, {submission_id: id, status: 'tool start', call_id: `c${i}`, tool: 'read_file', args: {path: `f${i}.txt`}}));
          records.push(rec(++seq, {submission_id: id, status: 'tool complete', call_id: `c${i}`, tool: 'read_file', result: 'x'.repeat(200)}));
        }
        for (let i = 0; i < 40; i++) records.push(rec(++seq, {submission_id: id, run_id: `r${turn}`, status: 'response delta', detail: 'token '}));
        records.push(rec(++seq, {submission_id: id, status: 'submission done'}));
        bridge.emit('activity', records);
      }
      flushActivityNow();
    });
    const {turns} = chatStore.get().activity;
    expect(turns.length).toBeLessThanOrEqual(40);
    expect(JSON.stringify(turns)).not.toMatch(/token token/);
    expect(document.querySelectorAll('.turn').length).toBeLessThanOrEqual(40);
  });

  it('runs commands from the palette', async () => {
    await boot();
    fireEvent.keyDown(window, {key: 'k', ctrlKey: true});
    const input = await screen.findByPlaceholderText('Search views, settings and actions');
    fireEvent.change(input, {target: {value: 'usage'}});
    fireEvent.keyDown(input, {key: 'Enter'});
    await waitFor(() => expect(appStore.get()).toMatchObject({view: 'settings', settingsSection: 'usage', paletteOpen: false}));
  });

  it('refetches a view when the backend says its data changed, without polling', async () => {
    await boot();
    fireEvent.click(screen.getByRole('button', {name: /^Activity/}));
    await waitFor(() => expect(bridge.callsTo('Tasks')).toHaveLength(1));
    act(() => bridge.emit('changed', {topic: 'tasks'}));
    await waitFor(() => expect(bridge.callsTo('Tasks')).toHaveLength(2));
    act(() => bridge.emit('changed', {topic: 'history'}));
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(bridge.callsTo('Tasks')).toHaveLength(2);
  });
});
