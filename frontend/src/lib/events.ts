// Typed subscriptions to bridge events.
import {EventsOn} from '../../wailsjs/runtime/runtime';
import type {ActivityRecord, MCPServerStatus, Reply, SubmissionSnapshot} from './types';

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
export const onChanged = (handler: (change: {topic: string}) => void) => on('changed', handler);
export const onStatus = (handler: (status: {message: string}) => void) => on('status', handler);
