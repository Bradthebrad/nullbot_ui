// Pause, stop after this step, and stop everything, as the top bar offers
// them while a request runs.
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {baseState, installBridge, type FakeBridge} from '../test/bridge';
import App from '../App';
import {appStore} from '../state/app';
import {chatStore, runPhase} from '../state/chat';
import {emptyActivity} from '../features/activity/model';
import {resetUnsavedEdits} from '../lib/dirty';

let bridge: FakeBridge;
const running = (extra: Record<string, unknown> = {}) => ({busy: true, primary_id: 's1', queue: [], jobs: [{id: 's1', mode: 'send', status: 'running'}], ...extra});

beforeEach(() => {
  appStore.set({ready: false, error: '', view: 'chat', inspectorOpen: false, paletteOpen: false, versions: {}});
  chatStore.set({messages: [], activity: emptyActivity, side: [], submissions: {busy: false, queue: [], jobs: []}, sending: false, commandOutput: null});
  bridge = installBridge({Skills: () => [], Tasks: () => [], ScheduledTasks: () => [], Plans: () => ({data: {plans: []}}), Sessions: () => []});
});
afterEach(() => {
  document.body.innerHTML = '';
  resetUnsavedEdits();
});

async function boot(submissions: any) {
  const state = baseState();
  state.reply.data.submissions = submissions;
  bridge.set('State', () => state);
  render(<App />);
  await screen.findByRole('textbox', {name: /Message NullBot/});
}

describe('run controls', () => {
  it('maps the backend state to one phase', () => {
    const phase = (submissions: any) => runPhase({...chatStore.get(), submissions});
    expect(phase({busy: false, queue: [], jobs: []})).toBe('idle');
    expect(phase(running())).toBe('working');
    expect(phase(running({run_paused: true, paused: true}))).toBe('paused');
    expect(phase(running({stopping: true}))).toBe('stopping');
    expect(phase({busy: true, paused: true, queue: [{id: 'q'}], jobs: []})).toBe('held');
  });

  it('pauses, resumes, stops after this step, or stops everything', async () => {
    await boot(running());
    const runstate = () => document.querySelector('.runstate')?.textContent || '';
    expect(runstate()).toContain('Working');
    bridge.set('Pause', () => ({data: {submissions: running({run_paused: true, paused: true})}}));
    fireEvent.click(screen.getByRole('button', {name: 'Pause'}));
    await waitFor(() => expect(runstate()).toContain('Paused'));
    bridge.set('Resume', () => ({data: {submissions: running()}}));
    fireEvent.click(screen.getAllByRole('button', {name: 'Resume'})[0]);
    await waitFor(() => expect(bridge.callsTo('Resume')).toHaveLength(1));
    await waitFor(() => expect(runstate()).toContain('Working'));

    bridge.set('StopRun', () => ({data: {submissions: running({stopping: true})}}));
    fireEvent.click(screen.getAllByRole('button', {name: 'Stop'})[0]);
    await waitFor(() => expect(runstate()).toContain('Stopping'));
    expect(bridge.callsTo('StopRun')).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', {name: 'More ways to stop'}));
    fireEvent.click(screen.getByRole('menuitem', {name: /Stop everything now/}));
    await waitFor(() => expect(bridge.callsTo('StopEverything')).toHaveLength(1));
  });

  it('offers Resume when queued requests are held', async () => {
    await boot({busy: true, paused: true, queue: [{id: 'q1', mode: 'queue', status: 'queued'}], jobs: []});
    expect(screen.getByText('1 request waiting')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', {name: 'Resume'}));
    await act(async () => undefined);
    expect(bridge.callsTo('Resume')).toHaveLength(1);
  });
});
