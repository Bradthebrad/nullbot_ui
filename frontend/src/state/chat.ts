// Conversation state: transcript rows, the activity trace, submissions, side
// questions. Streamed records are applied at most once per animation frame.
import {createStore} from '../lib/store';
import {api} from '../lib/bindings';
import type {ActivityRecord, ChatMessage, Reply, SubmissionSnapshot} from '../lib/types';
import {applyActivity, emptyActivity, type ActivityState} from '../features/activity/model';
import {ingestChatStream, interruptChatStreams, localMessage, messageWithAttachmentTokens, reconcileChatHistory} from '../features/chat/transcript';
import {makeChatRequest, submitChatRequest, type ChatMode} from '../chatSubmission';
import type {StagedAttachment} from '../attachments';
import {appStore, openSettings, refreshState, setView} from './app';
import {toast, toastError} from '../ui/toast';

export type SideQuestion = {
  id: string;
  requestID?: string;
  jobID?: string;
  question: string;
  attachments: StagedAttachment[];
  answer: string;
  status: 'working' | 'done' | 'error';
  time: string;
};

export type ChatState = {
  messages: ChatMessage[];
  activity: ActivityState;
  submissions: SubmissionSnapshot;
  side: SideQuestion[];
  commands: string[];
  commandOutput: {command: string; message: string} | null;
  sending: boolean;
  lastStatus: string;
  /** Files another view asked to attach to the next message. */
  attachRequest: {paths: string[]; nonce: number} | null;
};

const emptySubmissions: SubmissionSnapshot = {busy: false, queue: [], jobs: []};

export const chatStore = createStore<ChatState>({
  messages: [],
  activity: emptyActivity,
  submissions: emptySubmissions,
  side: [],
  commands: [],
  commandOutput: null,
  sending: false,
  lastStatus: '',
  attachRequest: null,
});

export const isBusy = (state: ChatState) => !!(state.submissions.busy || state.submissions.queue?.length);

// ---------------------------------------------------------------- streaming

let pending: ActivityRecord[] = [];
let scheduled = 0;

function flushActivity() {
  scheduled = 0;
  const batch = pending;
  pending = [];
  if (!batch.length) return;
  const state = chatStore.get();
  let messages = state.messages;
  for (const record of batch) messages = ingestChatStream(messages, record);
  chatStore.set({messages, activity: applyActivity(state.activity, batch)});
}

export function queueActivity(records: ActivityRecord[]) {
  if (!records.length) return;
  pending.push(...records);
  if (scheduled) return;
  scheduled = document.hidden || typeof requestAnimationFrame !== 'function'
    ? window.setTimeout(flushActivity, 120)
    : requestAnimationFrame(flushActivity);
}

/** For tests: apply queued records synchronously. */
export function flushActivityNow() {
  if (scheduled) {
    cancelAnimationFrame?.(scheduled);
    window.clearTimeout(scheduled);
  }
  flushActivity();
}

// ------------------------------------------------------------------ inbound

export function bootstrapChat(reply: Reply) {
  chatStore.set(state => ({
    messages: reconcileChatHistory(state.messages, reply.history || []),
    activity: applyActivity(state.activity, reply.activity || []),
    submissions: reply.data?.submissions || state.submissions,
    commands: reply.suggestions || state.commands,
  }));
}

function updateSideFromReply(reply: Reply) {
  const data = reply.data || {};
  chatStore.set(state => ({
    side: state.side.map(item => {
      const matches = (data.request_id && data.request_id === item.requestID) || (data.submission_id && data.submission_id === item.jobID);
      if (!matches) return item;
      const failed = ['error', 'canceled', 'rejected'].includes(data.submission_status);
      return {...item, answer: reply.message || '', status: failed ? 'error' : 'done'};
    }),
  }));
}

export function handleReply(reply: Reply) {
  const data = reply.data || {};
  if ((data.submission_mode || data.mode) === 'also') {
    updateSideFromReply(reply);
    if (reply.activity?.length) queueActivity(reply.activity);
    return;
  }
  if (['queued', 'steering_pending'].includes(data.submission_status)) {
    chatStore.set({lastStatus: reply.message || ''});
    return;
  }
  if (data.history_replace) {
    chatStore.set({messages: reconcileChatHistory([], reply.history || []), activity: applyActivity(emptyActivity, reply.activity || []), lastStatus: reply.message || ''});
    return;
  }
  const interrupted = /error|failed|cancel|stopped|paused/i.test(reply.message || '');
  chatStore.set(state => ({
    messages: reconcileChatHistory(reply.command && !reply.command.startsWith('/') || interrupted ? interruptChatStreams(state.messages) : state.messages, reply.history || []),
    lastStatus: reply.message || state.lastStatus,
  }));
  if (reply.activity?.length) queueActivity(reply.activity);
  if (data.submissions) handleSubmissions(data.submissions);
}

export function handleSubmissions(snapshot: SubmissionSnapshot) {
  chatStore.set(state => ({
    submissions: snapshot,
    side: state.side.map(item => {
      const job = snapshot.jobs?.find(j => j.request_id === item.requestID || j.id === item.jobID);
      if (!job || !['done', 'error', 'canceled'].includes(job.status) || item.status !== 'working') return item;
      return {...item, answer: job.reply?.message || job.error || '', status: job.status === 'done' ? 'done' : 'error'};
    }),
  }));
}

// ----------------------------------------------------------------- outbound

