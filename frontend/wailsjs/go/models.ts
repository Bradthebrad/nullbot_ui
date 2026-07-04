export namespace app {
	
	export class APIKeys {
	    openai?: string;
	    anthropic?: string;
	    openrouter?: string;
	    google?: string;
	    other?: Record<string, string>;
	
	    static createFrom(source: any = {}) {
	        return new APIKeys(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.openai = source["openai"];
	        this.anthropic = source["anthropic"];
	        this.openrouter = source["openrouter"];
	        this.google = source["google"];
	        this.other = source["other"];
	    }
	}
	export class ActivityRecord {
	    // Go type: time
	    time: any;
	    kind: string;
	    name?: string;
	    status?: string;
	    detail?: string;
	
	    static createFrom(source: any = {}) {
	        return new ActivityRecord(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.time = this.convertValues(source["time"], null);
	        this.kind = source["kind"];
	        this.name = source["name"];
	        this.status = source["status"];
	        this.detail = source["detail"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class AgentConfig {
	    max_iterations: number;
	    max_subagents: number;
	    use_responses: boolean;
	
	    static createFrom(source: any = {}) {
	        return new AgentConfig(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.max_iterations = source["max_iterations"];
	        this.max_subagents = source["max_subagents"];
	        this.use_responses = source["use_responses"];
	    }
	}
	export class TaskTokens {
	    input?: number;
	    output?: number;
	    total?: number;
	    cached_input?: number;
	    cache_creation_input?: number;
	    reasoning_output?: number;
	
	    static createFrom(source: any = {}) {
	        return new TaskTokens(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.input = source["input"];
	        this.output = source["output"];
	        this.total = source["total"];
	        this.cached_input = source["cached_input"];
	        this.cache_creation_input = source["cache_creation_input"];
	        this.reasoning_output = source["reasoning_output"];
	    }
	}
	export class TaskToolCall {
	    // Go type: time
	    time: any;
	    name: string;
	    status: string;
	    detail?: string;
	
	    static createFrom(source: any = {}) {
	        return new TaskToolCall(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.time = this.convertValues(source["time"], null);
	        this.name = source["name"];
	        this.status = source["status"];
	        this.detail = source["detail"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class AgentTask {
	    id: string;
	    name: string;
	    role: string;
	    prompt?: string;
	    status: string;
	    current?: string;
	    result?: string;
	    error?: string;
	    // Go type: time
	    started_at: any;
	    // Go type: time
	    updated_at: any;
	    // Go type: time
	    finished_at?: any;
	    activity?: ActivityRecord[];
	    tool_calls?: TaskToolCall[];
	    tokens?: TaskTokens;
	    cancelable: boolean;
	    cancel_hint?: string;
	
	    static createFrom(source: any = {}) {
	        return new AgentTask(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.role = source["role"];
	        this.prompt = source["prompt"];
	        this.status = source["status"];
	        this.current = source["current"];
	        this.result = source["result"];
	        this.error = source["error"];
	        this.started_at = this.convertValues(source["started_at"], null);
	        this.updated_at = this.convertValues(source["updated_at"], null);
	        this.finished_at = this.convertValues(source["finished_at"], null);
	        this.activity = this.convertValues(source["activity"], ActivityRecord);
	        this.tool_calls = this.convertValues(source["tool_calls"], TaskToolCall);
	        this.tokens = this.convertValues(source["tokens"], TaskTokens);
	        this.cancelable = source["cancelable"];
	        this.cancel_hint = source["cancel_hint"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class CodexDeviceFlow {
	    device_auth_id: string;
	    user_code: string;
	    verification_uri: string;
	    interval_seconds: number;
	    expires_in: number;
	    expires_at: string;
	
	    static createFrom(source: any = {}) {
	        return new CodexDeviceFlow(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.device_auth_id = source["device_auth_id"];
	        this.user_code = source["user_code"];
	        this.verification_uri = source["verification_uri"];
	        this.interval_seconds = source["interval_seconds"];
	        this.expires_in = source["expires_in"];
	        this.expires_at = source["expires_at"];
	    }
	}
	export class CompactionConfig {
	    enabled: boolean;
	    approx_token_limit: number;
	    threshold_ratio?: number;
	    message_count_limit: number;
	    keep_last_messages: number;
	    tool_result_char_limit: number;
	    default_focus?: string;
	
	    static createFrom(source: any = {}) {
	        return new CompactionConfig(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.enabled = source["enabled"];
	        this.approx_token_limit = source["approx_token_limit"];
	        this.threshold_ratio = source["threshold_ratio"];
	        this.message_count_limit = source["message_count_limit"];
	        this.keep_last_messages = source["keep_last_messages"];
	        this.tool_result_char_limit = source["tool_result_char_limit"];
	        this.default_focus = source["default_focus"];
	    }
	}
	export class MCPEntry {
	    name: string;
	    command: string;
	    args?: string[];
	    env?: Record<string, string>;
	    transport: string;
	    enabled: boolean;
	
	    static createFrom(source: any = {}) {
	        return new MCPEntry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.command = source["command"];
	        this.args = source["args"];
	        this.env = source["env"];
	        this.transport = source["transport"];
	        this.enabled = source["enabled"];
	    }
	}
	export class UIConfig {
	    theme: string;
	
	    static createFrom(source: any = {}) {
	        return new UIConfig(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.theme = source["theme"];
	    }
	}
	export class EditorConfig {
	    command: string;
	    args?: string[];
	
	    static createFrom(source: any = {}) {
	        return new EditorConfig(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.command = source["command"];
	        this.args = source["args"];
	    }
	}
	export class PromptConfig {
	    manager_prompt?: string;
	    subagent_prompt?: string;
	    manager_append?: string;
	    subagent_append?: string;
	
	    static createFrom(source: any = {}) {
	        return new PromptConfig(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.manager_prompt = source["manager_prompt"];
	        this.subagent_prompt = source["subagent_prompt"];
	        this.manager_append = source["manager_append"];
	        this.subagent_append = source["subagent_append"];
	    }
	}
	export class ModelConfig {
	    provider: string;
	    model: string;
	    reasoning_effort?: string;
	    temperature?: number;
	    max_tokens?: number;
	
	    static createFrom(source: any = {}) {
	        return new ModelConfig(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.provider = source["provider"];
	        this.model = source["model"];
	        this.reasoning_effort = source["reasoning_effort"];
	        this.temperature = source["temperature"];
	        this.max_tokens = source["max_tokens"];
	    }
	}
	export class Config {
	    brand_prefix: string;
	    bot_name?: string;
	    tagline: string;
	    app_dir: string;
	    model: ModelConfig;
	    subagent_model?: ModelConfig;
	    agent: AgentConfig;
	    compaction: CompactionConfig;
	    prompts?: PromptConfig;
	    editor: EditorConfig;
	    ui: UIConfig;
	    workspace_dir: string;
	    skill_dirs: string[];
	    enabled_mcp_servers: Record<string, MCPEntry>;
	    permission_defaults: Record<string, string>;
	    history_recent_limit: number;
	    artifact_recent_limit: number;
	
	    static createFrom(source: any = {}) {
	        return new Config(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.brand_prefix = source["brand_prefix"];
	        this.bot_name = source["bot_name"];
	        this.tagline = source["tagline"];
	        this.app_dir = source["app_dir"];
	        this.model = this.convertValues(source["model"], ModelConfig);
	        this.subagent_model = this.convertValues(source["subagent_model"], ModelConfig);
	        this.agent = this.convertValues(source["agent"], AgentConfig);
	        this.compaction = this.convertValues(source["compaction"], CompactionConfig);
	        this.prompts = this.convertValues(source["prompts"], PromptConfig);
	        this.editor = this.convertValues(source["editor"], EditorConfig);
	        this.ui = this.convertValues(source["ui"], UIConfig);
	        this.workspace_dir = source["workspace_dir"];
	        this.skill_dirs = source["skill_dirs"];
	        this.enabled_mcp_servers = this.convertValues(source["enabled_mcp_servers"], MCPEntry, true);
	        this.permission_defaults = source["permission_defaults"];
	        this.history_recent_limit = source["history_recent_limit"];
	        this.artifact_recent_limit = source["artifact_recent_limit"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	
	export class MarketAsset {
	    name: string;
	    platform?: string;
	    arch?: string;
	    url: string;
	    sha256?: string;
	    compressed?: boolean;
	    warning?: string;
	
	    static createFrom(source: any = {}) {
	        return new MarketAsset(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.platform = source["platform"];
	        this.arch = source["arch"];
	        this.url = source["url"];
	        this.sha256 = source["sha256"];
	        this.compressed = source["compressed"];
	        this.warning = source["warning"];
	    }
	}
	export class MarketSkillFile {
	    name: string;
	    path: string;
	    url: string;
	
	    static createFrom(source: any = {}) {
	        return new MarketSkillFile(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.path = source["path"];
	        this.url = source["url"];
	    }
	}
	export class MarketPackage {
	    id: string;
	    kind: string;
	    name: string;
	    description: string;
	    repo: string;
	    release_tag?: string;
	    assets?: MarketAsset[];
	    skill_files?: MarketSkillFile[];
	    default_transport?: string;
	    default_args?: string[];
	    permissions?: string[];
	    installed: boolean;
	    enabled: boolean;
	    install_dir?: string;
	    installed_asset?: string;
	    installed_at?: string;
	    status: string;
	    readme?: string;
	    error?: string;
	
	    static createFrom(source: any = {}) {
	        return new MarketPackage(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.kind = source["kind"];
	        this.name = source["name"];
	        this.description = source["description"];
	        this.repo = source["repo"];
	        this.release_tag = source["release_tag"];
	        this.assets = this.convertValues(source["assets"], MarketAsset);
	        this.skill_files = this.convertValues(source["skill_files"], MarketSkillFile);
	        this.default_transport = source["default_transport"];
	        this.default_args = source["default_args"];
	        this.permissions = source["permissions"];
	        this.installed = source["installed"];
	        this.enabled = source["enabled"];
	        this.install_dir = source["install_dir"];
	        this.installed_asset = source["installed_asset"];
	        this.installed_at = source["installed_at"];
	        this.status = source["status"];
	        this.readme = source["readme"];
	        this.error = source["error"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class MarketSource {
	    name: string;
	    type: string;
	    owner: string;
	    repos: string[];
	
	    static createFrom(source: any = {}) {
	        return new MarketSource(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.type = source["type"];
	        this.owner = source["owner"];
	        this.repos = source["repos"];
	    }
	}
	export class MarketManifest {
	    schema_version: number;
	    // Go type: time
	    updated_at: any;
	    sources: MarketSource[];
	    packages: MarketPackage[];
	
	    static createFrom(source: any = {}) {
	        return new MarketManifest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.schema_version = source["schema_version"];
	        this.updated_at = this.convertValues(source["updated_at"], null);
	        this.sources = this.convertValues(source["sources"], MarketSource);
	        this.packages = this.convertValues(source["packages"], MarketPackage);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	
	
	export class Message {
	    role: string;
	    content: string;
	    // Go type: time
	    time: any;
	    visible_only?: boolean;
	
	    static createFrom(source: any = {}) {
	        return new Message(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.role = source["role"];
	        this.content = source["content"];
	        this.time = this.convertValues(source["time"], null);
	        this.visible_only = source["visible_only"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class ModelOption {
	    provider: string;
	    id: string;
	    name: string;
	    description: string;
	    reasoning: boolean;
	    responses: boolean;
	    api_key_env: string;
	    openai_compatible?: boolean;
	
	    static createFrom(source: any = {}) {
	        return new ModelOption(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.provider = source["provider"];
	        this.id = source["id"];
	        this.name = source["name"];
	        this.description = source["description"];
	        this.reasoning = source["reasoning"];
	        this.responses = source["responses"];
	        this.api_key_env = source["api_key_env"];
	        this.openai_compatible = source["openai_compatible"];
	    }
	}
	export class ModelGroup {
	    provider: string;
	    models: ModelOption[];
	    error?: string;
	
	    static createFrom(source: any = {}) {
	        return new ModelGroup(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.provider = source["provider"];
	        this.models = this.convertValues(source["models"], ModelOption);
	        this.error = source["error"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class PlanStep {
	    id: string;
	    title: string;
	    description?: string;
	    status: string;
	    substeps?: PlanStep[];
	
	    static createFrom(source: any = {}) {
	        return new PlanStep(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.title = source["title"];
	        this.description = source["description"];
	        this.status = source["status"];
	        this.substeps = this.convertValues(source["substeps"], PlanStep);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class Plan {
	    id: string;
	    name: string;
	    goal: string;
	    status: string;
	    // Go type: time
	    created_at: any;
	    // Go type: time
	    updated_at: any;
	    current_step?: string;
	    steps: PlanStep[];
	    notes?: string[];
	
	    static createFrom(source: any = {}) {
	        return new Plan(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.goal = source["goal"];
	        this.status = source["status"];
	        this.created_at = this.convertValues(source["created_at"], null);
	        this.updated_at = this.convertValues(source["updated_at"], null);
	        this.current_step = source["current_step"];
	        this.steps = this.convertValues(source["steps"], PlanStep);
	        this.notes = source["notes"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	
	export class Reply {
	    message: string;
	    command?: string;
	    open_panel?: string;
	    config: Config;
	    history: Message[];
	    activity?: ActivityRecord[];
	    suggestions?: string[];
	    data?: Record<string, any>;
	
	    static createFrom(source: any = {}) {
	        return new Reply(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.message = source["message"];
	        this.command = source["command"];
	        this.open_panel = source["open_panel"];
	        this.config = this.convertValues(source["config"], Config);
	        this.history = this.convertValues(source["history"], Message);
	        this.activity = this.convertValues(source["activity"], ActivityRecord);
	        this.suggestions = source["suggestions"];
	        this.data = source["data"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ScheduleRequest {
	    mode: string;
	    at?: string;
	    every?: string;
	    delay?: string;
	    name?: string;
	    prompt: string;
	
	    static createFrom(source: any = {}) {
	        return new ScheduleRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.mode = source["mode"];
	        this.at = source["at"];
	        this.every = source["every"];
	        this.delay = source["delay"];
	        this.name = source["name"];
	        this.prompt = source["prompt"];
	    }
	}
	export class ScheduledTask {
	    id: string;
	    name?: string;
	    prompt: string;
	    status: string;
	    // Go type: time
	    created_at: any;
	    // Go type: time
	    updated_at: any;
	    // Go type: time
	    next_run_at?: any;
	    // Go type: time
	    last_run_at?: any;
	    // Go type: time
	    finished_at?: any;
	    repeat_every?: string;
	    run_count: number;
	    last_error?: string;
	
	    static createFrom(source: any = {}) {
	        return new ScheduledTask(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.prompt = source["prompt"];
	        this.status = source["status"];
	        this.created_at = this.convertValues(source["created_at"], null);
	        this.updated_at = this.convertValues(source["updated_at"], null);
	        this.next_run_at = this.convertValues(source["next_run_at"], null);
	        this.last_run_at = this.convertValues(source["last_run_at"], null);
	        this.finished_at = this.convertValues(source["finished_at"], null);
	        this.repeat_every = source["repeat_every"];
	        this.run_count = source["run_count"];
	        this.last_error = source["last_error"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	
	export class ThoughtSnapshot {
	    task_id: string;
	    agent: string;
	    role: string;
	    status: string;
	    current?: string;
	    prompt?: string;
	    // Go type: time
	    updated_at: any;
	    notes?: string[];
	
	    static createFrom(source: any = {}) {
	        return new ThoughtSnapshot(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.task_id = source["task_id"];
	        this.agent = source["agent"];
	        this.role = source["role"];
	        this.status = source["status"];
	        this.current = source["current"];
	        this.prompt = source["prompt"];
	        this.updated_at = this.convertValues(source["updated_at"], null);
	        this.notes = source["notes"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class UsageTotals {
	    requests: number;
	    input_tokens: number;
	    output_tokens: number;
	    total_tokens: number;
	    cached_input_tokens?: number;
	    cache_creation_input_tokens?: number;
	    reasoning_output_tokens?: number;
	    cost_usd: number;
	    estimated: number;
	
	    static createFrom(source: any = {}) {
	        return new UsageTotals(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.requests = source["requests"];
	        this.input_tokens = source["input_tokens"];
	        this.output_tokens = source["output_tokens"];
	        this.total_tokens = source["total_tokens"];
	        this.cached_input_tokens = source["cached_input_tokens"];
	        this.cache_creation_input_tokens = source["cache_creation_input_tokens"];
	        this.reasoning_output_tokens = source["reasoning_output_tokens"];
	        this.cost_usd = source["cost_usd"];
	        this.estimated = source["estimated"];
	    }
	}
	export class UsageDailySummary {
	    day: string;
	    provider?: string;
	    model?: string;
	    totals: UsageTotals;
	
	    static createFrom(source: any = {}) {
	        return new UsageDailySummary(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.day = source["day"];
	        this.provider = source["provider"];
	        this.model = source["model"];
	        this.totals = this.convertValues(source["totals"], UsageTotals);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class UsageModelSummary {
	    provider: string;
	    model: string;
	    totals: UsageTotals;
	
	    static createFrom(source: any = {}) {
	        return new UsageModelSummary(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.provider = source["provider"];
	        this.model = source["model"];
	        this.totals = this.convertValues(source["totals"], UsageTotals);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class UsagePriceSummary {
	    provider: string;
	    model_pattern: string;
	    input_per_mtok: number;
	    output_per_mtok: number;
	    estimated_price: boolean;
	
	    static createFrom(source: any = {}) {
	        return new UsagePriceSummary(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.provider = source["provider"];
	        this.model_pattern = source["model_pattern"];
	        this.input_per_mtok = source["input_per_mtok"];
	        this.output_per_mtok = source["output_per_mtok"];
	        this.estimated_price = source["estimated_price"];
	    }
	}
	export class UsageRecord {
	    // Go type: time
	    time: any;
	    session_id: string;
	    provider: string;
	    model: string;
	    agent: string;
	    task_id?: string;
	    input_tokens: number;
	    output_tokens: number;
	    total_tokens: number;
	    cached_input_tokens?: number;
	    cache_creation_input_tokens?: number;
	    reasoning_output_tokens?: number;
	    cost_usd: number;
	    estimated: boolean;
	
	    static createFrom(source: any = {}) {
	        return new UsageRecord(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.time = this.convertValues(source["time"], null);
	        this.session_id = source["session_id"];
	        this.provider = source["provider"];
	        this.model = source["model"];
	        this.agent = source["agent"];
	        this.task_id = source["task_id"];
	        this.input_tokens = source["input_tokens"];
	        this.output_tokens = source["output_tokens"];
	        this.total_tokens = source["total_tokens"];
	        this.cached_input_tokens = source["cached_input_tokens"];
	        this.cache_creation_input_tokens = source["cache_creation_input_tokens"];
	        this.reasoning_output_tokens = source["reasoning_output_tokens"];
	        this.cost_usd = source["cost_usd"];
	        this.estimated = source["estimated"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class UsageSnapshot {
	    records: UsageRecord[];
	    recent: UsageRecord[];
	    session: UsageTotals;
	    total: UsageTotals;
	    by_model: UsageModelSummary[];
	    daily: UsageDailySummary[];
	    pricing: UsagePriceSummary[];
	    // Go type: time
	    last_updated_at: any;
	
	    static createFrom(source: any = {}) {
	        return new UsageSnapshot(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.records = this.convertValues(source["records"], UsageRecord);
	        this.recent = this.convertValues(source["recent"], UsageRecord);
	        this.session = this.convertValues(source["session"], UsageTotals);
	        this.total = this.convertValues(source["total"], UsageTotals);
	        this.by_model = this.convertValues(source["by_model"], UsageModelSummary);
	        this.daily = this.convertValues(source["daily"], UsageDailySummary);
	        this.pricing = this.convertValues(source["pricing"], UsagePriceSummary);
	        this.last_updated_at = this.convertValues(source["last_updated_at"], null);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace main {
	
	export class AccountInfo {
	    id: string;
	    label: string;
	    kind: string;
	    status: string;
	    masked?: string;
	    detail?: string;
	    can_login?: boolean;
	    can_save_key?: boolean;
	    unsupported?: boolean;
	
	    static createFrom(source: any = {}) {
	        return new AccountInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.label = source["label"];
	        this.kind = source["kind"];
	        this.status = source["status"];
	        this.masked = source["masked"];
	        this.detail = source["detail"];
	        this.can_login = source["can_login"];
	        this.can_save_key = source["can_save_key"];
	        this.unsupported = source["unsupported"];
	    }
	}
	export class AccountState {
	    accounts: AccountInfo[];
	    keys_path: string;
	    codex_auth_path: string;
	
	    static createFrom(source: any = {}) {
	        return new AccountState(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.accounts = this.convertValues(source["accounts"], AccountInfo);
	        this.keys_path = source["keys_path"];
	        this.codex_auth_path = source["codex_auth_path"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class AttachmentInfo {
	    name: string;
	    path: string;
	    original_path?: string;
	    token?: string;
	    kind: string;
	    size?: number;
	    error?: string;
	
	    static createFrom(source: any = {}) {
	        return new AttachmentInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.path = source["path"];
	        this.original_path = source["original_path"];
	        this.token = source["token"];
	        this.kind = source["kind"];
	        this.size = source["size"];
	        this.error = source["error"];
	    }
	}
	export class CodexLoginPollState {
	    status: string;
	    message?: string;
	    interval_seconds?: number;
	    account_state: AccountState;
	
	    static createFrom(source: any = {}) {
	        return new CodexLoginPollState(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.status = source["status"];
	        this.message = source["message"];
	        this.interval_seconds = source["interval_seconds"];
	        this.account_state = this.convertValues(source["account_state"], AccountState);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class FileEntry {
	    name: string;
	    path: string;
	    rel_path: string;
	    is_dir: boolean;
	    size: number;
	    // Go type: time
	    modified: any;
	    extension: string;
	    kind: string;
	
	    static createFrom(source: any = {}) {
	        return new FileEntry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.path = source["path"];
	        this.rel_path = source["rel_path"];
	        this.is_dir = source["is_dir"];
	        this.size = source["size"];
	        this.modified = this.convertValues(source["modified"], null);
	        this.extension = source["extension"];
	        this.kind = source["kind"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class FileBrowser {
	    workspace: string;
	    current: string;
	    parent: string;
	    entries: FileEntry[];
	    error?: string;
	
	    static createFrom(source: any = {}) {
	        return new FileBrowser(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.workspace = source["workspace"];
	        this.current = source["current"];
	        this.parent = source["parent"];
	        this.entries = this.convertValues(source["entries"], FileEntry);
	        this.error = source["error"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class FileCreateRequest {
	    dir: string;
	    name: string;
	
	    static createFrom(source: any = {}) {
	        return new FileCreateRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.dir = source["dir"];
	        this.name = source["name"];
	    }
	}
	
	export class FilePreview {
	    path: string;
	    name: string;
	    kind: string;
	    mime: string;
	    size: number;
	    editable: boolean;
	    truncated: boolean;
	    content?: string;
	    data_url?: string;
	    rows?: string[][];
	    headers?: string[];
	    error?: string;
	
	    static createFrom(source: any = {}) {
	        return new FilePreview(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.name = source["name"];
	        this.kind = source["kind"];
	        this.mime = source["mime"];
	        this.size = source["size"];
	        this.editable = source["editable"];
	        this.truncated = source["truncated"];
	        this.content = source["content"];
	        this.data_url = source["data_url"];
	        this.rows = source["rows"];
	        this.headers = source["headers"];
	        this.error = source["error"];
	    }
	}
	export class FileRenameRequest {
	    path: string;
	    new_name: string;
	
	    static createFrom(source: any = {}) {
	        return new FileRenameRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.new_name = source["new_name"];
	    }
	}
	export class LocalMCPServer {
	    id: string;
	    name: string;
	    path: string;
	    description: string;
	    tools?: string[];
	    has_readme: boolean;
	    has_go_mod: boolean;
	
	    static createFrom(source: any = {}) {
	        return new LocalMCPServer(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.path = source["path"];
	        this.description = source["description"];
	        this.tools = source["tools"];
	        this.has_readme = source["has_readme"];
	        this.has_go_mod = source["has_go_mod"];
	    }
	}
	export class MCPInput {
	    id: string;
	    name: string;
	    transport: string;
	    command: string;
	    args: string[];
	    env: Record<string, string>;
	    enabled: boolean;
	
	    static createFrom(source: any = {}) {
	        return new MCPInput(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.transport = source["transport"];
	        this.command = source["command"];
	        this.args = source["args"];
	        this.env = source["env"];
	        this.enabled = source["enabled"];
	    }
	}
	export class MCPToolInfo {
	    name: string;
	    description: string;
	    input_schema?: Record<string, any>;
	
	    static createFrom(source: any = {}) {
	        return new MCPToolInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.description = source["description"];
	        this.input_schema = source["input_schema"];
	    }
	}
	export class MarketState {
	    manifest: app.MarketManifest;
	    packages: app.MarketPackage[];
	    local_servers: LocalMCPServer[];
	    dir: string;
	    error?: string;
	
	    static createFrom(source: any = {}) {
	        return new MarketState(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.manifest = this.convertValues(source["manifest"], app.MarketManifest);
	        this.packages = this.convertValues(source["packages"], app.MarketPackage);
	        this.local_servers = this.convertValues(source["local_servers"], LocalMCPServer);
	        this.dir = source["dir"];
	        this.error = source["error"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class MaskedAPIKeys {
	    openai: string;
	    anthropic: string;
	    openrouter: string;
	    google: string;
	    other?: Record<string, string>;
	
	    static createFrom(source: any = {}) {
	        return new MaskedAPIKeys(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.openai = source["openai"];
	        this.anthropic = source["anthropic"];
	        this.openrouter = source["openrouter"];
	        this.google = source["google"];
	        this.other = source["other"];
	    }
	}
	export class PathSuggestion {
	    name: string;
	    path: string;
	    is_dir: boolean;
	
	    static createFrom(source: any = {}) {
	        return new PathSuggestion(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.path = source["path"];
	        this.is_dir = source["is_dir"];
	    }
	}
	export class PromptDefaults {
	    manager: string;
	    subagent: string;
	
	    static createFrom(source: any = {}) {
	        return new PromptDefaults(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.manager = source["manager"];
	        this.subagent = source["subagent"];
	    }
	}
	export class SaveFileRequest {
	    path: string;
	    content: string;
	
	    static createFrom(source: any = {}) {
	        return new SaveFileRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.content = source["content"];
	    }
	}
	export class SessionSummary {
	    session_id: string;
	    path: string;
	    messages: number;
	    preview: string;
	    // Go type: time
	    modified: any;
	
	    static createFrom(source: any = {}) {
	        return new SessionSummary(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.session_id = source["session_id"];
	        this.path = source["path"];
	        this.messages = source["messages"];
	        this.preview = source["preview"];
	        this.modified = this.convertValues(source["modified"], null);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class SkillFile {
	    name: string;
	    description: string;
	    path: string;
	    root: string;
	    // Go type: time
	    modified: any;
	    size: number;
	
	    static createFrom(source: any = {}) {
	        return new SkillFile(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.description = source["description"];
	        this.path = source["path"];
	        this.root = source["root"];
	        this.modified = this.convertValues(source["modified"], null);
	        this.size = source["size"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class SkillSaveRequest {
	    name: string;
	    content: string;
	    overwrite: boolean;
	
	    static createFrom(source: any = {}) {
	        return new SkillSaveRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.content = source["content"];
	        this.overwrite = source["overwrite"];
	    }
	}
	export class ThemePalette {
	    id: string;
	    name: string;
	    description: string;
	    background: string;
	    panel: string;
	    activity: string;
	    border: string;
	    accent: string;
	    accent2: string;
	    text: string;
	    muted: string;
	
	    static createFrom(source: any = {}) {
	        return new ThemePalette(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.description = source["description"];
	        this.background = source["background"];
	        this.panel = source["panel"];
	        this.activity = source["activity"];
	        this.border = source["border"];
	        this.accent = source["accent"];
	        this.accent2 = source["accent2"];
	        this.text = source["text"];
	        this.muted = source["muted"];
	    }
	}
	export class UIState {
	    reply: app.Reply;
	    config: app.Config;
	    keys: MaskedAPIKeys;
	    runtime: Record<string, any>;
	    models: app.ModelGroup[];
	    themes: ThemePalette[];
	    usage: app.UsageSnapshot;
	    tasks: app.AgentTask[];
	    scheduled: app.ScheduledTask[];
	    thoughts: app.ThoughtSnapshot[];
	    files: FileBrowser;
	    marketplace: MarketState;
	
	    static createFrom(source: any = {}) {
	        return new UIState(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.reply = this.convertValues(source["reply"], app.Reply);
	        this.config = this.convertValues(source["config"], app.Config);
	        this.keys = this.convertValues(source["keys"], MaskedAPIKeys);
	        this.runtime = source["runtime"];
	        this.models = this.convertValues(source["models"], app.ModelGroup);
	        this.themes = this.convertValues(source["themes"], ThemePalette);
	        this.usage = this.convertValues(source["usage"], app.UsageSnapshot);
	        this.tasks = this.convertValues(source["tasks"], app.AgentTask);
	        this.scheduled = this.convertValues(source["scheduled"], app.ScheduledTask);
	        this.thoughts = this.convertValues(source["thoughts"], app.ThoughtSnapshot);
	        this.files = this.convertValues(source["files"], FileBrowser);
	        this.marketplace = this.convertValues(source["marketplace"], MarketState);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class UsageBucket {
	    key: string;
	    totals: app.UsageTotals;
	
	    static createFrom(source: any = {}) {
	        return new UsageBucket(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.key = source["key"];
	        this.totals = this.convertValues(source["totals"], app.UsageTotals);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class UsageFilter {
	    start?: string;
	    end?: string;
	    provider?: string;
	    model?: string;
	    agent?: string;
	    bucket?: string;
	
	    static createFrom(source: any = {}) {
	        return new UsageFilter(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.start = source["start"];
	        this.end = source["end"];
	        this.provider = source["provider"];
	        this.model = source["model"];
	        this.agent = source["agent"];
	        this.bucket = source["bucket"];
	    }
	}
	export class UsageReport {
	    records: app.UsageRecord[];
	    totals: app.UsageTotals;
	    buckets: UsageBucket[];
	    markdown: string;
	    path?: string;
	
	    static createFrom(source: any = {}) {
	        return new UsageReport(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.records = this.convertValues(source["records"], app.UsageRecord);
	        this.totals = this.convertValues(source["totals"], app.UsageTotals);
	        this.buckets = this.convertValues(source["buckets"], UsageBucket);
	        this.markdown = source["markdown"];
	        this.path = source["path"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

