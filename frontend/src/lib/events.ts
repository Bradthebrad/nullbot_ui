// Typed subscriptions to bridge events.
import {EventsOn} from '../../wailsjs/runtime/runtime';
import type {ActivityRecord, ChatInfo, MCPServerStatus, ModelPullEvent, Reply, SubmissionSnapshot, Visualization} from './types';

function on<T>(name: string, handler: (payload: T) => void): () => void {
  if (typeof window === 'undefined' || !(window as any).runtime) return () => {};
  return EventsOn(name, handler as (...data: any) => void);
}

/** Activity arrives in batches; older builds sent single records. */
export function onActivity(handler: (records: ActivityRecord[]) => void) {
  return on<ActivityRecord | ActivityRecord[]>('activity', payload => handler(Array.isArray(payload) ? payload : [payload]));
}
export const onReply = (handler: (reply: Reply) => void) => on('reply', handler);
export const onSubmissions = (handler: (snapshot: SubmissionSnapshot) => void) => on('submissions', handler);
export const onMCP = (handler: (servers: MCPServerStatus[]) => void) => on('mcp', handler);
export const onChanged = (handler: (change: {topic: string; chat?: string}) => void) => on('changed', handler);
/** The open chats, whenever one opens, closes, is renamed or changes state. */
export const onChats = (handler: (chats: ChatInfo[] | null) => void) => on('chats', handler);
/** Progress of a model being pulled into a local server, and its end. */
export const onModelPull = (handler: (event: ModelPullEvent) => void) => on('model-pull', handler);
export const onStatus = (handler: (status: {message: string}) => void) => on('status', handler);
/** Visuals waiting for a response, whenever that set changes. */
export const onVisuals = (handler: (visuals: Visualization[] | null) => void) => on('visuals', handler);
/** A visual's frame tried to open another of its pages. */
export const onVisualNavigate = (handler: (nav: {id: string; page: string}) => void) => on('visual-navigate', handler);
