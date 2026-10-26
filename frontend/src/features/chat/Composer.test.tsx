// The composer must never lose a draft or attachments, and must never send
// a half-prepared attachment.
import {beforeEach, describe, expect, it} from 'vitest';
import {act, fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import {deferred, installBridge, type FakeBridge} from '../../test/bridge';
import {Composer} from './Composer';
import {chatStore} from '../../state/chat';
import {emptyActivity} from '../activity/model';

const ready = (path: string) => ({name: path, path: `C:\\${path}`, token: `@file("${path}")`, size: 1024});

let bridge: FakeBridge;
beforeEach(() => {
  chatStore.set({messages: [], activity: emptyActivity, side: [], submissions: {busy: false, queue: [], jobs: []}, sending: false, attachRequest: null});
  bridge = installBridge({Skills: () => []});
});

function setup(text = 'keep my draft') {
  const view = render(<Composer active />);
  const box = screen.getByRole('textbox', {name: /Message/}) as HTMLTextAreaElement;
  fireEvent.change(box, {target: {value: text}});
  return {view, box, send: () => screen.getByRole('button', {name: 'Send'})};
}

async function attach(...paths: string[]) {
  await act(async () => {
    chatStore.set({attachRequest: {paths, nonce: Math.random()}});
  });
}

describe('Composer', () => {
  it('waits for attachments, refuses failed ones, and keeps the draft throughout', async () => {
    const pending = deferred<any>();
    bridge.set('AttachFiles', () => pending.promise);
    const {box, send} = setup();
    await attach('a.png');
    expect((send() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(box, {key: 'Enter'});
    expect(bridge.callsTo('SubmitChatRequest')).toHaveLength(0);
    await act(async () => pending.resolve([{error: 'denied'}]));
    await screen.findByText('Failed');
    expect((send() as HTMLButtonElement).disabled).toBe(true);
    expect(box.value).toBe('keep my draft');
    fireEvent.click(screen.getByRole('button', {name: 'Remove a.png'}));
    bridge.set('SubmitChatRequest', () => ({data: {background: true}}));
    fireEvent.click(send());
    await waitFor(() => expect(bridge.callsTo('SubmitChatRequest')).toHaveLength(1));
    expect((bridge.callsTo('SubmitChatRequest')[0][0] as any).text).toBe('keep my draft');
    await waitFor(() => expect(box.value).toBe(''));
  });

  it('clears only what was sent: a newer draft and newer attachments survive', async () => {
    const submitted = deferred<any>();
    bridge.set('AttachFiles', (paths: string[]) => [ready(paths[0])]);
    bridge.set('SubmitChatRequest', () => submitted.promise);
    const {box, send} = setup();
    await attach('one.png');
    await screen.findByText('Ready', {exact: false});
    fireEvent.click(send());
    await waitFor(() => expect(bridge.callsTo('SubmitChatRequest')).toHaveLength(1));
    expect((bridge.callsTo('SubmitChatRequest')[0][0] as any).text).toBe('keep my draft\n\n@file("one.png")');
    fireEvent.change(box, {target: {value: 'next draft'}});
    await attach('two.png');
    await act(async () => submitted.resolve({data: {background: true}}));
    await waitFor(() => expect(screen.queryByText('one.png')).toBeNull());
    expect(box.value).toBe('next draft');
    expect(screen.getByText('two.png')).toBeTruthy();
  });

  it('keeps the draft and attachments when the backend rejects the send', async () => {
    bridge.set('AttachFiles', (paths: string[]) => [ready(paths[0])]);
    bridge.set('SubmitChatRequest', () => {
      throw new Error('offline');
    });
    const {box, send} = setup();
    await attach('one.png');
    await screen.findByText('Ready', {exact: false});
    fireEvent.click(send());
    await waitFor(() => expect(bridge.callsTo('SubmitChatRequest')).toHaveLength(1));
    expect(box.value).toBe('keep my draft');
    expect(screen.getByText('one.png')).toBeTruthy();
  });

  it('asks how to send while busy; Keep editing changes nothing and each choice submits once', async () => {
    for (const [label, mode] of [['Queue it', 'queue'], ['Steer the current request', 'steer'], ['Ask on the side', 'also']] as const) {
      chatStore.set({submissions: {busy: true, primary_id: 'job-1', queue: [], jobs: []}, sending: false});
      const pending = deferred<any>();
      bridge = installBridge({Skills: () => [], SubmitChatRequest: () => pending.promise});
      const {view, box} = setup();
      fireEvent.keyDown(box, {key: 'Enter'});
      fireEvent.click(await screen.findByRole('button', {name: 'Keep editing'}));
      expect(screen.queryByRole('button', {name: 'Keep editing'})).toBeNull();
      expect(box.value).toBe('keep my draft');
      fireEvent.keyDown(box, {key: 'Enter'});
      const choice = within(await screen.findByRole('dialog')).getByRole('button', {name: new RegExp(label)});
      fireEvent.click(choice);
      await waitFor(() => expect(bridge.callsTo('SubmitChatRequest')).toHaveLength(1));
      const request = bridge.callsTo('SubmitChatRequest')[0][0] as any;
      expect(request.mode).toBe(mode);
      if (mode === 'steer') expect(request.target_job_id).toBe('job-1');
      await act(async () => pending.resolve({data: {background: true}}));
      await waitFor(() => expect(box.value).toBe(''));
      view.unmount();
    }
  });

  it('never submits on Shift+Enter or while an IME is composing', async () => {
    bridge.set('SubmitChatRequest', () => {
      throw new Error('must not submit');
    });
    const {box} = setup();
    fireEvent.keyDown(box, {key: 'Enter', shiftKey: true});
    fireEvent.keyDown(box, {key: 'Enter', isComposing: true});
    await act(async () => {});
    expect(bridge.callsTo('SubmitChatRequest')).toHaveLength(0);
  });
});