const panelViews: Record<string, () => void> = {
  models: () => openSettings('models'),
  config: () => openSettings('agent'),
  usage: () => openSettings('usage'),
  mcp: () => {appStore.set({toolsTab: 'servers'}); setView('tools');},
  market: () => {appStore.set({toolsTab: 'market'}); setView('tools');},
  skills: () => {appStore.set({toolsTab: 'skills'}); setView('tools');},
  history: () => setView('history'),
  plan: () => {appStore.set({activityTab: 'plans'}); setView('activity');},
  tasks: () => {appStore.set({activityTab: 'runs'}); setView('activity');},
  agents: () => {appStore.set({activityTab: 'runs'}); setView('activity');},
  files: () => setView('files'),
};

export type SendOptions = {mode: ChatMode; text: string; attachments: StagedAttachment[]; skills: string[]; targetJob?: string};

/** Sends a chat request. Resolves true once the backend accepted it. */
export async function sendChat({mode, text, attachments, skills, targetJob}: SendOptions): Promise<boolean> {
  if (chatStore.get().sending) return false;
  const request = makeChatRequest(mode, text, attachments, skills, mode === 'steer' ? targetJob : undefined);
  chatStore.set({sending: true});
  try {
    if (mode === 'also') {
      const id = request.request_id;
      chatStore.set(state => ({side: [...state.side, {id, requestID: request.request_id, question: text || 'Attached files', attachments, answer: '', status: 'working', time: new Date().toISOString()}]}));
      appStore.set({inspectorOpen: true, inspectorTab: 'side'});
      try {
        const reply = await submitChatRequest(request);
        chatStore.set(state => ({side: state.side.map(item => item.id === id ? {...item, requestID: reply.data?.request_id || item.requestID, jobID: reply.data?.submission_id || reply.data?.submission?.id} : item)}));
        return true;
      } catch (error) {
        chatStore.set(state => ({side: state.side.map(item => item.id === id ? {...item, answer: String(error instanceof Error ? error.message : error), status: 'error'} : item)}));
        throw error;
      }
    }
    if (mode === 'queue' || mode === 'steer') {
      const reply = await submitChatRequest(request);
      toast(mode === 'queue' ? 'Queued. It runs after the current request.' : 'Guidance sent to the running request.', 'success');
      if (reply.data?.submissions) handleSubmissions(reply.data.submissions);
      return true;
    }
    const slash = text.startsWith('/');
    if (!slash) {
      chatStore.set(state => ({
        messages: [
          ...state.messages,
          localMessage('user', messageWithAttachmentTokens(text, attachments), {attachments, optimisticRequestID: request.request_id}),
          localMessage('assistant', '', {pending: true, optimisticRequestID: request.request_id}),
        ],
      }));
    }
    try {
      const reply = await submitChatRequest(request);
      if (reply.data?.background) return true;
      chatStore.set(state => ({messages: reconcileChatHistory(state.messages, reply.history || [])}));
      if (slash) {
        const panel = reply.open_panel || '';
        if (panelViews[panel]) panelViews[panel]();
        else if (reply.message) chatStore.set({commandOutput: {command: text.split(/\s/)[0], message: reply.message}});
      }
      void refreshState().catch(() => undefined);
      return true;
    } catch (error) {
      if (!slash) {
        // The draft stays in the composer, so drop the optimistic rows and say why.
        chatStore.set(state => ({
          messages: [
            ...state.messages.filter(m => m.optimisticRequestID !== request.request_id),
            localMessage('assistant', String(error instanceof Error ? error.message : error), {roleClass: 'error', failed: true}),
          ],
        }));
      }
      throw error;
    }
  } finally {
    chatStore.set({sending: false});
  }
}

export async function runCommand(command: string) {
  try {
    const reply = await api.command(command);
    const panel = reply.open_panel || '';
    if (panelViews[panel]) panelViews[panel]();
    else if (reply.message) chatStore.set({commandOutput: {command: command.split(/\s/)[0], message: reply.message}});
    return reply;
  } catch (error) {
    toastError(error);
    return null;
  }
}

export async function clearConversation() {
  try {
    await api.command('/clear');
    chatStore.set({messages: [], commandOutput: null});
    toast('Started a new conversation. Saved sessions are kept.');
  } catch (error) {
    toastError(error);
  }
}

export async function compactConversation(focus = '') {
  try {
    toast('Compacting the conversation…');
    const reply = await api.compact(focus);
    chatStore.set({messages: reconcileChatHistory([], reply.history || [])});
    toast('Conversation compacted.', 'success');
  } catch (error) {
    toastError(error);
  }
}

export async function analyzeWorkspace(focus = '') {
  try {
    await api.analyze(focus);
    toast('Analysis started. Follow it in Activity.');
  } catch (error) {
    toastError(error);
  }
}

export async function createPlan(focus: string) {
  try {
    const reply = await api.submit(`/plan ${focus}`.trim());
    toast(reply.message || 'Planning started.');
  } catch (error) {
    toastError(error);
  }
}

export async function stopRun() {
  try {
    await api.pause();
    toast('Stopping. Queued requests wait until you resume.');
  } catch (error) {
    toastError(error);
  }
}

export async function resumeRuns() {
  try {
    await api.resume();
    toast('Resumed.');
  } catch (error) {
    toastError(error);
  }
}

export function clearActivity() {
  chatStore.set(state => ({activity: {turns: [], maxSeq: state.activity.maxSeq}}));
}

export function clearSide() {
  chatStore.set({side: []});
}

/** Stages files in the composer and switches to the conversation. */
export function attachToChat(paths: string[]) {
  if (!paths.length) return;
  chatStore.set({attachRequest: {paths, nonce: Date.now()}});
  setView('chat');
}
