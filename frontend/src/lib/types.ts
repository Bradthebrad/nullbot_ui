// Shapes of the data the Go bridge returns. Field names match the JSON tags
// in nullbot/pkg/app and nullbot_ui (see nullbot/docs/ACTIVITY_API.md).

export type Capability = 'read' | 'write' | 'delete' | 'execute';
export type Permission = 'read-only' | 'read-write' | 'full' | 'custom';

export type PermissionDecision = {
  allowed: boolean;
  capability: Capability;
  source: string;
  rule: string;
  reason: string;
  project?: string;
  permission?: Permission;
  paths?: {arg: string; path: string; capability: Capability; project?: string; allowed: boolean; reason?: string}[];
};

export type ActivityRecord = {
  seq?: number;
  time?: string;
  kind?: string;
  status?: string;
  name?: string;
  detail?: string;
  submission_id?: string;
  lane?: string;
  agent_id?: string;
  task_id?: string;
  run_id?: string;
  parent_run_id?: string;
  channel?: string;
  private?: boolean;
  visibility?: string;
  call_id?: string;
  tool?: string;
  title?: string;
  server?: string;
  server_title?: string;
  source?: string;
  read_only?: boolean;
  destructive?: boolean;
  args?: Record<string, unknown>;
  result?: string;
  result_meta?: Record<string, unknown>;
  error?: string;
  duration_ms?: number;
  permission?: PermissionDecision;
};

export type ChatMessage = {
  role?: string;
  content?: string;
  time?: string;
  submission_id?: string;
  lane?: string;
  agent_id?: string;
  task_id?: string;
  run_id?: string;
  visible_only?: boolean;
  [key: string]: any;
};

export type Project = {id: string; name: string; path: string; permission: Permission; allow?: Capability[]};
export type ProjectsState = {projects: Project[]; primary_project_id: string; workspace_dir: string; warning: string};

export type ToolRequirement = {
  tool: string;
  server?: string;
  capability: Capability;
  source: string;
  reason: string;
  internal?: boolean;
  blocked?: boolean;
};

export type MCPToolStatus = {
  name: string;
  title?: string;
  description?: string;
  input_schema?: Record<string, any>;
  read_only?: boolean;
  destructive?: boolean;
  open_world?: boolean;
  policy?: string;
  requirement: ToolRequirement;
};

export type MCPServerState = 'disabled' | 'idle' | 'starting' | 'ready' | 'error';

export type MCPServerStatus = {
  id: string;
  name: string;
  transport: string;
  command: string;
  args?: string[];
  remote: boolean;
  enabled: boolean;
  state: MCPServerState;
  error?: string;
  server_name?: string;
  server_version?: string;
  instructions?: string;
  tool_count: number;
  tools?: MCPToolStatus[];
  started_at?: string;
  last_used_at?: string;
  calls: number;
  errors: number;
  avg_latency_ms: number;
  restarts: number;
  pid?: number;
  cwd?: string;
  stderr?: string;
};

export type ModelOption = {provider?: string; id: string; name?: string; description?: string; reasoning?: boolean; responses?: boolean};
export type ModelGroup = {provider: string; models: ModelOption[]; error?: string};

export type AgentTask = {
  id: string;
  name: string;
  role: string;
  prompt?: string;
  status: string;
  current?: string;
  result?: string;
  error?: string;
  started_at?: string;
  updated_at?: string;
  finished_at?: string;
  submission_id?: string;
  lane?: string;
  parent_task_id?: string;
  tool_calls?: {time: string; name: string; status: string; detail?: string}[];
  tokens?: {input?: number; output?: number; total?: number; cached_input?: number; cache_creation_input?: number; reasoning_output?: number};
  cancelable?: boolean;
};

export type ScheduledTask = {
  id: string;
  name?: string;
  prompt: string;
  status: string;
  next_run_at?: string;
  last_run_at?: string;
  run_count?: number;
  repeat_every?: string;
  last_error?: string;
};

export type FileEntry = {name: string; path: string; rel_path: string; is_dir: boolean; size: number; modified: string; extension: string; kind: string};
export type FileBrowser = {workspace: string; current: string; parent: string; entries: FileEntry[]; error?: string};
export type FilePreview = {
  path: string; name: string; kind: string; mime: string; size: number; editable: boolean; truncated: boolean;
  content?: string; data_url?: string; url?: string; rows?: string[][]; headers?: string[]; error?: string;
};

export type SkillFile = {name: string; description: string; path: string; root: string; modified: string; size: number};
export type SessionSummary = {session_id: string; path: string; messages: number; preview: string; modified: string};

export type UsageTotals = {requests?: number; input_tokens?: number; output_tokens?: number; total_tokens?: number; cached_input_tokens?: number; reasoning_output_tokens?: number; cost_usd?: number; estimated?: number};
export type UsageReport = {records: any[]; totals: UsageTotals; buckets: {key: string; totals: UsageTotals}[]; markdown: string; path?: string};

export type MarketPackage = {id: string; name: string; description?: string; kind?: string; status?: string; installed?: boolean; permissions?: string[]; category?: string; version?: string};
export type MarketState = {packages: MarketPackage[]; local_servers?: {id: string; name: string; path: string; description: string}[]; dir?: string; error?: string};

export type SubmissionJob = {id: string; request_id?: string; mode: string; input?: string; status: string; error?: string; reply?: {message?: string; data?: any}};
export type SubmissionSnapshot = {paused?: boolean; busy: boolean; primary_id?: string; queue: SubmissionJob[]; jobs: SubmissionJob[]};

export type Reply = {
  message?: string;
  command?: string;
  open_panel?: string;
  history?: ChatMessage[];
  activity?: ActivityRecord[];
  suggestions?: string[];
  config?: any;
  data?: Record<string, any>;
};

export type UIState = {
  reply: Reply;
  config: any;
  keys: Record<string, any>;
  runtime: Record<string, any>;
  models: ModelGroup[];
  models_fresh: boolean;
  mcp: MCPServerStatus[];
  projects: ProjectsState;
  themes: any[];
  usage: any;
  tasks: AgentTask[];
  scheduled: ScheduledTask[];
  thoughts: any[];
  files: FileBrowser;
  marketplace: MarketState;
};

export type PlanStep = {id?: string; title?: string; name?: string; description?: string; status?: string; substeps?: PlanStep[]};
export type Plan = {
  id: string;
  name?: string;
  goal?: string;
  description?: string;
  status?: string;
  created_at?: string;
  updated_at?: string;
  current_step?: string;
  steps?: PlanStep[];
  notes?: string[];
};
export type PlanSummary = {id: string; name: string; goal?: string; status: string; progress: string; current_step?: string; updated_at?: string; path?: string};
