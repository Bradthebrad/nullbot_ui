// Conversation state, one per chat: transcript rows, the activity trace,
// submissions and side questions. Streamed records are applied at most once
// per animation frame. Functions without a chat act on the focused chat
// (the one the top bar and palette control).
import {createStore, type Store} from '../lib/store';
import {api} from '../lib/bindings';
import type {ActivityRecord, ChatMessage, Reply, SubmissionSnapshot} from '../lib/types';
import {applyActivity, emptyActivity, type ActivityState} from '../features/activity/model';
import {ingestChatStream, localMessage, messageWithAttachmentTokens, reconcileChatHistory, settleChatStreams} from '../features/chat/transcript';
import {makeChatRequest, submitChatRequest, type ChatMode} from '../chatSubmission';
import type {StagedAttachment} from '../attachments';
import {appStore, openSettings, refreshState, setView} from './app';
import {MAIN_CHAT, focusedChat, showChat} from './chats';
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
  /** Loaded from the backend at least once. */
  loaded: boolean;
};

const emptySubmissions: SubmissionSnapshot = {busy: false, queue: [], jobs: []};
const emptyChat = (): ChatState => ({
  messages: [],
  activity: emptyActivity,
  submissions: emptySubmissions,
  side: [],
  commands: [],
  commandOutput: null,
  sending: false,
  lastStatus: '',
  attachRequest: null,
  loaded: false,
});

export const isBusy = (state: ChatState) => !!(state.submissions.busy || state.submissions.queue?.length);

/** The run's control state, for the top bar, palette and composer. */
export type RunPhase = 'idle' | 'working' | 'pausing' | 'paused' | 'stopping' | 'held';
export function runPhase(state: ChatState): RunPhase {
  const s = state.submissions;
  const running = !!s.primary_id;
  if (running && s.stopping) return 'stopping';
  if (running && s.run_paused) return 'paused';
  if (running) return 'working';
  // Held with nothing running: queued requests wait, or a pause is still in
  // place while the last subagents finish. Either way Resume is the way out.
  if (s.paused || s.run_paused) return 'held';
  return 'idle';
}

export type SendOptions = {mode: ChatMode; text: string; attachments: StagedAttachment[]; skills: string[]; targetJob?: string};

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

export type ChatSession = ReturnType<typeof createChatSession>;

