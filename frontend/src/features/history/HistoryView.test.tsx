import {beforeEach, describe, expect, it} from 'vitest';
import {fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import {installBridge, type FakeBridge} from '../../test/bridge';
import {HistoryView, searchTerms} from './HistoryView';

const sessions = [
  {session_id: 's2', path: '', messages: 4, title: 'Check the nightly export', preview: 'assistant: done', modified: '2026-10-26T09:00:00Z'},
  {session_id: 's1', path: '', messages: 2, title: 'Reconcile invoices', preview: 'assistant: three are off', modified: '2026-10-20T09:00:00Z'},
];
const entries = [
  {kind: 'message', index: 0, message: {role: 'user', content: 'Check the nightly export', time: '2026-10-26T08:57:00Z'}},
  {kind: 'tool', index: 0, tool: {session_id: 's2', time: '2026-10-26T08:58:00Z', status: 'tool complete', tool: 'search_issues', server: 'tracker', args: {query: 'nightly export'}, result: 'OPS-2219 Nightly export failed'}},
  {kind: 'message', index: 1, message: {role: 'assistant', content: 'The export failed on upload.', time: '2026-10-26T08:59:00Z'}},
];

let bridge: FakeBridge;
beforeEach(() => {
  bridge = installBridge({
    Sessions: () => sessions,
    SearchSessionsWith: () => [{...sessions[0], matches: 2, snippet: 'Check the nightly export'}],
    SearchHistory: () => ({hits: [{session_id: 's2', kind: 'tool', index: 0, tool: 'search_issues', time: '2026-10-26T08:58:00Z', snippet: 'search_issues tracker {"query":"nightly export"}'}, {session_id: 's2', kind: 'message', index: 0, role: 'user', time: '2026-10-26T08:57:00Z', snippet: 'Check the nightly export'}], more: false, sessions_searched: 2}),
    SessionEntries: (_id: string, tools: boolean) => (tools ? entries : entries.filter(e => e.kind === 'message')),
  });
});

describe('searchTerms', () => {
  it('splits words and keeps quoted phrases', () => {
    expect(searchTerms('Export "upload timed out" OPS')).toEqual(['export', 'upload timed out', 'ops']);
  });
});

describe('HistoryView', () => {
  it('lists sessions by their first request, without reading tool calls', async () => {
    render(<HistoryView />);
    expect(await screen.findByText('Reconcile invoices')).toBeTruthy();
    await waitFor(() => expect(bridge.callsTo('SessionEntries')[0]).toEqual(['s2', false]));
  });

  it('searches messages and tool calls with filters, and shows where it matched', async () => {
    render(<HistoryView />);
    await screen.findByText('Reconcile invoices');
    fireEvent.change(screen.getByRole('textbox', {name: 'Search history'}), {target: {value: 'nightly export'}});
    fireEvent.change(screen.getByRole('combobox', {name: 'When'}), {target: {value: '7d'}});
    await waitFor(() => expect(bridge.callsTo('SearchSessionsWith').at(-1)?.[0]).toMatchObject({text: 'nightly export', since: expect.any(String)}));
    expect(await screen.findByText('2 matches')).toBeTruthy();
    // A tool-call match turns tool calls on and highlights the call.
    await waitFor(() => expect(bridge.callsTo('SessionEntries').some(args => args[1] === true)).toBe(true));
    const hit = await waitFor(() => {
      const el = document.querySelector('.hist-tool.is-hit');
      if (!el) throw new Error('no highlighted tool call');
      return el as HTMLElement;
    });
    expect(within(hit).getAllByText('nightly', {selector: 'mark'}).length).toBeGreaterThan(0);
    expect(within(hit).getByText(/OPS-2219/)).toBeTruthy();
  });

  it('can search only tool calls', async () => {
    render(<HistoryView />);
    await screen.findByText('Reconcile invoices');
    fireEvent.click(screen.getByRole('radio', {name: 'Tool calls'}));
    await waitFor(() => expect((bridge.callsTo('SearchSessionsWith').at(-1)?.[0] as any)?.roles).toEqual(['tool']));
  });
});
