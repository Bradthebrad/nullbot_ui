// Typed access to the Go bridge. Generated bindings (wailsjs) are untyped for
// newer methods; this module is the one place the UI names bridge calls.
import * as Go from '../../wailsjs/go/main/App';
import type {
  AgentTask, FileBrowser, FileSearchKind, FileSearchResult, HistoryEntry, HistoryQuery, HistorySearchResult, FilePreview, MCPServerStatus, MarketState, ModelGroup, Plan, ProjectsState, Project,
  Reply, ScheduledTask, SessionSummary, SkillFile, SubmissionSnapshot, UIState, UsageReport, Visualization, VisualDelivery, VisualEvent, VisualView,
  VaultInfo, SecretInfo, SecretKind, SecretInput, GitHubIdentity, ChatInfo,
} from './types';

const go = Go as unknown as Record<string, (...args: any[]) => Promise<any>>;
function call<T>(name: string, ...args: unknown[]): Promise<T> {
  const fn = go[name];
  if (typeof fn !== 'function') return Promise.reject(new Error(`This build of NullBot is missing ${name}. Rebuild the app.`));
  return fn(...args) as Promise<T>;
}

export const api = {
  state: () => call<UIState>('State'),
  command: (input: string) => call<Reply>('Command', input),
  submit: (input: string) => call<Reply>('Submit', input),
  pause: () => call<Reply>('Pause'),
  resume: () => call<Reply>('Resume'),
  stopRun: (targetID = '') => call<Reply>('StopRun', targetID),
  stopEverything: () => call<Reply>('StopEverything'),
  steerSubagent: (taskID: string, text: string) => call<void>('SteerSubagent', taskID, text),
  analyze: (focus: string) => call<Reply>('Analyze', focus),
  compact: (focus: string) => call<Reply>('CompactConversation', focus),
  contextWindow: (provider: string, model: string) => call<{tokens: number; source: string; detail?: string}>('ContextWindow', provider, model),
  chatSubmissionState: () => call<SubmissionSnapshot>('ChatSubmissionState'),

  saveConfig: (config: any, keys: any) => call<UIState>('SaveConfig', config, keys),
  setModel: (provider: string, model: string, target: string) => call<UIState>('SetModel', provider, model, target),
  modelCatalog: (refresh: boolean) => call<ModelGroup[]>('ModelCatalog', refresh),
  setAppearance: (appearance: string, accent: string) => call<UIState>('SetAppearance', appearance, accent),
  setBotName: (name: string) => call<UIState>('SetBotName', name),
  savePrompts: (prompts: any) => call<UIState>('SavePrompts', prompts),
  promptDefaults: () => call<{manager: string; subagent: string}>('PromptDefaults'),

  projects: () => call<ProjectsState>('Projects'),
  saveProjects: (projects: Project[], primary: string) => call<ProjectsState>('SaveProjects', projects, primary),
  setPrimaryProject: (id: string) => call<ProjectsState>('SetPrimaryProject', id),

  listFiles: (path: string) => call<FileBrowser>('ListFiles', path),
  completePath: (input: string, base: string) => call<{name: string; path: string; is_dir: boolean}[]>('CompletePath', input, base),
  previewFile: (path: string) => call<FilePreview>('PreviewFile', path),
  saveFile: (path: string, content: string) => call<FilePreview>('SaveFile', {path, content}),
  createFile: (dir: string, name: string) => call<FileBrowser>('CreateFile', {dir, name}),
  createDirectory: (dir: string, name: string) => call<FileBrowser>('CreateDirectory', {dir, name}),
  renamePath: (path: string, newName: string) => call<FileBrowser>('RenamePath', {path, new_name: newName}),
  deletePath: (path: string) => call<FileBrowser>('DeletePath', path),
  openExternal: (url: string) => call<void>('OpenExternal', url),
  openPath: (path: string) => call<void>('OpenPath', path),
  openWith: (path: string) => call<void>('OpenWith', path),
  searchFiles: (root: string, query: string, kind: FileSearchKind = '') => call<FileSearchResult>('SearchFiles', {root, query, kind}),
  copyPaths: (sources: string[], dest: string, move = false) => call<FileBrowser>('CopyPaths', {sources, dest, move}),
  revealPath: (path: string) => call<void>('RevealPath', path),

  liveVisualizations: () => call<Visualization[]>('LiveVisualizations'),
  visualizations: (projectID = '') => call<Visualization[]>('Visualizations', projectID),
  visualization: (id: string) => call<Visualization>('Visualization', id),
  openVisualization: (id: string) => call<VisualView>('OpenVisualization', id, window.location.origin),
  visualPage: (id: string, page: string) => call<VisualView>('VisualPage', id, window.location.origin, page),
  recordVisualEvents: (id: string, events: VisualEvent[]) => call<void>('RecordVisualEvents', id, events),
  visualEvents: (id: string, limit = 2000) => call<VisualEvent[]>('VisualEvents', id, limit),
  respondVisualization: (id: string, response: unknown, note: string, dismiss = false) => call<VisualDelivery>('RespondVisualization', {id, response: response ?? null, note, dismiss}),
  deleteVisualization: (id: string) => call<void>('DeleteVisualization', id),
  revealVisualization: (id: string) => call<void>('RevealVisualization', id),

  mcpServers: () => call<MCPServerStatus[]>('MCPServers'),
  mcpServer: (id: string) => call<MCPServerStatus>('MCPServer', id),
  startMCPServer: (id: string) => call<MCPServerStatus>('StartMCPServer', id),
  restartMCPServer: (id: string) => call<MCPServerStatus>('RestartMCPServer', id),
  stopMCPServer: (id: string) => call<MCPServerStatus[]>('StopMCPServer', id),
  toggleMCPServer: (id: string, action: 'enable' | 'disable' | 'remove') => call<UIState>('ToggleMCPServer', id, action),
  addMCPServer: (input: {id?: string; name?: string; transport: string; command: string; args: string[]; env: Record<string, string>; headers: Record<string, string>; enabled: boolean}) => call<UIState>('AddMCPServer', input),
  setMCPToolPolicy: (server: string, tool: string, policy: string) => call<MCPServerStatus>('SetMCPToolPolicy', server, tool, policy),
  marketplace: (refresh: boolean) => call<MarketState>('Marketplace', refresh),
  installMarketPackage: (id: string, small: boolean, enable: boolean) => call<MarketState>('InstallMarketPackage', id, small, enable),

  skills: () => call<SkillFile[]>('Skills'),
  readSkill: (path: string) => call<FilePreview>('ReadSkill', path),
  saveSkill: (name: string, content: string, overwrite: boolean) => call<SkillFile>('SaveSkill', {name, content, overwrite}),

  tasks: () => call<AgentTask[]>('Tasks'),
  cancelTask: (id: string) => call<AgentTask[]>('CancelTask', id),
  scheduledTasks: () => call<ScheduledTask[]>('ScheduledTasks'),
  createScheduledTask: (req: any) => call<ScheduledTask[]>('CreateScheduledTask', req),
  runScheduledTaskNow: (id: string) => call<ScheduledTask[]>('RunScheduledTaskNow', id),
  cancelScheduledTask: (id: string) => call<ScheduledTask[]>('CancelScheduledTask', id),
  deleteScheduledTask: (id: string) => call<ScheduledTask[]>('DeleteScheduledTask', id),

  plans: () => call<Reply>('Plans'),
  readPlan: (id: string) => call<Plan>('ReadPlan', id),
  createPlan: (focus: string) => call<Reply>('CreatePlan', focus),
  executePlan: (id: string) => call<Reply>('ExecutePlan', id),
  savePlan: (id: string, raw: string) => call<Reply>('SavePlan', id, raw),
  deletePlan: (id: string) => call<Reply>('DeletePlan', id),

  sessions: (limit: number) => call<SessionSummary[]>('Sessions', limit),
  searchSessions: (query: string) => call<SessionSummary[]>('SearchSessions', query),
  searchSessionsWith: (query: HistoryQuery) => call<SessionSummary[]>('SearchSessionsWith', query),
  searchHistory: (query: HistoryQuery) => call<HistorySearchResult>('SearchHistory', query),
  sessionEntries: (id: string, includeTools: boolean) => call<HistoryEntry[]>('SessionEntries', id, includeTools),
  readSession: (id: string, limit: number) => call<any[]>('ReadSession', id, limit),
  loadSession: (id: string, limit: number) => call<Reply>('LoadSession', id, limit),
  saveCurrentSession: (name: string) => call<SessionSummary>('SaveCurrentSession', name),

  buildUsageReport: (filter: any, write: boolean) => call<UsageReport>('BuildUsageReport', filter, write),
  saveUsageReport: (filter: any) => call<UsageReport>('SaveUsageReport', filter),

  accountStatus: () => call<any>('AccountStatus'),
  saveAccountKeys: (keys: any) => call<any>('SaveAccountKeys', keys),
  beginCodexLogin: () => call<any>('BeginCodexLogin'),
  pollCodexLogin: (flow: any) => call<any>('PollCodexLogin', flow),

  vaultStatus: () => call<VaultInfo>('VaultStatus'),
  createVault: (protection: string, passphrase: string) => call<VaultInfo>('CreateVault', protection, passphrase),
  unlockVault: (passphrase: string) => call<VaultInfo>('UnlockVault', passphrase),
  lockVault: () => call<VaultInfo>('LockVault'),
  reprotectVault: (protection: string, passphrase: string) => call<VaultInfo>('ReprotectVault', protection, passphrase),
  secrets: () => call<SecretInfo[]>('Secrets'),
  secretKinds: () => call<SecretKind[]>('SecretKinds'),
  saveSecret: (input: SecretInput) => call<SecretInfo>('SaveSecret', input),
  removeSecret: (name: string) => call<void>('RemoveSecret', name),
  generateSSHKey: (name: string, host: string, description: string, agentUse: boolean) => call<SecretInfo>('GenerateSSHKey', name, host, description, agentUse),
  verifyGitHubToken: (name: string) => call<GitHubIdentity>('VerifyGitHubToken', name),
  addSSHKeyToGitHub: (sshName: string, tokenName: string) => call<void>('AddSSHKeyToGitHub', sshName, tokenName),

  chats: () => call<ChatInfo[]>('Chats'),
  openChat: (title = '') => call<ChatInfo>('OpenChat', title),
  continueChat: (historyID: string) => call<ChatInfo>('ContinueChat', historyID),
  closeChat: (id: string) => call<void>('CloseChat', id),
  renameChat: (id: string, title: string) => call<void>('RenameChat', id, title),
  chatState: (chat: string) => call<Reply>('ChatState', chat),
  chatSubmissions: (chat: string) => call<SubmissionSnapshot>('ChatSubmissions', chat),
  chatControl: (chat: string, action: 'pause' | 'resume' | 'stop' | 'stop_everything', target = '') => call<Reply>('ChatControl', chat, action, target),
  chatCommand: (chat: string, input: string) => call<Reply>('ChatCommand', chat, input),
  chatSteerSubagent: (chat: string, taskID: string, text: string) => call<void>('ChatSteerSubagent', chat, taskID, text),
  cancelChatTask: (chat: string, id: string) => call<AgentTask[]>('CancelChatTask', chat, id),
  chatCompact: (chat: string, focus: string) => call<Reply>('ChatCompact', chat, focus),
  chatAnalyze: (chat: string, focus: string) => call<Reply>('ChatAnalyze', chat, focus),
  removeChatQueued: (chat: string, id: string) => call<SubmissionSnapshot>('RemoveChatQueued', chat, id),
};

export type Api = typeof api;
