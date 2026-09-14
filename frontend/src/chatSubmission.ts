import type {StagedAttachment} from './attachments';

export type ChatMode = 'normal' | 'also' | 'queue' | 'steer';
// Composer-facing request keeps text, attachments and selected skills separate.
export type ChatRequest = {mode: ChatMode; text: string; attachments: {token: string}[]; skills?: string[]; request_id: string; target_job_id?: string};
export type SubmissionJob = {id: string; request_id?: string; mode: string; input?: string; status: string; error?: string; reply?: ChatReply};
export type SubmissionSnapshot = {busy: boolean; primary_id?: string; queue: SubmissionJob[]; jobs: SubmissionJob[]};
export type ChatReply = {message?: string; history?: any[]; activity?: any[]; data?: {
  accepted?: boolean; background?: boolean; history_replace?: boolean; mode?: string; request_id?: string; task_id?: string;
  submission_id?: string; submission_mode?: string; submission_status?: string; submissions?: SubmissionSnapshot;
  submission?: {id: string; mode: string; status: string};
}};
type WireRequest = {mode: ChatMode; text: string; skill_paths?: string[]; request_id: string; target_job_id?: string};
type ChatBridge = {RemoveQueuedChat: (id: string) => Promise<SubmissionSnapshot>; SubmitChatRequest: (request: WireRequest) => Promise<ChatReply>; ChatSubmissionState: () => Promise<SubmissionSnapshot>};
function bridge(): ChatBridge {
  return (window as unknown as {go: {main: {App: ChatBridge}}}).go.main.App;
}
export function makeChatRequest(mode: ChatMode, text: string, attachments: StagedAttachment[], skills: string[], targetJobID?: string): ChatRequest {
  return {mode, text, attachments: attachments.map(item => ({token: item.token!})), request_id: crypto.randomUUID(),
    ...(targetJobID ? {target_job_id: targetJobID} : {}), ...(skills.length ? {skills: [...skills]} : {})};
}
// Preserve the existing validated @attachment transport at the bridge boundary.
// Never submit original paths, preview data or raw skill content from the client.
export function chatWireRequest(request: ChatRequest): WireRequest {
  const tokens = request.attachments.map(item => item.token).filter(Boolean);
  return {mode: request.mode, text: [request.text, ...tokens].filter(Boolean).join('\n\n'),
    request_id: request.request_id, ...(request.target_job_id ? {target_job_id: request.target_job_id} : {}),
    ...(request.skills?.length ? {skill_paths: request.skills} : {})};
}
export async function submitChatRequest(request: ChatRequest): Promise<ChatReply> {
  const app = bridge();
  if (typeof app.SubmitChatRequest !== 'function') throw new Error('This UI requires the SubmitChatRequest bridge. Please rebuild NullBot UI.');
  const reply = await app.SubmitChatRequest(chatWireRequest(request));
  if (reply.data?.accepted === false || reply.data?.submission_status === 'rejected' || reply.data?.submission?.status === 'rejected') throw new Error(reply.message || 'Request was not accepted. Your draft has been preserved.');
  return reply;
}
export function chatSubmissionState(): Promise<SubmissionSnapshot> {return bridge().ChatSubmissionState();}

export function removeQueuedChat(id: string): Promise<SubmissionSnapshot> {return bridge().RemoveQueuedChat(id);}
