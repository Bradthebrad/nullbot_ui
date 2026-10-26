import {beforeEach, describe, expect, it} from 'vitest';
import {deferred, installBridge} from '../test/bridge';
import {chatStore, flushActivityNow, handleReply, handleSubmissions, queueActivity, sendChat} from './chat';
import {appStore} from './app';
import {emptyActivity} from '../features/activity/model';

beforeEach(() => {
  chatStore.set({messages: [], activity: emptyActivity, side: [], submissions: {busy: false, queue: [], jobs: []}, sending: false, commandOutput: null});
  appStore.set({inspectorOpen: false, inspectorTab: 'activity'});
});

const ready = (name: string) => ({id: name, name, status: 'ready' as const, token: `@file("${name}")`, path: `C:\\${name}`});

describe('streamed activity', () => {
  it('applies queued records in one batch, to both the trace and the transcript', () => {
    let notifications = 0;
    const off = chatStore.subscribe(() => notifications++);
    for (let i = 0; i < 30; i++) queueActivity([{seq: i + 1, agent_id: 'main', run_id: 'r', submission_id: 's', status: 'response delta', detail: 'x'}]);
    expect(chatStore.get().messages).toHaveLength(0);
    flushActivityNow();
    off();
    expect(notifications).toBe(1);
    expect(chatStore.get().messages[0].content).toBe('x'.repeat(30));
  });
});

describe('replies', () => {
  it('replaces the conversation when the backend loads a session', () => {
    chatStore.set({messages: [{role: 'user', content: 'old'}]});
    handleReply({message: 'loaded', history: [{role: 'user', content: 'from session'}], data: {history_replace: true}});
    expect(chatStore.get().messages.map(m => m.content)).toEqual(['from session']);
  });

  it('matches side answers by request id or job id, never mixing them up', () => {
    chatStore.set({side: [
      {id: 'a', requestID: 'req-a', question: 'A?', attachments: [], answer: '', status: 'working', time: ''},
      {id: 'b', jobID: 'job-b', question: 'B?', attachments: [], answer: '', status: 'working', time: ''},
    ]});
    handleSubmissions({busy: false, queue: [], jobs: [{id: 'job-b', mode: 'also', status: 'done', reply: {message: 'answer B'}}]});
    expect(chatStore.get().side.map(item => [item.id, item.status, item.answer])).toEqual([['a', 'working', ''], ['b', 'done', 'answer B']]);
    handleReply({message: 'answer A', data: {mode: 'also', request_id: 'req-a', submission_status: 'done'}});
    expect(chatStore.get().side[0]).toMatchObject({status: 'done', answer: 'answer A'});
  });
});

describe('sendChat', () => {
  it('shows the message right away and removes only its own rows if rejected', async () => {
    const bridge = installBridge();
    chatStore.set({messages: [{role: 'user', content: 'earlier', optimisticRequestID: 'other'}]});
    bridge.set('SubmitChatRequest', () => ({message: 'Busy elsewhere', data: {accepted: false}}));
    await expect(sendChat({mode: 'normal', text: 'hello', attachments: [], skills: []})).rejects.toThrow(/Busy elsewhere/);
    const messages = chatStore.get().messages;
    expect(messages.map(m => m.content)).toEqual(['earlier', 'Busy elsewhere']);
    expect(messages[1].failed).toBe(true);
  });

  it('sends attachment tokens and skills, but never paths or previews', async () => {
    const bridge = installBridge({SubmitChatRequest: () => ({data: {background: true}})});
    await sendChat({mode: 'normal', text: 'see file', attachments: [{...ready('a.png'), preview_url: 'data:image/png;base64,AAAA'}], skills: ['s/SKILL.md']});
    const [request] = bridge.callsTo('SubmitChatRequest')[0] as any[];
    expect(request.text).toBe('see file\n\n@file("a.png")');
    expect(request.skill_paths).toEqual(['s/SKILL.md']);
    expect(JSON.stringify(request)).not.toMatch(/C:\\\\|base64/);
  });

  it('ignores a second send while the first is in flight', async () => {
    const pending = deferred<any>();
    const bridge = installBridge({SubmitChatRequest: () => pending.promise});
    const first = sendChat({mode: 'queue', text: 'one', attachments: [], skills: []});
    expect(await sendChat({mode: 'queue', text: 'one', attachments: [], skills: []})).toBe(false);
    pending.resolve({data: {background: true}});
    expect(await first).toBe(true);
    expect(bridge.callsTo('SubmitChatRequest')).toHaveLength(1);
  });

  it('puts side questions in the inspector, with their own request id', async () => {
    installBridge({SubmitChatRequest: (request: any) => ({data: {request_id: request.request_id, submission_id: 'job-9', background: true}})});
    await sendChat({mode: 'also', text: 'quick one?', attachments: [], skills: []});
    const [item] = chatStore.get().side;
    expect(item).toMatchObject({question: 'quick one?', status: 'working', jobID: 'job-9'});
    expect(item.requestID).toBeTruthy();
    expect(appStore.get()).toMatchObject({inspectorOpen: true, inspectorTab: 'side'});
    expect(chatStore.get().messages).toHaveLength(0);
  });
});