function createChatSession(id: string) {
  const store: Store<ChatState> = createStore<ChatState>(emptyChat());

  // -------------------------------------------------------------- streaming
  let pending: ActivityRecord[] = [];
  let frame = 0;
  let timer = 0;

  function flush() {
    if (frame) cancelAnimationFrame(frame);
    if (timer) window.clearTimeout(timer);
    frame = 0;
    timer = 0;
    const batch = pending;
    pending = [];
    if (!batch.length) return;
    const state = store.get();
    let messages = state.messages;
    for (const record of batch) messages = ingestChatStream(messages, record);
    store.set({messages, activity: applyActivity(state.activity, batch)});
  }

  /**
   * Buffers streamed records and applies them once per frame. A timer backs
   * up the frame, which never fires while the window is minimized.
   */
  function queue(records: ActivityRecord[]) {
    if (!records.length) return;
    pending.push(...records);
    if (pending.length > 5000) {
      flush();
      return;
    }
    if (!frame && typeof requestAnimationFrame === 'function' && !document.hidden) frame = requestAnimationFrame(flush);
    if (!timer) timer = window.setTimeout(flush, 150);
  }

  // ---------------------------------------------------------------- inbound
  function bootstrap(reply: Reply) {
    store.set(state => ({
      messages: reconcileChatHistory(state.messages, reply.history || []),
      activity: applyActivity(state.activity, reply.activity || []),
      submissions: reply.data?.submissions || state.submissions,
      commands: reply.suggestions || state.commands,
      loaded: true,
    }));
  }

  function updateSideFromReply(reply: Reply) {
    const data = reply.data || {};
    store.set(state => ({
      side: state.side.map(item => {
        const matches = (data.request_id && data.request_id === item.requestID) || (data.submission_id && data.submission_id === item.jobID);
        if (!matches) return item;
        const failed = ['error', 'canceled', 'rejected'].includes(data.submission_status);
        return {...item, answer: reply.message || '', status: failed ? 'error' : 'done'};
      }),
    }));
  }

  function handleReply(reply: Reply) {
    flush();
    const data = reply.data || {};
    if ((data.submission_mode || data.mode) === 'also') {
      updateSideFromReply(reply);
      if (reply.activity?.length) queue(reply.activity);
      return;
    }
    if (['queued', 'steering_pending'].includes(data.submission_status)) {
      store.set({lastStatus: reply.message || ''});
      return;
    }
    if (data.history_replace) {
      store.set({messages: reconcileChatHistory([], reply.history || []), activity: applyActivity(emptyActivity, reply.activity || []), lastStatus: reply.message || ''});
      return;
    }
    // A submission's final reply settles that submission's live stream (so
    // the durable answer replaces it instead of appearing twice). Other
    // replies, such as a failed plan or a command, leave live streams alone.
    const status = String(data.submission_status || '');
    const target = data.submission_id ? String(data.submission_id) : undefined;
    store.set(state => {
      let messages = state.messages;
      if (target && status === 'done') messages = settleChatStreams(messages, target, 'complete');
      else if (target && ['error', 'canceled', 'cancelled'].includes(status)) messages = settleChatStreams(messages, target, 'incomplete');
      return {messages: reconcileChatHistory(messages, reply.history || []), lastStatus: reply.message || state.lastStatus};
    });
    if (reply.activity?.length) queue(reply.activity);
    if (data.submissions) handleSubmissions(data.submissions);
  }

  function handleSubmissions(snapshot: SubmissionSnapshot) {
    flush();
    store.set(state => ({
      submissions: snapshot,
      side: state.side.map(item => {
        const job = snapshot.jobs?.find(j => j.request_id === item.requestID || j.id === item.jobID);
        if (!job || !['done', 'error', 'canceled'].includes(job.status) || item.status !== 'working') return item;
        return {...item, answer: job.reply?.message || job.error || '', status: job.status === 'done' ? 'done' : 'error'};
      }),
    }));
  }

  /** Loads the chat from the backend: used when a chat's tab first opens. */
  async function load() {
    try {
      bootstrap(await api.chatState(id));
    } catch (error) {
      store.set({loaded: true, lastStatus: String(error instanceof Error ? error.message : error)});
    }
  }

  // --------------------------------------------------------------- outbound

  /** Sends a chat request. Resolves true once the backend accepted it. */
  async function send({mode, text, attachments, skills, targetJob}: SendOptions): Promise<boolean> {
    if (store.get().sending) return false;
    const request = makeChatRequest(mode, text, attachments, skills, mode === 'steer' ? targetJob : undefined, id);
    store.set({sending: true});
    try {
      if (mode === 'also') {
        const sideID = request.request_id;
        store.set(state => ({side: [...state.side, {id: sideID, requestID: request.request_id, question: text || 'Attached files', attachments, answer: '', status: 'working', time: new Date().toISOString()}]}));
        appStore.set({inspectorOpen: true, inspectorTab: 'side'});
        try {
          const reply = await submitChatRequest(request);
          store.set(state => ({side: state.side.map(item => item.id === sideID ? {...item, requestID: reply.data?.request_id || item.requestID, jobID: reply.data?.submission_id || reply.data?.submission?.id} : item)}));
          return true;
        } catch (error) {
          store.set(state => ({side: state.side.map(item => item.id === sideID ? {...item, answer: String(error instanceof Error ? error.message : error), status: 'error'} : item)}));
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
        store.set(state => ({
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
        store.set(state => ({messages: reconcileChatHistory(state.messages, reply.history || [])}));
        if (slash) {
          const panel = reply.open_panel || '';
          if (panelViews[panel]) panelViews[panel]();
          else if (reply.message) store.set({commandOutput: {command: text.split(/\s/)[0], message: reply.message}});
        }
        void refreshState().catch(() => undefined);
        return true;
      } catch (error) {
        if (!slash) {
          // The draft stays in the composer, so drop the optimistic rows and say why.
          store.set(state => ({
            messages: [
              ...state.messages.filter(m => m.optimisticRequestID !== request.request_id),
              localMessage('assistant', String(error instanceof Error ? error.message : error), {roleClass: 'error', failed: true}),
            ],
          }));
        }
        throw error;
      }
    } finally {
      store.set({sending: false});
    }
  }

  async function command(text: string) {
    try {
      const reply = await api.chatCommand(id, text);
      const panel = reply.open_panel || '';
      if (panelViews[panel]) panelViews[panel]();
      else if (reply.message) store.set({commandOutput: {command: text.split(/\s/)[0], message: reply.message}});
      return reply;
    } catch (error) {
      toastError(error);
      return null;
    }
  }

  async function clear() {
    try {
      await api.chatCommand(id, '/clear');
      store.set({messages: [], commandOutput: null});
      toast('Started a new conversation. Saved sessions are kept.');
    } catch (error) {
      toastError(error);
    }
  }

  async function compact(focus = '') {
    try {
      toast('Compacting the conversation…');
      const reply = await api.chatCompact(id, focus);
      store.set({messages: reconcileChatHistory(store.get().messages, reply.history || [])});
      toast(reply.message || 'Conversation compacted.', 'success');
    } catch (error) {
      toastError(error);
    }
  }

  async function analyze(focus = '') {
    try {
      await api.chatAnalyze(id, focus);
      toast('Analysis started. Follow it in Activity.');
    } catch (error) {
      toastError(error);
    }
  }

  async function plan(focus: string) {
    try {
      const reply = await api.chatCommand(id, `/plan ${focus}`.trim());
      toast(reply.message || 'Planning started.');
    } catch (error) {
      toastError(error);
    }
  }

  async function control(action: 'pause' | 'resume' | 'stop' | 'stop_everything', target = '') {
    try {
      const reply = await api.chatControl(id, action, target);
      if (reply?.data?.submissions) store.set({submissions: reply.data.submissions});
      return reply;
    } catch (error) {
      toastError(error);
      return null;
    }
  }

  async function removeQueued(jobID: string) {
    store.set({submissions: await api.removeChatQueued(id, jobID)});
  }

  return {
    id,
    store,
    queue,
    flush,
    bootstrap,
    load,
    handleReply,
    handleSubmissions,
    send,
    command,
    clear,
    compact,
    analyze,
    plan,
    removeQueued,
    /** Steps under way finish; then the manager and its subagents wait. */
    pause: async () => {
      if (await control('pause')) toast('Pausing. Steps already under way finish first.');
    },
    resume: async () => {
      if (await control('resume')) toast('Resumed.');
    },
    /** The request wraps up: no new tool calls, then a summary of what was done. */
    stop: async () => {
      // Name the request: if it finished meanwhile, the next one isn't stopped.
      const target = store.get().submissions.primary_id || '';
      if (await control('stop', target)) toast('Stopping after the current step.');
    },
    /** Cancels everything now, tool calls included, and holds the queue. */
    stopEverything: async () => {
      if (await control('stop_everything')) toast('Stopped everything. Queued requests wait until you resume.');
    },
    steerSubagent: async (taskID: string, text: string) => {
      try {
        await api.chatSteerSubagent(id, taskID, text);
        toast('Guidance sent to the subagent.');
        return true;
      } catch (error) {
        toastError(error);
        return false;
      }
    },
    clearActivity: () => store.set(state => ({activity: {turns: [], maxSeq: state.activity.maxSeq}})),
    clearSide: () => store.set({side: []}),
  };
}

// ---------------------------------------------------------------- registry

const sessions = new Map<string, ChatSession>();

/** The chat's state and actions; made on first use. */
export function chatSession(id: string = MAIN_CHAT): ChatSession {
  const key = id || MAIN_CHAT;
  let session = sessions.get(key);
  if (!session) {
    session = createChatSession(key);
    sessions.set(key, session);
  }
  return session;
}

/** Forgets a closed chat's state. */
export function forgetChatSession(id: string) {
  if (id !== MAIN_CHAT) sessions.delete(id);
}

export function focusedSession(): ChatSession {
  return chatSession(focusedChat());
}

/** The main chat's store (older callers and tests). */
export const chatStore = chatSession(MAIN_CHAT).store;

// --------------------------------------------------- routing bridge events

/** Routes streamed records to their chats. */
export function queueActivity(records: ActivityRecord[]) {
  const byChat = new Map<string, ActivityRecord[]>();
  for (const record of records) {
    const key = record.chat || MAIN_CHAT;
    if (!byChat.has(key)) byChat.set(key, []);
    byChat.get(key)!.push(record);
  }
  byChat.forEach((list, chat) => chatSession(chat).queue(list));
}

/** Applies queued records now, in every chat. Replies flush first so they see every record sent before them. */
export function flushActivityNow() {
  sessions.forEach(session => session.flush());
}

export function bootstrapChat(reply: Reply) {
  chatSession(reply.data?.chat || MAIN_CHAT).bootstrap(reply);
}

export function handleReply(reply: Reply) {
  chatSession(reply.data?.chat || MAIN_CHAT).handleReply(reply);
}

export function handleSubmissions(snapshot: SubmissionSnapshot) {
  chatSession(snapshot.chat || MAIN_CHAT).handleSubmissions(snapshot);
}

// ------------------------------------------ actions on the focused chat

export const sendChat = (options: SendOptions) => focusedSession().send(options);
export const runCommand = (command: string) => focusedSession().command(command);
export const clearConversation = () => focusedSession().clear();
export const compactConversation = (focus = '') => focusedSession().compact(focus);
export const analyzeWorkspace = (focus = '') => focusedSession().analyze(focus);
export const createPlan = (focus: string) => focusedSession().plan(focus);
export const pauseRuns = () => focusedSession().pause();
export const resumeRuns = () => focusedSession().resume();
export const stopRun = () => focusedSession().stop();
export const stopEverything = () => focusedSession().stopEverything();
export const clearActivity = () => focusedSession().clearActivity();
export const clearSide = () => focusedSession().clearSide();

/** Guidance for a subagent; chat is the chat it runs in (the focused one by default). */
export function steerSubagent(taskID: string, text: string, chat?: string) {
  return chatSession(chat || focusedChat()).steerSubagent(taskID, text);
}

/** Stages files in the focused chat's composer and switches to it. */
export function attachToChat(paths: string[]) {
  if (!paths.length) return;
  const id = focusedChat();
  chatSession(id).store.set({attachRequest: {paths, nonce: Date.now()}});
  showChat(id);
  setView('chat');
}

/** Tests: forget every chat but main, and empty main. */
export function resetChatSessionsForTests() {
  for (const id of [...sessions.keys()]) if (id !== MAIN_CHAT) sessions.delete(id);
  chatSession(MAIN_CHAT).store.set(emptyChat());
}
