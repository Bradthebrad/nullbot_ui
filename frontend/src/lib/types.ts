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
  /** The chat the record belongs to; absent means the main chat. */
  chat?: string;
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
  /** Context measurements on model starts, compaction and cut tool results. */
  context?: ContextMeasure;
};

/** How full a request's context is, and what compaction did. */
export type ContextMeasure = {
  context_tokens?: number;
  context_window?: number;
  context_ratio?: number;
  tool_tokens?: number;
  shorten_at?: number;
  summarize_at?: number;
  learned_window?: number;
  before_tokens?: number;
  after_tokens?: number;
  shortened?: number;
  summarized?: number;
  /** Set on a tool result the guard cut to fit. */
  full_tokens?: number;
  full_chars?: number;
  shown_chars?: number;
  free_tokens?: number;
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

export type ModelOption = {provider?: string; id: string; name?: string; description?: string; reasoning?: boolean; responses?: boolean; context_window?: number; context_source?: string};
export type ModelGroup = {provider: string; title?: string; models: ModelOption[]; error?: string};

/** A model server you host: Ollama, llama.cpp, LM Studio, vLLM or another OpenAI-compatible server. */
export type LocalEndpoint = {id: string; name?: string; kind: string; base_url: string; key_secret?: string; plain_http?: boolean; disabled?: boolean};
export type LocalModel = {id: string; name?: string; context_window?: number; max_context?: number; context_note?: string; size?: number; parameters?: string; quantization?: string; family?: string; loaded?: boolean; capabilities?: string[]; embedding?: boolean};
export type LocalEndpointInfo = LocalEndpoint & {provider: string; title: string; kind_label: string; status: {reachable: boolean; version?: string; error?: string; latency_ns?: number}; models?: LocalModel[]; insecure?: boolean};
export type LocalServerFound = {kind: string; base_url: string; version?: string; models: number; label: string; configured_as?: string};
export type LocalServerKind = {id: string; label: string; default_url: string};
export type HFModel = {id: string; author?: string; pipeline?: string; downloads: number; likes: number; last_modified?: string; tags?: string[]; needs_token?: boolean};
export type HFBuild = {name: string; quant?: string; size: number; files: string[]; parts: number; complete: boolean; projector?: boolean; recommended?: boolean};
export type InstallTarget = 'ollama' | 'lmstudio' | 'files';
export type InstallRequest = {repo: string; build?: string; quant?: string; target: InstallTarget; server?: string};
export type InstallResult = {target: InstallTarget; model: string; paths?: string[]; next?: string};
export type ModelInstallEvent = {id: string; repo: string; status: string; file?: string; done?: number; total?: number; ended?: boolean; error?: string; result?: InstallResult};
export type Hardware = {os: string; arch: string; cpu_name: string; cpu_cores: number; total_ram_gb: number; available_ram_gb: number; gpus?: {name: string; vram_gb: number; count: number; backend: string; unified_memory?: boolean}[]; backend: string; unified_memory?: boolean};
export type ModelFit = {
  model: {name: string; provider: string; parameter_count: string; context_length: number; use_case: string; capabilities?: string[]; release_date?: string};
  fit: 'perfect' | 'good' | 'marginal' | 'too_tight'; run_mode: string; runtime: string; quant: string;
  memory_required_gb: number; memory_available_gb: number; utilization_pct: number; context_length: number; usable_context: number;
  tokens_per_second: number; score: number; use_case: string; ollama_tag?: string; gguf_repo?: string; notes?: string[];
};
export type ModelFitOptions = {use_case?: string; context_length?: number; runtime?: string; limit?: number; refresh?: boolean; include_small?: boolean};
export type ModelFits = {hardware: Hardware; options: ModelFitOptions; fits: ModelFit[]};
export type ModelPullEvent = {server: string; model: string; status: string; completed?: number; total?: number; done?: boolean; error?: string};

export type AgentTask = {
  id: string;
  /** The chat the task runs in. */
  chat?: string;
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
export type ArchiveEntry = {name: string; size: number; is_dir?: boolean};
export type FilePreview = {
  path: string; name: string; kind: string; mime: string; size: number; editable: boolean; truncated: boolean;
  content?: string; data_url?: string; url?: string; rows?: string[][]; headers?: string[]; error?: string;
  modified?: string;
  /** JSON indented for reading, when the file isn't already. */
  formatted?: string;
  /** An archive's files, and how many it has in all. */
  entries?: ArchiveEntry[]; count?: number;
  /** The start of a binary file, as a hex dump. */
  hex?: string;
  /** How a text file is stored: utf-8, utf-8-bom, utf-16le, utf-16be or windows-1252. Saving keeps it. */
  encoding?: string;
  /** Why a text file can't be edited here, when it can't. */
  read_only_reason?: string;
};
export type FileSearchKind = '' | 'folder' | 'document' | 'code' | 'image' | 'sheet' | 'media' | 'archive';
export type FileSearchResult = {root: string; entries: FileEntry[]; scanned: number; truncated: boolean; skipped?: string[]};

export type SkillFile = {name: string; description: string; path: string; root: string; modified: string; size: number};
export type SessionSummary = {session_id: string; path: string; messages: number; title?: string; preview: string; modified: string; matches?: number; snippet?: string};

export type SavedToolCall = {
  session_id: string; time: string; submission_id?: string; lane?: string; agent_id?: string; task_id?: string;
  status: string; tool?: string; server?: string; args?: Record<string, unknown>; result?: string; error?: string; detail?: string;
  duration_ms?: number; permission?: Record<string, unknown>;
};
export type HistoryEntry = {kind: 'message' | 'tool'; index: number; message?: ChatMessage; tool?: SavedToolCall};
export type HistoryQuery = {text?: string; session_id?: string; roles?: string[]; tool?: string; since?: string; until?: string; limit?: number; offset?: number};
export type HistoryHit = {session_id: string; kind: 'message' | 'tool'; index: number; role?: string; tool?: string; server?: string; status?: string; time: string; submission_id?: string; snippet: string};
export type HistorySearchResult = {hits: HistoryHit[]; more: boolean; sessions_searched: number};

export type UsageTotals = {requests?: number; input_tokens?: number; output_tokens?: number; total_tokens?: number; cached_input_tokens?: number; reasoning_output_tokens?: number; cost_usd?: number; estimated?: number};
export type UsageReport = {records: any[]; totals: UsageTotals; buckets: {key: string; totals: UsageTotals}[]; markdown: string; path?: string};

export type MarketPackage = {id: string; name: string; description?: string; kind?: string; status?: string; installed?: boolean; permissions?: string[]; category?: string; version?: string; release_tag?: string; error?: string};
export type MarketState = {packages: MarketPackage[]; local_servers?: {id: string; name: string; path: string; description: string}[]; dir?: string; error?: string};

export type SubmissionJob = {id: string; request_id?: string; mode: string; input?: string; status: string; error?: string; reply?: {message?: string; data?: any}};
/** paused: queued requests are held. run_paused: running agents wait at their next step. stopping: the running request is wrapping up. */
export type SubmissionSnapshot = {chat?: string; paused?: boolean; run_paused?: boolean; stopping?: boolean; busy: boolean; primary_id?: string; queue: SubmissionJob[]; jobs: SubmissionJob[]};

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

/** A visual the agent showed: a page, picture, chart, diagram or poll. */
export type VisualKind = 'poll' | 'html' | 'svg' | 'image' | 'chart' | 'drawio' | 'file';
export type VisualOption = {id: string; label: string; description?: string; image?: string};
export type Visualization = {
  id: string; title: string; kind: VisualKind; prompt?: string;
  options?: VisualOption[]; multiple?: boolean; allow_other?: boolean; labels?: string[];
  source?: string; root?: string; content_file?: string; allow_network?: boolean; wait?: boolean;
  /** open until answered; submitted; dismissed (skipped). */
  status: 'open' | 'submitted' | 'dismissed';
  project_id?: string; project_name?: string; session_id?: string; submission_id?: string; task_id?: string;
  created_at: string; updated_at: string; responded_at?: string;
  response?: unknown; note?: string; events: number; dropped?: number; dir: string;
  /** An agent is waiting for the answer right now. */
  waiting?: boolean;
};
export type VisualView = {visual: Visualization; document?: string; page?: string; assets?: Record<string, string>; preview?: FilePreview; error?: string};
export type VisualDelivery = {visual: Visualization; how: 'tool' | 'steer' | 'queued' | 'started' | 'saved'; message?: string};
/** One recorded interaction, as the bridge or the window collected it. */
export type VisualEvent = {type: string; t?: number; at?: string; page?: string; target?: string; value?: unknown; key?: string; name?: string; label?: string; message?: string; level?: string; text?: string; url?: string; source?: string; data?: unknown; [key: string]: unknown};


/** The secrets vault: how it is protected and whether it is open. */
export type VaultInfo = {
  path: string; exists: boolean; protection?: string; unlocked: boolean; error?: string; updated?: string;
  keychain?: string; secrets: number; plaintext?: string[]; protection_label?: string; keychain_label?: string;
};
/** A saved secret, without its values. */
export type SecretInfo = {
  name: string; kind: string; label: string; description?: string; public?: Record<string, string>;
  set: string[]; provides: string[]; agent_use: boolean; servers?: string[]; created_by?: string;
  created: string; updated: string; hint?: string;
};
export type SecretField = {name: string; label: string; secret: boolean; required?: boolean; multiline?: boolean; hint?: string; derived?: boolean};
export type SecretKind = {kind: string; label: string; description: string; fields: SecretField[]; file_based?: boolean};
export type SecretInput = {
  name: string; kind: string; description?: string; values?: Record<string, string>; public?: Record<string, string>;
  clear_values?: string[]; agent_use: boolean; servers?: string[];
};
export type GitHubIdentity = {login: string; name?: string; scopes?: string; host: string};

/** One live chat: a conversation with its own queue, run controls and subagents. */
export type ChatInfo = {
  id: string; title: string; main?: boolean;
  status: 'idle' | 'running' | 'paused' | 'stopping' | 'held';
  queue: number; request?: string; last_reply?: string; messages: number;
  subagents?: {id: string; name?: string; role?: string; status: string; current?: string}[];
  history_id: string; created: string; updated: string;
};
