package main

import (
	"archive/zip"
	"bufio"
	"context"
	"encoding/csv"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v2/pkg/options"
	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"

	nullbot "github.com/Bradthebrad/nullbot/pkg/app"
)

const (
	maxPreviewBytes       = 2 * 1024 * 1024
	maxStreamPreviewBytes = 512 * 1024 * 1024
)

type App struct {
	ctx          context.Context
	bot          *nullbot.App
	initErr      error
	submitMu     sync.Mutex
	rootDir      string
	activityStop func()
	changesStop  func()
	batcher      *activityBatcher
	changes      *changeDebouncer
	localFiles   *localFiles
	visuals      *visualSites
	visualOnce   sync.Once
}

type UIState struct {
	Reply       nullbot.Reply             `json:"reply"`
	Config      nullbot.Config            `json:"config"`
	Keys        MaskedAPIKeys             `json:"keys"`
	Runtime     map[string]any            `json:"runtime"`
	Models      []nullbot.ModelGroup      `json:"models"`
	ModelsFresh bool                      `json:"models_fresh"`
	MCP         []nullbot.MCPServerStatus `json:"mcp"`
	Projects    ProjectsState             `json:"projects"`
	Themes      []ThemePalette            `json:"themes"`
	Usage       nullbot.UsageSnapshot     `json:"usage"`
	Tasks       []nullbot.AgentTask       `json:"tasks"`
	Scheduled   []nullbot.ScheduledTask   `json:"scheduled"`
	Thoughts    []nullbot.ThoughtSnapshot `json:"thoughts"`
	Files       FileBrowser               `json:"files"`
	Marketplace MarketState               `json:"marketplace"`
}

type MaskedAPIKeys struct {
	OpenAI     string            `json:"openai"`
	Anthropic  string            `json:"anthropic"`
	OpenRouter string            `json:"openrouter"`
	Google     string            `json:"google"`
	Other      map[string]string `json:"other,omitempty"`
}

type AccountState struct {
	Accounts      []AccountInfo `json:"accounts"`
	KeysPath      string        `json:"keys_path"`
	CodexAuthPath string        `json:"codex_auth_path"`
}

type AccountInfo struct {
	ID          string `json:"id"`
	Label       string `json:"label"`
	Kind        string `json:"kind"`
	Status      string `json:"status"`
	Masked      string `json:"masked,omitempty"`
	Detail      string `json:"detail,omitempty"`
	CanLogin    bool   `json:"can_login,omitempty"`
	CanSaveKey  bool   `json:"can_save_key,omitempty"`
	Unsupported bool   `json:"unsupported,omitempty"`
}

type CodexLoginPollState struct {
	Status          string       `json:"status"`
	Message         string       `json:"message,omitempty"`
	IntervalSeconds int          `json:"interval_seconds,omitempty"`
	AccountState    AccountState `json:"account_state"`
}

type FileBrowser struct {
	Workspace string      `json:"workspace"`
	Current   string      `json:"current"`
	Parent    string      `json:"parent"`
	Entries   []FileEntry `json:"entries"`
	Error     string      `json:"error,omitempty"`
}

type FileEntry struct {
	Name      string    `json:"name"`
	Path      string    `json:"path"`
	RelPath   string    `json:"rel_path"`
	IsDir     bool      `json:"is_dir"`
	Size      int64     `json:"size"`
	Modified  time.Time `json:"modified"`
	Extension string    `json:"extension"`
	Kind      string    `json:"kind"`
}

type PathSuggestion struct {
	Name  string `json:"name"`
	Path  string `json:"path"`
	IsDir bool   `json:"is_dir"`
}

type FilePreview struct {
	Path      string     `json:"path"`
	Name      string     `json:"name"`
	Kind      string     `json:"kind"`
	MIME      string     `json:"mime"`
	Size      int64      `json:"size"`
	Editable  bool       `json:"editable"`
	Truncated bool       `json:"truncated"`
	Content   string     `json:"content,omitempty"`
	DataURL   string     `json:"data_url,omitempty"` // a /__local/ URL for images and PDFs
	URL       string     `json:"url,omitempty"`
	Rows      [][]string `json:"rows,omitempty"`
	Headers   []string   `json:"headers,omitempty"`
	Error     string     `json:"error,omitempty"`
	Modified  time.Time  `json:"modified"`
	// Formatted is JSON indented for reading, when the file isn't already.
	Formatted string `json:"formatted,omitempty"`
	// Entries lists an archive's files; Count is how many it has in all.
	Entries []ArchiveEntry `json:"entries,omitempty"`
	Count   int            `json:"count,omitempty"`
	// Hex is a dump of the start of a binary file.
	Hex string `json:"hex,omitempty"`
	// Encoding is how a text file is stored: utf-8, utf-8-bom, utf-16le,
	// utf-16be or windows-1252.
	Encoding string `json:"encoding,omitempty"`
	// ReadOnlyReason says why an otherwise editable file can't be edited.
	ReadOnlyReason string `json:"read_only_reason,omitempty"`
}

type SaveFileRequest struct {
	Path    string `json:"path"`
	Content string `json:"content"`
}

type FileCreateRequest struct {
	Dir  string `json:"dir"`
	Name string `json:"name"`
}

type FileRenameRequest struct {
	Path    string `json:"path"`
	NewName string `json:"new_name"`
}

type AttachmentInfo struct {
	Name         string `json:"name"`
	Path         string `json:"path"`
	OriginalPath string `json:"original_path,omitempty"`
	Token        string `json:"token,omitempty"`
	Kind         string `json:"kind"`
	Size         int64  `json:"size,omitempty"`
	Error        string `json:"error,omitempty"`
	PreviewURL   string `json:"preview_url,omitempty"`
}

type SkillFile struct {
	Name        string    `json:"name"`
	Description string    `json:"description"`
	Path        string    `json:"path"`
	Root        string    `json:"root"`
	Modified    time.Time `json:"modified"`
	Size        int64     `json:"size"`
}

type SkillSaveRequest struct {
	Name      string `json:"name"`
	Content   string `json:"content"`
	Overwrite bool   `json:"overwrite"`
}

type MarketState struct {
	Manifest     nullbot.MarketManifest  `json:"manifest"`
	Packages     []nullbot.MarketPackage `json:"packages"`
	LocalServers []LocalMCPServer        `json:"local_servers"`
	Dir          string                  `json:"dir"`
	Error        string                  `json:"error,omitempty"`
}

type LocalMCPServer struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Path        string   `json:"path"`
	Description string   `json:"description"`
	Tools       []string `json:"tools,omitempty"`
	HasReadme   bool     `json:"has_readme"`
	HasGoMod    bool     `json:"has_go_mod"`
}

type MCPInput struct {
	ID        string            `json:"id"`
	Name      string            `json:"name"`
	Transport string            `json:"transport"`
	Command   string            `json:"command"`
	Args      []string          `json:"args"`
	Env       map[string]string `json:"env"`
	Headers   map[string]string `json:"headers"`
	Enabled   bool              `json:"enabled"`
}

type MCPToolInfo struct {
	Name        string                  `json:"name"`
	Title       string                  `json:"title,omitempty"`
	Description string                  `json:"description"`
	InputSchema map[string]any          `json:"input_schema,omitempty"`
	Requirement nullbot.ToolRequirement `json:"requirement"`
	Policy      string                  `json:"policy,omitempty"`
}

type PromptDefaults struct {
	Manager  string `json:"manager"`
	Subagent string `json:"subagent"`
}

type SessionSummary struct {
	SessionID string    `json:"session_id"`
	Path      string    `json:"path"`
	Messages  int       `json:"messages"`
	Title     string    `json:"title,omitempty"`
	Preview   string    `json:"preview"`
	Modified  time.Time `json:"modified"`
	// Matches and Snippet are set by SearchSessions.
	Matches int    `json:"matches,omitempty"`
	Snippet string `json:"snippet,omitempty"`
}

type persistedMessage struct {
	SessionID string          `json:"session_id"`
	Message   nullbot.Message `json:"message"`
	Artifact  string          `json:"artifact,omitempty"`
	Time      time.Time       `json:"time"`
}

type UsageFilter struct {
	Start    string `json:"start,omitempty"`
	End      string `json:"end,omitempty"`
	Provider string `json:"provider,omitempty"`
	Model    string `json:"model,omitempty"`
	Agent    string `json:"agent,omitempty"`
	Bucket   string `json:"bucket,omitempty"`
}

type UsageReport struct {
	Records  []nullbot.UsageRecord `json:"records"`
	Totals   nullbot.UsageTotals   `json:"totals"`
	Buckets  []UsageBucket         `json:"buckets"`
	Markdown string                `json:"markdown"`
	Path     string                `json:"path,omitempty"`
}

type UsageBucket struct {
	Key    string              `json:"key"`
	Totals nullbot.UsageTotals `json:"totals"`
}

type ThemePalette struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Background  string `json:"background"`
	Panel       string `json:"panel"`
	Activity    string `json:"activity"`
	Border      string `json:"border"`
	Accent      string `json:"accent"`
	Accent2     string `json:"accent2"`
	Text        string `json:"text"`
	Muted       string `json:"muted"`
}

func NewApp() *App {
	cfg, err := nullbot.LoadOrInitConfig()
	cwd, _ := os.Getwd()
	a := &App{
		initErr:    err,
		rootDir:    filepath.Dir(cwd),
		localFiles: newLocalFiles(),
	}
	if err == nil {
		a.bot = nullbot.New(cfg)
	} else {
		a.bot = nullbot.New(nullbot.DefaultConfig())
	}
	// This app can show visuals, so the agent gets the visualize tools.
	a.bot.EnableVisuals()
	return a
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	if a.activityStop == nil && a.bot != nil {
		a.bot.StartScheduler()
		// Activity reaches the UI as arrays: streamed fragments are merged and
		// flushed about 30 times a second; everything else flushes at once.
		a.batcher = newActivityBatcher(func(batch []nullbot.ActivityRecord) { a.emit("activity", batch) })
		a.activityStop = a.bot.SubscribeActivity(func(record nullbot.ActivityRecord) {
			a.batcher.add(record)
			a.publishSubmissionCompletion(record)
		})
		a.changes = newChangeDebouncer(a.publishChange)
		a.changesStop = a.bot.SubscribeChanges(a.changes.notify)
	}
	if a.initErr != nil {
		a.emit("status", map[string]string{"message": a.initErr.Error()})
	}
}

// shutdown stops background work and every MCP server process.
func (a *App) shutdown(ctx context.Context) {
	if a.activityStop != nil {
		a.activityStop()
		a.activityStop = nil
	}
	if a.changesStop != nil {
		a.changesStop()
		a.changesStop = nil
	}
	if a.changes != nil {
		a.changes.stop()
	}
	if a.bot != nil {
		a.bot.Shutdown()
	}
}

// onSecondInstance brings the existing window forward instead of starting a
// second copy of the app (and a second set of MCP servers).
func (a *App) onSecondInstance(options.SecondInstanceData) {
	if a.ctx == nil {
		return
	}
	wailsRuntime.WindowUnminimise(a.ctx)
	wailsRuntime.WindowShow(a.ctx)
}

// State returns everything the UI needs to render, without network calls:
// the model catalog comes from cache (ModelCatalog fetches), usage is a
// summary, and MCP servers report their live state.
func (a *App) State() (UIState, error) {
	if a.initErr != nil {
		return UIState{}, a.initErr
	}
	reply := a.bot.State()
	config := a.bot.Config()
	keys := a.bot.APIKeys()
	market := a.marketState(false)
	files, _ := a.listFiles(config.WorkspaceDir)
	models, fresh := nullbot.PeekModelGroups(config)
	return UIState{
		Reply:       reply,
		Config:      config,
		Keys:        maskKeys(keys),
		Runtime:     nullbot.RuntimeStatus(config),
		Models:      models,
		ModelsFresh: fresh,
		MCP:         a.bot.MCPStatus(false),
		Projects:    a.Projects(),
		Themes:      themeCatalog(),
		Usage:       a.bot.UsageSummary(),
		Tasks:       a.bot.TaskSnapshots(),
		Scheduled:   a.bot.ScheduledTasks(),
		Thoughts:    a.bot.ThoughtSnapshots(),
		Files:       files,
		Marketplace: market,
	}, nil
}

func (a *App) Submit(input string) (nullbot.Reply, error) {
	return a.startBackgroundSubmit(input, "Chat request")
}

func (a *App) Command(input string) (nullbot.Reply, error) {
	if !strings.HasPrefix(strings.TrimSpace(input), "/") {
		input = "/" + strings.TrimLeft(input, "/")
	}
	return a.submit(input)
}

func (a *App) SendAlso(question string) (nullbot.Reply, error) {
	return a.SubmitChatRequest(ChatRequest{Mode: "also", Text: question})
}

// Pause holds every running agent at its next step and holds the queue.
// Steps already under way finish first.
func (a *App) Pause() (nullbot.Reply, error) {
	a.bot.PauseRuns()
	return a.runReply("Pausing. Steps already under way finish, then everything waits until you resume.")
}

// Resume lets paused agents carry on and starts held requests.
func (a *App) Resume() (nullbot.Reply, error) {
	a.bot.ResumeRuns()
	return a.runReply("Resumed.")
}

// StopRun asks the running request to wrap up: no new tool calls, and an
// answer saying what was done and what is left. Queued requests continue.
// targetID is the request the person was looking at; if a different one is
// running by the time this arrives, nothing stops. Empty means whichever
// request is running.
func (a *App) StopRun(targetID string) (nullbot.Reply, error) {
	if err := a.bot.StopRequest(targetID); err != nil {
		return nullbot.Reply{}, err
	}
	return a.runReply("Stopping. The current step finishes, then the request wraps up.")
}

// StopEverything cancels all running work now and holds queued requests.
func (a *App) StopEverything() (nullbot.Reply, error) {
	a.bot.StopEverything()
	return a.runReply("Stopped everything. Queued requests wait until you resume.")
}

// SteerSubagent sends guidance to one running subagent.
func (a *App) SteerSubagent(taskID, text string) error {
	return a.bot.SteerTask(taskID, text)
}

func (a *App) runReply(message string) (nullbot.Reply, error) {
	reply := a.bot.State()
	reply.Message = message
	reply.Activity = nil
	a.emit("reply", reply)
	return reply, nil
}

func (a *App) Analyze(focus string) (nullbot.Reply, error) {
	cmd := "/analyze"
	if strings.TrimSpace(focus) != "" {
		cmd += " " + strings.TrimSpace(focus)
	}
	return a.startBackgroundSubmit(cmd, "Workspace analysis")
}

// CompactConversation summarizes the conversation with the model and adds
// the summary to the history. Later requests start from it; the messages
// before it stay in the chat and on disk.
func (a *App) CompactConversation(focus string) (nullbot.Reply, error) {
	if a.initErr != nil {
		return nullbot.Reply{}, a.initErr
	}
	if a.bot == nil {
		return nullbot.Reply{}, fmt.Errorf("chat service is not initialized")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	result, err := a.bot.CompactConversation(ctx, strings.TrimSpace(focus))
	if err != nil {
		return nullbot.Reply{}, err
	}
	updated := a.bot.State()
	if updated.Data == nil {
		updated.Data = map[string]any{}
	}
	updated.Data["compaction"] = result.Report
	updated.Message = fmt.Sprintf("Compacted %d messages, from about %d to %d tokens.", result.Report.Summarized, result.Report.BeforeTokens, result.Report.AfterTokens)
	updated.OpenPanel = "chat"
	a.emit("reply", updated)
	return updated, nil
}

// SetContextWindow overrides the context size used for a model. Zero
// removes the override.
func (a *App) SetContextWindow(provider, model string, tokens int) (UIState, error) {
	if a.bot == nil {
		return UIState{}, fmt.Errorf("chat service is not initialized")
	}
	if err := a.bot.SetContextWindowOverride(provider, model, tokens); err != nil {
		return UIState{}, err
	}
	return a.State()
}

// ContextWindow reports the context size a model gets without your
// override, and where that size came from.
func (a *App) ContextWindow(provider, model string) nullbot.ContextWindow {
	if a.bot == nil {
		return nullbot.ContextWindow{}
	}
	return a.bot.BaseContextWindowFor(provider, model)
}

func (a *App) submit(input string) (nullbot.Reply, error) {
	if a.initErr != nil {
		return nullbot.Reply{}, a.initErr
	}
	a.submitMu.Lock()
	defer a.submitMu.Unlock()
	ctx := context.Background()
	reply := a.bot.Submit(ctx, input)
	reply.Activity = nil
	a.emit("reply", reply)
	return reply, nil
}

func (a *App) startBackgroundSubmit(input, label string) (nullbot.Reply, error) {
	if !strings.HasPrefix(strings.TrimSpace(input), "/") {
		return a.SubmitChatRequest(ChatRequest{Mode: "normal", Text: input})
	}
	if a.initErr != nil {
		return nullbot.Reply{}, a.initErr
	}
	input = strings.TrimSpace(input)
	if input == "" {
		return nullbot.Reply{}, fmt.Errorf("input is required")
	}
	reply := a.bot.State()
	reply.Message = firstNonEmpty(label, "Background request") + " started."
	reply.Command = input
	if reply.Data == nil {
		reply.Data = map[string]any{}
	}
	reply.Data["background"] = true
	reply.Data["input"] = input
	go func() {
		done := a.bot.Submit(context.Background(), input)
		done.Activity = nil
		a.emit("reply", done)
	}()
	return reply, nil
}

func (a *App) SaveConfig(config nullbot.Config, keys nullbot.APIKeys) (UIState, error) {
	if err := a.bot.UpdateConfig(func(current *nullbot.Config) {
		*current = config
	}); err != nil {
		return UIState{}, err
	}
	currentKeys := a.bot.APIKeys()
	if strings.TrimSpace(keys.OpenAI) != "" {
		currentKeys.OpenAI = keys.OpenAI
	}
	if strings.TrimSpace(keys.Anthropic) != "" {
		currentKeys.Anthropic = keys.Anthropic
	}
	if strings.TrimSpace(keys.OpenRouter) != "" {
		currentKeys.OpenRouter = keys.OpenRouter
	}
	if strings.TrimSpace(keys.Google) != "" {
		currentKeys.Google = keys.Google
	}
	if len(keys.Other) > 0 {
		if currentKeys.Other == nil {
			currentKeys.Other = map[string]string{}
		}
		for provider, key := range keys.Other {
			provider = strings.ToLower(strings.TrimSpace(provider))
			if provider == "" || strings.TrimSpace(key) == "" {
				continue
			}
			currentKeys.Other[provider] = strings.TrimSpace(key)
		}
	}
	if err := a.bot.SaveAPIKeys(currentKeys); err != nil {
		return UIState{}, err
	}
	a.bot.MarkRuntimeDirty("settings saved from Wails UI")
	return a.State()
}

func (a *App) AccountStatus() (AccountState, error) {
	return a.accountState(), nil
}

func (a *App) SaveAccountKeys(keys nullbot.APIKeys) (AccountState, error) {
	current := a.bot.APIKeys()
	if strings.TrimSpace(keys.OpenAI) != "" {
		current.OpenAI = strings.TrimSpace(keys.OpenAI)
	}
	if strings.TrimSpace(keys.Anthropic) != "" {
		current.Anthropic = strings.TrimSpace(keys.Anthropic)
	}
	if strings.TrimSpace(keys.OpenRouter) != "" {
		current.OpenRouter = strings.TrimSpace(keys.OpenRouter)
	}
	if strings.TrimSpace(keys.Google) != "" {
		current.Google = strings.TrimSpace(keys.Google)
	}
	if len(keys.Other) > 0 {
		if current.Other == nil {
			current.Other = map[string]string{}
		}
		for provider, key := range keys.Other {
			provider = strings.ToLower(strings.TrimSpace(provider))
			key = strings.TrimSpace(key)
			if provider == "" || key == "" {
				continue
			}
			current.Other[provider] = key
		}
	}
	if err := a.bot.SaveAPIKeys(current); err != nil {
		return AccountState{}, err
	}
	a.bot.MarkRuntimeDirty("account credentials saved from Wails UI")
	return a.accountState(), nil
}

func (a *App) BeginCodexLogin() (nullbot.CodexDeviceFlow, error) {
	flow, err := nullbot.RequestCodexDeviceCode(a.ctx)
	if err != nil {
		return nullbot.CodexDeviceFlow{}, err
	}
	if strings.TrimSpace(flow.VerificationURI) != "" && a.ctx != nil {
		wailsRuntime.BrowserOpenURL(a.ctx, flow.VerificationURI)
	}
	return flow, nil
}

func (a *App) PollCodexLogin(flow nullbot.CodexDeviceFlow) (CodexLoginPollState, error) {
	result, err := nullbot.PollCodexDeviceFlow(a.ctx, a.bot.Config(), flow)
	if err != nil {
		return CodexLoginPollState{AccountState: a.accountState()}, err
	}
	if result.Status == "authorized" {
		a.bot.MarkRuntimeDirty("Codex subscription login saved from Wails UI")
	}
	return CodexLoginPollState{
		Status:          result.Status,
		Message:         result.Message,
		IntervalSeconds: result.IntervalSeconds,
		AccountState:    a.accountState(),
	}, nil
}

func (a *App) OpenCodexLogin() (AccountState, error) {
	flow, err := a.BeginCodexLogin()
	if err != nil {
		return a.accountState(), err
	}
	interval := time.Duration(flow.IntervalSeconds) * time.Second
	if interval <= 0 {
		interval = 5 * time.Second
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	expiresAt, err := time.Parse(time.RFC3339, flow.ExpiresAt)
	if err != nil {
		expiresIn := flow.ExpiresIn
		if expiresIn <= 0 {
			expiresIn = 900
		}
		expiresAt = time.Now().Add(time.Duration(expiresIn) * time.Second)
	}
	timeout := time.NewTimer(time.Until(expiresAt))
	defer timeout.Stop()
	for {
		select {
		case <-a.ctx.Done():
			return a.accountState(), a.ctx.Err()
		case <-timeout.C:
			return a.accountState(), fmt.Errorf("Codex login timed out")
		case <-ticker.C:
			state, err := a.PollCodexLogin(flow)
			if err != nil {
				return a.accountState(), err
			}
			switch state.Status {
			case "authorized":
				return state.AccountState, nil
			case "slow_down":
				if state.IntervalSeconds > 0 {
					ticker.Reset(time.Duration(state.IntervalSeconds) * time.Second)
				}
			case "expired", "denied":
				return state.AccountState, fmt.Errorf("%s", firstNonEmpty(state.Message, "Codex login did not complete"))
			}
		}
	}
}

func (a *App) SetModel(provider, model, target string) (UIState, error) {
	provider = strings.TrimSpace(provider)
	model = strings.TrimSpace(model)
	target = strings.ToLower(strings.TrimSpace(target))
	if provider == "" || model == "" {
		return UIState{}, fmt.Errorf("provider and model are required")
	}
	if target == "" {
		target = "manager"
	}
	if err := a.bot.UpdateConfig(func(config *nullbot.Config) {
		next := nullbot.ModelConfig{Provider: provider, Model: model}
		switch target {
		case "manager":
			next.ReasoningEffort = config.Model.ReasoningEffort
			next.Temperature = config.Model.Temperature
			next.MaxTokens = config.Model.MaxTokens
			config.Model = next
		case "subagent":
			next.ReasoningEffort = config.SubagentModel.ReasoningEffort
			next.Temperature = config.SubagentModel.Temperature
			next.MaxTokens = config.SubagentModel.MaxTokens
			config.SubagentModel = next
		case "both":
			next.ReasoningEffort = config.Model.ReasoningEffort
			next.Temperature = config.Model.Temperature
			next.MaxTokens = config.Model.MaxTokens
			config.Model = next
			config.SubagentModel = next
		}
	}); err != nil {
		return UIState{}, err
	}
	a.bot.MarkRuntimeDirty("model changed from Wails UI")
	return a.State()
}

func (a *App) SetTheme(themeID string) (UIState, error) {
	if err := a.bot.UpdateConfig(func(config *nullbot.Config) {
		config.UI.Theme = strings.TrimSpace(themeID)
	}); err != nil {
		return UIState{}, err
	}
	return a.State()
}

func (a *App) SetBotName(name string) (UIState, error) {
	if err := a.bot.UpdateConfig(func(config *nullbot.Config) {
		config.BotName = strings.TrimSpace(name)
	}); err != nil {
		return UIState{}, err
	}
	a.bot.MarkRuntimeDirty("bot name changed from Wails UI")
	return a.State()
}

func (a *App) SavePrompts(prompts nullbot.PromptConfig) (UIState, error) {
	if err := a.bot.UpdateConfig(func(config *nullbot.Config) {
		config.Prompts = prompts
	}); err != nil {
		return UIState{}, err
	}
	a.bot.MarkRuntimeDirty("prompt overrides changed from Wails UI")
	return a.State()
}

func (a *App) PromptDefaults() (PromptDefaults, error) {
	defaults := a.bot.PromptDefaults()
	return PromptDefaults{
		Manager:  defaults["manager"],
		Subagent: defaults["subagent"],
	}, nil
}

func (a *App) Models() ([]nullbot.ModelGroup, error) {
	return a.ModelCatalog(false), nil
}

// ListFiles lists a folder inside a project (or a file's folder).
func (a *App) ListFiles(path string) (FileBrowser, error) {
	config := a.bot.Config()
	if strings.TrimSpace(path) == "" {
		path = config.WorkspaceDir
	}
	if _, err := checkUIProjectPath(config, path, false, false); err != nil {
		workspace, _ := filepath.Abs(config.WorkspaceDir)
		return FileBrowser{Workspace: workspace, Current: path, Error: err.Error()}, err
	}
	return a.listFiles(path)
}

func (a *App) CompletePath(input, baseDir string) ([]PathSuggestion, error) {
	input = strings.Trim(input, "\"'` \t\r\n")
	config := a.bot.Config()
	baseDir = firstNonEmpty(baseDir, config.WorkspaceDir)
	base, err := filepath.Abs(filepath.Clean(baseDir))
	if err != nil {
		base = config.WorkspaceDir
	}

	target := input
	if target == "" {
		target = base
	} else if !filepath.IsAbs(target) {
		target = filepath.Join(base, target)
	}
	target = filepath.Clean(target)
	if !nullbot.PathLexicallyInProjects(config, target) && !nullbot.PathLexicallyInProjects(config, filepath.Dir(target)) {
		return nil, nil
	}

	parent := target
	prefix := ""
	if input != "" && !endsWithPathSeparator(input) {
		if info, err := os.Stat(target); err == nil && info.IsDir() {
			parent = target
		} else {
			parent = filepath.Dir(target)
			prefix = filepath.Base(target)
		}
	}

	// Only complete inside projects: refuse other paths (including UNC paths)
	// before touching the filesystem.
	if !nullbot.PathLexicallyInProjects(config, parent) {
		return nil, nil
	}
	suggestions, err := readPathSuggestions(parent, prefix)
	if err != nil {
		return nil, err
	}
	if len(suggestions) == 0 && isBareRelativePath(input) {
		fallbackRoots := []string{config.WorkspaceDir}
		for _, root := range fallbackRoots {
			root, err := filepath.Abs(filepath.Clean(root))
			if err != nil || samePath(root, parent) {
				continue
			}
			next, err := readPathSuggestions(root, input)
			if err != nil {
				return nil, err
			}
			suggestions = append(suggestions, next...)
			if len(suggestions) > 0 {
				break
			}
		}
	}
	sort.Slice(suggestions, func(i, j int) bool {
		if suggestions[i].IsDir != suggestions[j].IsDir {
			return suggestions[i].IsDir
		}
		return strings.ToLower(suggestions[i].Name) < strings.ToLower(suggestions[j].Name)
	})
	if len(suggestions) > 40 {
		suggestions = suggestions[:40]
	}
	return suggestions, nil
}

func (a *App) SetWorkingDirectory(path string) (FileBrowser, error) {
	path = strings.TrimSpace(path)
	if path == "" {
		return FileBrowser{}, fmt.Errorf("path is required")
	}
	if err := a.bot.UpdateConfig(func(config *nullbot.Config) {
		config.WorkspaceDir = path
	}); err != nil {
		return FileBrowser{}, err
	}
	a.bot.MarkRuntimeDirty("workspace changed from Wails UI")
	return a.listFiles(path)
}

// PreviewFile previews a file inside a project.
func (a *App) PreviewFile(path string) (FilePreview, error) {
	if _, err := checkUIProjectPath(a.bot.Config(), path, false, false); err != nil {
		return FilePreview{}, err
	}
	return a.previewFile(path)
}

// checkUIProjectPath fails closed for irregular ancestors (notably Windows
// junctions, which current Go EvalSymlinks does not resolve), then delegates
// canonical path and overlapping-grant authorization to the shared policy.
func checkUIProjectPath(config nullbot.Config, path string, write, tree bool) (string, error) {
	capability := nullbot.CapRead
	if write {
		capability = nullbot.CapWrite
	}
	return checkUIProjectAccess(config, path, capability, tree)
}

// checkUIProjectAccess is checkUIProjectPath for one capability. Paths outside
// every project are refused before any filesystem access, so a link to
// \\host\share in a bot reply can't make the app open a network connection.
func checkUIProjectAccess(config nullbot.Config, path string, capability nullbot.Capability, tree bool) (string, error) {
	if !nullbot.PathLexicallyInProjects(config, path) {
		return "", fmt.Errorf("path is outside configured projects")
	}
	checkAncestors := func(path string) error {
		abs, err := filepath.Abs(path)
		if err != nil {
			return err
		}
		for {
			info, err := os.Lstat(abs)
			if err != nil && !os.IsNotExist(err) {
				return err
			}
			if err == nil && info.Mode()&os.ModeIrregular != 0 {
				return fmt.Errorf("unsupported reparse point or irregular path: %s", abs)
			}
			parent := filepath.Dir(abs)
			if parent == abs {
				return nil
			}
			abs = parent
		}
	}
	if !filepath.IsAbs(path) {
		path = filepath.Join(config.WorkspaceDir, path)
	}
	paths := []string{path}
	if len(config.Projects) == 0 {
		paths = append(paths, config.WorkspaceDir)
	}
	for _, p := range config.Projects {
		paths = append(paths, p.Path)
	}
	for _, candidate := range paths {
		if err := checkAncestors(candidate); err != nil {
			return "", err
		}
	}
	resolved, err := nullbot.CheckProjectAccess(config, path, capability, tree)
	if err != nil {
		return "", err
	}
	if err := checkAncestors(resolved); err != nil {
		return "", err
	}
	return resolved, nil
}

func (a *App) SaveFile(req SaveFileRequest) (FilePreview, error) {
	path, err := checkUIProjectPath(a.bot.Config(), req.Path, true, false)
	if err != nil {
		return FilePreview{}, err
	}
	if len(req.Content) > maxPreviewBytes {
		return FilePreview{}, fmt.Errorf("edited content exceeds %d bytes", maxPreviewBytes)
	}
	preview, err := a.previewFile(path)
	if err != nil {
		return FilePreview{}, err
	}
	if !preview.Editable {
		if preview.ReadOnlyReason != "" {
			return FilePreview{}, fmt.Errorf("%s: %s", filepath.Base(path), preview.ReadOnlyReason)
		}
		return FilePreview{}, fmt.Errorf("%s is not editable in the built-in editor", filepath.Base(path))
	}
	// Write it back the way it was stored: a UTF-8 or UTF-16 byte order
	// mark stays, so other tools keep reading the file correctly.
	data, err := encodeText(req.Content, preview.Encoding)
	if err != nil {
		return FilePreview{}, err
	}
	if err := os.WriteFile(path, data, 0600); err != nil {
		return FilePreview{}, err
	}
	return a.previewFile(path)
}

func (a *App) CreateDirectory(req FileCreateRequest) (FileBrowser, error) {
	parent, target, err := createTargetPath(a.bot.Config(), req.Dir, req.Name)
	if err != nil {
		return FileBrowser{}, err
	}
	if _, err := checkUIProjectPath(a.bot.Config(), target, true, false); err != nil {
		return FileBrowser{}, err
	}
	if err := os.Mkdir(target, 0700); err != nil {
		return FileBrowser{}, err
	}
	return a.listFiles(parent)
}

func (a *App) CreateFile(req FileCreateRequest) (FileBrowser, error) {
	parent, target, err := createTargetPath(a.bot.Config(), req.Dir, req.Name)
	if err != nil {
		return FileBrowser{}, err
	}
	if _, err := checkUIProjectPath(a.bot.Config(), target, true, false); err != nil {
		return FileBrowser{}, err
	}
	file, err := os.OpenFile(target, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return FileBrowser{}, err
	}
	if err := file.Close(); err != nil {
		return FileBrowser{}, err
	}
	return a.listFiles(parent)
}

func (a *App) RenamePath(req FileRenameRequest) (FileBrowser, error) {
	config := a.bot.Config()
	lexical, err := lexicalPath(config, req.Path)
	if err != nil {
		return FileBrowser{}, err
	}
	// A link is renamed itself, never what it points to.
	path, _, err := linkAwarePath(config, lexical, nullbot.CapWrite)
	if err != nil {
		return FileBrowser{}, err
	}
	if isProjectRoot(config, lexical) || isProjectRoot(config, path) {
		return FileBrowser{}, fmt.Errorf("a project folder can’t be renamed from here; change it in Settings")
	}
	listed := filepath.Dir(lexical)
	_, target, err := createTargetPath(config, listed, req.NewName)
	if err != nil {
		return FileBrowser{}, err
	}
	if filepath.Base(lexical) == filepath.Base(target) {
		return a.listFiles(listed)
	}
	source, err := os.Lstat(path)
	if err != nil {
		return FileBrowser{}, err
	}
	// On a file system that ignores case, the new name can find the file
	// itself: a change of case alone is still a rename.
	if existing, err := os.Lstat(target); err == nil && !os.SameFile(source, existing) {
		return FileBrowser{}, fmt.Errorf("%s already exists", filepath.Base(target))
	} else if err != nil && !os.IsNotExist(err) {
		return FileBrowser{}, err
	}
	if _, err := checkUIProjectPath(config, target, true, true); err != nil {
		return FileBrowser{}, err
	}
	if err := os.Rename(path, target); err != nil {
		return FileBrowser{}, err
	}
	return a.listFiles(listed)
}

func (a *App) DeletePath(raw string) (FileBrowser, error) {
	config := a.bot.Config()
	// A link is deleted itself, never what it points to.
	path, link, err := linkAwarePath(config, raw, nullbot.CapDelete)
	if err != nil {
		return FileBrowser{}, err
	}
	parent := filepath.Dir(path)
	workspace, _ := filepath.Abs(filepath.Clean(config.WorkspaceDir))
	if samePath(path, workspace) || samePath(path, parent) || filepath.Base(path) == string(filepath.Separator) || isProjectRoot(config, path) {
		return FileBrowser{}, fmt.Errorf("refusing to delete protected directory %s", path)
	}
	if link {
		if err := os.Remove(path); err != nil {
			return FileBrowser{}, err
		}
		return a.listFiles(parent)
	}
	info, err := os.Stat(path)
	if err != nil {
		return FileBrowser{}, err
	}
	if info.IsDir() {
		if err := os.RemoveAll(path); err != nil {
			return FileBrowser{}, err
		}
	} else if err := os.Remove(path); err != nil {
		return FileBrowser{}, err
	}
	return a.listFiles(parent)
}

func (a *App) AttachFiles(paths []string) ([]AttachmentInfo, error) {
	out := make([]AttachmentInfo, 0, len(paths))
	for _, raw := range paths {
		// Strip one matching quote pair, not arbitrary filename characters.
		if _, ok := attachmentPath(raw); !ok {
			raw = strings.TrimSpace(raw)
			if len(raw) >= 2 && strings.ContainsRune("\"'`", rune(raw[0])) && raw[len(raw)-1] == raw[0] {
				raw = raw[1 : len(raw)-1]
			}
		}
		if raw == "" {
			continue
		}
		out = append(out, a.attachFile(raw))
	}
	return out, nil
}

func (a *App) AttachTextPaths(text string) ([]AttachmentInfo, error) {
	paths := attachmentPathsFromText(text)
	if len(paths) == 0 {
		return nil, nil
	}
	return a.AttachFiles(paths)
}

func (a *App) Skills() ([]SkillFile, error) {
	config := a.bot.Config()
	var out []SkillFile
	for _, dir := range config.SkillDirs {
		entries, err := os.ReadDir(dir)
		if err != nil {
			continue
		}
		for _, entry := range entries {
			path := filepath.Join(dir, entry.Name(), "SKILL.md")
			info, err := os.Stat(path)
			if err != nil || info.IsDir() {
				continue
			}
			content, _ := os.ReadFile(path)
			name, desc := skillMeta(string(content), entry.Name())
			out = append(out, SkillFile{
				Name:        name,
				Description: desc,
				Path:        path,
				Root:        filepath.Dir(path),
				Modified:    info.ModTime(),
				Size:        info.Size(),
			})
		}
	}
	sort.Slice(out, func(i, j int) bool { return strings.ToLower(out[i].Name) < strings.ToLower(out[j].Name) })
	return out, nil
}

// ReadSkill previews a SKILL.md inside a configured skill folder.
func (a *App) ReadSkill(path string) (FilePreview, error) {
	config := a.bot.Config()
	roots := append([]string{filepath.Join(config.AppDir, "skills")}, config.SkillDirs...)
	skillConfig := config
	skillConfig.Projects = nil
	for i, root := range roots {
		if strings.TrimSpace(root) != "" {
			skillConfig.Projects = append(skillConfig.Projects, nullbot.Project{ID: fmt.Sprintf("skills-%d", i), Name: "skills", Path: root, Permission: "read-only"})
		}
	}
	if !strings.EqualFold(filepath.Base(path), "SKILL.md") || len(skillConfig.Projects) == 0 {
		return FilePreview{}, fmt.Errorf("not a skill file")
	}
	resolved, err := checkUIProjectPath(skillConfig, path, false, false)
	if err != nil {
		return FilePreview{}, err
	}
	return a.previewFile(resolved)
}

func (a *App) SaveSkill(req SkillSaveRequest) (SkillFile, error) {
	name := strings.TrimSpace(req.Name)
	if name == "" {
		return SkillFile{}, fmt.Errorf("skill name is required")
	}
	content := strings.TrimSpace(req.Content)
	if content == "" {
		return SkillFile{}, fmt.Errorf("skill content is required")
	}
	if len(content) > 128*1024 {
		return SkillFile{}, fmt.Errorf("skill content exceeds 128KB")
	}
	config := a.bot.Config()
	root := filepath.Join(config.AppDir, "skills")
	if len(config.SkillDirs) > 0 && strings.TrimSpace(config.SkillDirs[0]) != "" {
		root = config.SkillDirs[0]
	}
	slug := slugName(name)
	if slug == "" {
		return SkillFile{}, fmt.Errorf("skill name cannot be slugged safely")
	}
	dir := filepath.Join(root, slug)
	path := filepath.Join(dir, "SKILL.md")
	// Configured skill roots are app-managed even outside projects. First
	// confine the destination to that root, resolving symlinks; then include
	// all project grants so overlapping read-only projects still win.
	root, err := filepath.Abs(root)
	if err != nil {
		return SkillFile{}, err
	}
	path = filepath.Join(root, slug, "SKILL.md")
	skillConfig := config
	skillConfig.Projects = []nullbot.Project{{ID: "skill-root", Path: root, Permission: "read-write"}}
	path, err = checkUIProjectPath(skillConfig, path, true, false)
	if err != nil {
		return SkillFile{}, err
	}
	projects := config.Projects
	if len(projects) == 0 {
		projects = []nullbot.Project{{Path: config.WorkspaceDir, Permission: "read-only"}}
	}
	skillConfig.Projects = append(skillConfig.Projects, projects...)
	path, err = checkUIProjectPath(skillConfig, path, true, false)
	if err != nil {
		return SkillFile{}, err
	}
	dir = filepath.Dir(path)
	if _, err := os.Stat(path); err == nil && !req.Overwrite {
		return SkillFile{}, fmt.Errorf("%s already exists", path)
	}
	if err := os.MkdirAll(dir, 0700); err != nil {
		return SkillFile{}, err
	}
	if err := os.WriteFile(path, []byte(content+"\n"), 0600); err != nil {
		return SkillFile{}, err
	}
	info, _ := os.Stat(path)
	name, desc := skillMeta(content, slug)
	a.bot.MarkRuntimeDirty("skill saved from Wails UI")
	return SkillFile{Name: name, Description: desc, Path: path, Root: dir, Modified: info.ModTime(), Size: info.Size()}, nil
}

func (a *App) Marketplace(refresh bool) (MarketState, error) {
	return a.marketState(refresh), nil
}

func (a *App) InstallMarketPackage(id string, small bool, enable bool) (MarketState, error) {
	config := a.bot.Config()
	pkg, err := nullbot.InstallMarketPackage(context.Background(), config, id, small)
	if err != nil {
		return a.marketState(false), err
	}
	if pkg.Kind == "mcp_server" {
		a.bot.StopMCPServer(pkg.ID) // the old build stops; the new one starts on next use
	}
	if enable && pkg.Kind == "mcp_server" {
		next, err := nullbot.EnableMCPServer(config, pkg.ID)
		if err != nil {
			return a.marketState(false), err
		}
		if err := a.bot.UpdateConfig(func(config *nullbot.Config) {
			*config = next
		}); err != nil {
			return a.marketState(false), err
		}
		a.bot.MarkRuntimeDirty("market package enabled from Wails UI")
	}
	return a.marketState(false), nil
}

func (a *App) MCPState() (map[string]any, error) {
	config := a.bot.Config()
	manifest, _ := nullbot.LoadMarketManifest(config)
	return map[string]any{
		"servers":       config.EnabledMCPServers,
		"packages":      manifest.Packages,
		"local_servers": a.scanLocalMCPServers(),
		"dir":           filepath.Join(config.AppDir, "mcp"),
	}, nil
}

// DiscoverMCPTools starts the server if needed (through the shared pool) and
// lists its tools with the capability each is treated as needing.
func (a *App) DiscoverMCPTools(id string) ([]MCPToolInfo, error) {
	id = strings.TrimSpace(id)
	if id == "" {
		return nil, fmt.Errorf("server id is required")
	}
	entry, ok := a.bot.Config().EnabledMCPServers[id]
	if !ok {
		return nil, fmt.Errorf("MCP server %q is not configured", id)
	}
	if !entry.Enabled {
		return nil, fmt.Errorf("MCP server %q is disabled", id)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := a.bot.StartMCPServer(ctx, id); err != nil {
		return nil, err
	}
	status, _ := a.bot.MCPServerStatusByID(id)
	out := make([]MCPToolInfo, 0, len(status.Tools))
	for _, tool := range status.Tools {
		out = append(out, MCPToolInfo{Name: tool.Name, Title: tool.Title, Description: tool.Description, InputSchema: tool.InputSchema, Requirement: tool.Requirement, Policy: tool.Policy})
	}
	return out, nil
}

func (a *App) AddMCPServer(input MCPInput) (UIState, error) {
	id := slugName(firstNonEmpty(input.ID, input.Name, filepath.Base(input.Command)))
	if id == "" {
		return UIState{}, fmt.Errorf("server id or command is required")
	}
	transport := strings.TrimSpace(input.Transport)
	if transport == "" {
		transport = "stdio"
	}
	command := strings.TrimSpace(input.Command)
	args := append([]string{}, input.Args...)
	if transport == "python-fastmcp" {
		transport = "stdio"
		if command == "" {
			return UIState{}, fmt.Errorf("python file is required")
		}
		args = []string{command}
		command = "python"
	}
	if command == "" {
		return UIState{}, fmt.Errorf("command or endpoint is required")
	}
	err := a.bot.UpdateConfig(func(config *nullbot.Config) {
		servers := make(map[string]nullbot.MCPEntry, len(config.EnabledMCPServers)+1)
		for k, v := range config.EnabledMCPServers {
			servers[k] = v
		}
		servers[id] = nullbot.MCPEntry{
			Name:      firstNonEmpty(input.Name, id),
			Command:   command,
			Args:      args,
			Env:       input.Env,
			Headers:   input.Headers,
			Transport: transport,
			Enabled:   input.Enabled,
		}
		config.EnabledMCPServers = servers
	})
	if err != nil {
		return UIState{}, err
	}
	a.bot.MarkRuntimeDirty("MCP server added from Wails UI")
	return a.State()
}

func (a *App) ToggleMCPServer(id, action string) (UIState, error) {
	id = strings.TrimSpace(id)
	action = strings.ToLower(strings.TrimSpace(action))
	if id == "" {
		return UIState{}, fmt.Errorf("server id is required")
	}
	config := a.bot.Config()
	var next nullbot.Config
	var err error
	switch action {
	case "enable":
		if _, ok := config.EnabledMCPServers[id]; ok {
			err = a.bot.UpdateConfig(func(config *nullbot.Config) {
				servers := copyServers(config.EnabledMCPServers)
				entry := servers[id]
				entry.Enabled = true
				servers[id] = entry
				config.EnabledMCPServers = servers
			})
		} else {
			next, err = nullbot.EnableMCPServer(config, id)
			if err == nil {
				err = a.bot.UpdateConfig(func(config *nullbot.Config) { *config = next })
			}
		}
	case "disable":
		err = a.bot.UpdateConfig(func(config *nullbot.Config) {
			servers := copyServers(config.EnabledMCPServers)
			if entry, ok := servers[id]; ok {
				entry.Enabled = false
				servers[id] = entry
			}
			config.EnabledMCPServers = servers
		})
	case "remove":
		err = a.bot.UpdateConfig(func(config *nullbot.Config) {
			servers := copyServers(config.EnabledMCPServers)
			delete(servers, id)
			config.EnabledMCPServers = servers
		})
	default:
		err = fmt.Errorf("unsupported MCP action %q", action)
	}
	if err != nil {
		return UIState{}, err
	}
	a.bot.MarkRuntimeDirty("MCP server " + action + " from Wails UI")
	return a.State()
}

// Sessions lists saved sessions, newest first. Only the sessions returned
// are read.
func (a *App) Sessions(limit int) ([]SessionSummary, error) {
	if limit <= 0 {
		limit = 100
	}
	config := a.bot.Config()
	dir := filepath.Join(config.AppDir, "history")
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, nil
	}
	type candidate struct {
		name string
		mod  time.Time
	}
	var files []candidate
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".jsonl") {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}
		files = append(files, candidate{entry.Name(), info.ModTime()})
	}
	sort.Slice(files, func(i, j int) bool { return files[i].mod.After(files[j].mod) })
	if len(files) > limit {
		files = files[:limit]
	}
	sessions := make([]SessionSummary, 0, len(files))
	for _, file := range files {
		sessions = append(sessions, summarizeSession(filepath.Join(dir, file.name), file.mod))
	}
	return sessions, nil
}

// summarizeSession titles a session by its first request and previews its
// last message.
func summarizeSession(path string, modified time.Time) SessionSummary {
	messages, _ := readSessionFile(path, 0)
	summary := SessionSummary{SessionID: strings.TrimSuffix(filepath.Base(path), ".jsonl"), Path: path, Messages: len(messages), Modified: modified}
	for _, message := range messages {
		if message.Role == "user" && strings.TrimSpace(message.Content) != "" && message.Lane != "also" {
			summary.Title = truncateRunes(strings.Join(strings.Fields(message.Content), " "), 120)
			break
		}
	}
	if len(messages) > 0 {
		last := messages[len(messages)-1]
		summary.Preview = last.Role + ": " + truncateRunes(strings.ReplaceAll(last.Content, "\n", " "), 160)
	}
	return summary
}

func (a *App) ReadSession(sessionID string, limit int) ([]nullbot.Message, error) {
	path, err := a.sessionPath(sessionID)
	if err != nil {
		return nil, err
	}
	return readSessionFile(path, limit)
}

func (a *App) LoadSession(sessionID string, limit int) (nullbot.Reply, error) {
	messages, err := a.ReadSession(sessionID, limit)
	if err != nil {
		return nullbot.Reply{}, err
	}
	// Also has an independent conversation. Older session logs may contain its
	// public output; never import those entries into the primary conversation.
	primary := make([]nullbot.Message, 0, len(messages))
	for _, message := range messages {
		if message.Lane != "also" {
			primary = append(primary, message)
		}
	}
	if !a.bot.TryReplaceHistory(primary) {
		return nullbot.Reply{}, fmt.Errorf("cannot load a session while submissions are active or queued")
	}
	reply := a.bot.State()
	reply.Data["history_replace"] = true
	reply.Message = "Loaded session " + sessionID + "."
	a.emit("reply", reply)
	return reply, nil
}

// SearchSessions lists sessions with a message or tool call matching query,
// most recent match first, each with its first match as a snippet.
func (a *App) SearchSessions(query string) ([]SessionSummary, error) {
	if strings.TrimSpace(query) == "" {
		return a.Sessions(1000)
	}
	result, err := nullbot.SearchHistory(a.bot.Config(), nullbot.HistoryQuery{Text: query, Limit: 200})
	if err != nil {
		return nil, err
	}
	return a.sessionsForHits(result.Hits), nil
}

// SearchSessionsWith lists sessions with matches for a filtered search, most
// recent match first.
func (a *App) SearchSessionsWith(query nullbot.HistoryQuery) ([]SessionSummary, error) {
	query.SessionID = ""
	if query.Limit <= 0 {
		query.Limit = 200
	}
	result, err := nullbot.SearchHistory(a.bot.Config(), query)
	if err != nil {
		return nil, err
	}
	return a.sessionsForHits(result.Hits), nil
}

func (a *App) sessionsForHits(hits []nullbot.HistoryHit) []SessionSummary {
	dir := filepath.Join(a.bot.Config().AppDir, "history")
	index := map[string]int{}
	var sessions []SessionSummary
	for _, hit := range hits {
		if i, ok := index[hit.SessionID]; ok {
			sessions[i].Matches++
			continue
		}
		path := filepath.Join(dir, hit.SessionID+".jsonl")
		modified := time.Time{}
		if info, err := os.Stat(path); err == nil {
			modified = info.ModTime()
		}
		summary := summarizeSession(path, modified)
		summary.Matches, summary.Snippet = 1, hit.Snippet
		index[hit.SessionID] = len(sessions)
		sessions = append(sessions, summary)
	}
	return sessions
}

// SearchHistory searches saved messages and tool calls with filters; see
// nullbot.HistoryQuery.
func (a *App) SearchHistory(query nullbot.HistoryQuery) (nullbot.HistorySearchResult, error) {
	return nullbot.SearchHistory(a.bot.Config(), query)
}

// SessionEntries returns a session's messages and, optionally, the tool calls
// made during it, in time order.
func (a *App) SessionEntries(sessionID string, includeTools bool) ([]nullbot.HistoryEntry, error) {
	return nullbot.HistorySessionEntries(a.bot.Config(), sessionID, includeTools)
}

func (a *App) SaveCurrentSession(name string) (SessionSummary, error) {
	state := a.bot.State()
	if len(state.History) == 0 {
		return SessionSummary{}, fmt.Errorf("no visible messages to save")
	}
	slug := slugName(name)
	if slug == "" {
		slug = "saved-" + time.Now().UTC().Format("20060102-150405")
	}
	config := a.bot.Config()
	dir := filepath.Join(config.AppDir, "history")
	if err := os.MkdirAll(dir, 0700); err != nil {
		return SessionSummary{}, err
	}
	path := filepath.Join(dir, slug+".jsonl")
	file, err := os.Create(path)
	if err != nil {
		return SessionSummary{}, err
	}
	defer file.Close()
	for _, msg := range state.History {
		record := persistedMessage{SessionID: slug, Message: msg, Time: time.Now().UTC()}
		data, _ := json.Marshal(record)
		_, _ = file.Write(append(data, '\n'))
	}
	info, _ := os.Stat(path)
	return SessionSummary{SessionID: slug, Path: path, Messages: len(state.History), Preview: "saved current visible chat", Modified: info.ModTime()}, nil
}

func (a *App) Tasks() ([]nullbot.AgentTask, error) {
	return a.bot.TaskSnapshots(), nil
}

func (a *App) ScheduledTasks() ([]nullbot.ScheduledTask, error) {
	return a.bot.ScheduledTasks(), nil
}

func (a *App) CreateScheduledTask(req nullbot.ScheduleRequest) ([]nullbot.ScheduledTask, error) {
	if _, err := a.bot.CreateScheduledTask(req); err != nil {
		return a.bot.ScheduledTasks(), err
	}
	return a.bot.ScheduledTasks(), nil
}

func (a *App) RunScheduledTaskNow(id string) ([]nullbot.ScheduledTask, error) {
	if _, err := a.bot.RunScheduledTaskNow(id); err != nil {
		return a.bot.ScheduledTasks(), err
	}
	return a.bot.ScheduledTasks(), nil
}

func (a *App) CancelScheduledTask(id string) ([]nullbot.ScheduledTask, error) {
	if _, ok := a.bot.CancelScheduledTask(id); !ok {
		return a.bot.ScheduledTasks(), fmt.Errorf("schedule not found")
	}
	return a.bot.ScheduledTasks(), nil
}

func (a *App) DeleteScheduledTask(id string) ([]nullbot.ScheduledTask, error) {
	if !a.bot.DeleteScheduledTask(id) {
		return a.bot.ScheduledTasks(), fmt.Errorf("schedule not found")
	}
	return a.bot.ScheduledTasks(), nil
}

func (a *App) CancelTask(id string) ([]nullbot.AgentTask, error) {
	if !a.bot.CancelTask(id) {
		return a.bot.TaskSnapshots(), fmt.Errorf("task not cancelable or not found")
	}
	return a.bot.TaskSnapshots(), nil
}

func (a *App) Thoughts() ([]nullbot.ThoughtSnapshot, error) {
	return a.bot.ThoughtSnapshots(), nil
}

func (a *App) Plans() (nullbot.Reply, error) {
	return a.bot.PlanPanel(), nil
}

func (a *App) CreatePlan(focus string) (nullbot.Reply, error) {
	return a.submit("/plan " + strings.TrimSpace(focus))
}

func (a *App) ExecutePlan(id string) (nullbot.Reply, error) {
	taskID, planID, err := a.bot.StartPlanExecutor(strings.TrimSpace(id))
	if err != nil {
		reply := a.bot.PlanPanel()
		reply.Message = "Plan execution failed: " + err.Error()
		reply.Data["error"] = err.Error()
		return reply, err
	}
	reply := a.bot.PlanPanel()
	reply.Message = "Plan execution started for " + planID + "."
	reply.Data["task_id"] = taskID
	reply.Data["plan_id"] = planID
	if plan, err := a.bot.PlanByID(planID); err == nil {
		reply.Data["selected"] = plan
	}
	return reply, nil
}

func (a *App) ReadPlan(id string) (nullbot.Plan, error) {
	return a.bot.PlanByID(id)
}

func (a *App) SavePlan(id, raw string) (nullbot.Reply, error) {
	if err := a.bot.SavePlanJSON(id, raw); err != nil {
		return nullbot.Reply{}, err
	}
	return a.bot.PlanPanel(), nil
}

func (a *App) DeletePlan(id string) (nullbot.Reply, error) {
	id = strings.TrimSpace(id)
	if id == "" {
		return nullbot.Reply{}, fmt.Errorf("plan id is required")
	}
	plan, err := a.bot.PlanByID(id)
	if err != nil {
		return nullbot.Reply{}, err
	}
	config := a.bot.Config()
	dir := filepath.Join(config.AppDir, "plans")
	path := filepath.Join(dir, plan.ID+".json")
	absDir, err := filepath.Abs(filepath.Clean(dir))
	if err != nil {
		return nullbot.Reply{}, err
	}
	absPath, err := filepath.Abs(filepath.Clean(path))
	if err != nil {
		return nullbot.Reply{}, err
	}
	rel, err := filepath.Rel(absDir, absPath)
	if err != nil || strings.HasPrefix(rel, "..") || filepath.IsAbs(rel) {
		return nullbot.Reply{}, fmt.Errorf("refusing to delete plan outside plans directory")
	}
	if err := os.Remove(absPath); err != nil {
		return nullbot.Reply{}, err
	}
	reply := a.bot.PlanPanel()
	reply.Message = "Deleted plan " + plan.ID + "."
	return reply, nil
}

func (a *App) Usage() (nullbot.UsageSnapshot, error) {
	return a.bot.UsageSnapshot(), nil
}

func (a *App) BuildUsageReport(filter UsageFilter, writeFile bool) (UsageReport, error) {
	snapshot := a.bot.UsageSnapshot()
	report := buildUsageReport(snapshot.Records, filter)
	if writeFile {
		config := a.bot.Config()
		dir := filepath.Join(config.AppDir, "artifacts")
		if err := os.MkdirAll(dir, 0700); err != nil {
			return report, err
		}
		path := filepath.Join(dir, "usage-report-"+time.Now().UTC().Format("20060102-150405")+".md")
		if err := os.WriteFile(path, []byte(report.Markdown+"\n"), 0600); err != nil {
			return report, err
		}
		report.Path = path
	}
	return report, nil
}

func (a *App) SaveUsageReport(filter UsageFilter) (UsageReport, error) {
	report := buildUsageReport(a.bot.UsageSnapshot().Records, filter)
	config := a.bot.Config()
	defaultDir := filepath.Join(config.AppDir, "artifacts")
	_ = os.MkdirAll(defaultDir, 0700)
	path := ""
	if a.ctx != nil {
		selected, err := wailsRuntime.SaveFileDialog(a.ctx, wailsRuntime.SaveDialogOptions{
			Title:            "Save NullBot Usage Report",
			DefaultDirectory: defaultDir,
			DefaultFilename:  "usage-report-" + time.Now().Format("20060102-150405") + ".md",
			Filters: []wailsRuntime.FileFilter{
				{DisplayName: "Markdown (*.md)", Pattern: "*.md"},
				{DisplayName: "Text (*.txt)", Pattern: "*.txt"},
			},
			CanCreateDirectories: true,
		})
		if err != nil {
			return report, err
		}
		path = selected
	}
	if strings.TrimSpace(path) == "" {
		return report, nil
	}
	if err := os.WriteFile(path, []byte(report.Markdown+"\n"), 0600); err != nil {
		return report, err
	}
	report.Path = path
	return report, nil
}

func (a *App) emit(name string, payload any) {
	if a.ctx == nil {
		return
	}
	wailsRuntime.EventsEmit(a.ctx, name, payload)
}

func (a *App) listFiles(path string) (FileBrowser, error) {
	config := a.bot.Config()
	workspace, _ := filepath.Abs(config.WorkspaceDir)
	if strings.TrimSpace(path) == "" {
		path = workspace
	}
	current, err := filepath.Abs(filepath.Clean(path))
	if err != nil {
		return FileBrowser{Workspace: workspace, Current: path, Error: err.Error()}, err
	}
	info, err := os.Stat(current)
	if err != nil {
		return FileBrowser{Workspace: workspace, Current: current, Error: err.Error()}, err
	}
	if !info.IsDir() {
		current = filepath.Dir(current)
	}
	entries, err := os.ReadDir(current)
	if err != nil {
		return FileBrowser{Workspace: workspace, Current: current, Error: err.Error()}, err
	}
	out := make([]FileEntry, 0, len(entries))
	for _, entry := range entries {
		info, err := entry.Info()
		if err != nil {
			continue
		}
		full := filepath.Join(current, entry.Name())
		rel, _ := filepath.Rel(workspace, full)
		if strings.HasPrefix(rel, "..") {
			rel = full
		}
		ext := strings.ToLower(filepath.Ext(entry.Name()))
		kind := "folder"
		if !entry.IsDir() {
			kind = fileKind(full)
		}
		out = append(out, FileEntry{
			Name:      entry.Name(),
			Path:      full,
			RelPath:   filepath.ToSlash(rel),
			IsDir:     entry.IsDir(),
			Size:      info.Size(),
			Modified:  info.ModTime(),
			Extension: ext,
			Kind:      kind,
		})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].IsDir != out[j].IsDir {
			return out[i].IsDir
		}
		return strings.ToLower(out[i].Name) < strings.ToLower(out[j].Name)
	})
	return FileBrowser{
		Workspace: workspace,
		Current:   current,
		Parent:    filepath.Dir(current),
		Entries:   out,
	}, nil
}

func createTargetPath(config nullbot.Config, dir, name string) (string, string, error) {
	parent, err := lexicalPath(config, dir)
	if err != nil {
		return "", "", err
	}
	// Refuse paths outside the projects before touching the disk.
	if !nullbot.PathLexicallyInProjects(config, parent) {
		return "", "", fmt.Errorf("path is outside configured projects")
	}
	info, err := os.Stat(parent)
	if err != nil {
		return "", "", err
	}
	if !info.IsDir() {
		return "", "", fmt.Errorf("%s is not a directory", parent)
	}
	name = strings.TrimSpace(name)
	if name == "" {
		return "", "", fmt.Errorf("name is required")
	}
	if name == "." || name == ".." || filepath.Base(name) != name || strings.ContainsAny(name, `/\`) {
		return "", "", fmt.Errorf("use a simple file or folder name, not a path")
	}
	target := filepath.Join(parent, name)
	return parent, target, nil
}

func samePath(a, b string) bool {
	a, _ = filepath.Abs(filepath.Clean(a))
	b, _ = filepath.Abs(filepath.Clean(b))
	return strings.EqualFold(a, b)
}

func endsWithPathSeparator(path string) bool {
	return strings.HasSuffix(path, `/`) || strings.HasSuffix(path, `\`)
}

func isBareRelativePath(path string) bool {
	path = strings.TrimSpace(path)
	return path != "" && !filepath.IsAbs(path) && !strings.ContainsAny(path, `/\`)
}

func readPathSuggestions(parent, prefix string) ([]PathSuggestion, error) {
	info, err := os.Stat(parent)
	if err != nil || !info.IsDir() {
		return nil, nil
	}
	entries, err := os.ReadDir(parent)
	if err != nil {
		return nil, err
	}
	prefix = strings.ToLower(prefix)
	suggestions := make([]PathSuggestion, 0, len(entries))
	for _, entry := range entries {
		name := entry.Name()
		if prefix != "" && !strings.HasPrefix(strings.ToLower(name), prefix) {
			continue
		}
		full := filepath.Join(parent, name)
		if entry.IsDir() {
			full += string(os.PathSeparator)
		}
		suggestions = append(suggestions, PathSuggestion{
			Name:  name,
			Path:  full,
			IsDir: entry.IsDir(),
		})
	}
	return suggestions, nil
}

func (a *App) marketState(refresh bool) MarketState {
	config := a.bot.Config()
	var manifest nullbot.MarketManifest
	var err error
	if refresh {
		manifest, err = nullbot.RefreshMarket(context.Background(), config)
	} else {
		manifest, err = nullbot.LoadMarketManifest(config)
	}
	state := MarketState{
		Manifest:     manifest,
		Packages:     manifest.Packages,
		LocalServers: a.scanLocalMCPServers(),
		Dir:          filepath.Join(config.AppDir, "market"),
	}
	if err != nil {
		state.Error = err.Error()
	}
	return state
}

// copyServers copies the server map so updates never mutate the live config
// before it validates and saves.
func copyServers(in map[string]nullbot.MCPEntry) map[string]nullbot.MCPEntry {
	out := make(map[string]nullbot.MCPEntry, len(in))
	for k, v := range in {
		out[k] = v
	}
	return out
}

func (a *App) scanLocalMCPServers() []LocalMCPServer {
	parent := a.rootDir
	if parent == "" {
		cwd, _ := os.Getwd()
		parent = filepath.Dir(cwd)
	}
	entries, err := os.ReadDir(parent)
	if err != nil {
		return nil
	}
	var servers []LocalMCPServer
	for _, entry := range entries {
		if !entry.IsDir() || !strings.HasPrefix(entry.Name(), "nullbot-") || !strings.Contains(entry.Name(), "mcp") {
			continue
		}
		dir := filepath.Join(parent, entry.Name())
		readmePath := filepath.Join(dir, "README.md")
		goModPath := filepath.Join(dir, "go.mod")
		readme, readErr := os.ReadFile(readmePath)
		description, tools := summarizeReadme(string(readme))
		_, goModErr := os.Stat(goModPath)
		servers = append(servers, LocalMCPServer{
			ID:          entry.Name(),
			Name:        titleFromID(entry.Name()),
			Path:        dir,
			Description: description,
			Tools:       tools,
			HasReadme:   readErr == nil,
			HasGoMod:    goModErr == nil,
		})
	}
	sort.Slice(servers, func(i, j int) bool { return servers[i].ID < servers[j].ID })
	return servers
}

func maskKeys(keys nullbot.APIKeys) MaskedAPIKeys {
	return MaskedAPIKeys{
		OpenAI:     nullbot.MaskSecret(keys.OpenAI),
		Anthropic:  nullbot.MaskSecret(keys.Anthropic),
		OpenRouter: nullbot.MaskSecret(keys.OpenRouter),
		Google:     nullbot.MaskSecret(keys.Google),
		Other:      maskOtherKeys(keys.Other),
	}
}

func maskOtherKeys(keys map[string]string) map[string]string {
	if len(keys) == 0 {
		return nil
	}
	out := make(map[string]string, len(keys))
	for provider, key := range keys {
		out[provider] = nullbot.MaskSecret(key)
	}
	return out
}

func (a *App) accountState() AccountState {
	config := a.bot.Config()
	keys := a.bot.APIKeys()
	authPath := nullbot.CodexAuthPath(config)
	codexStatus := "not signed in"
	codexDetail := "No NullBot Codex subscription login is saved yet. Sign in with ChatGPT to use subscription-backed Codex/OpenAI models without an API key."
	if nullbot.CodexAuthPresent(config) {
		codexStatus = "signed in"
		codexDetail = "NullBot can use your ChatGPT/Codex subscription directly. No Codex CLI install is required."
	}
	accounts := []AccountInfo{
		{
			ID:       "codex",
			Label:    "Codex subscription",
			Kind:     "browser login",
			Status:   codexStatus,
			Detail:   codexDetail,
			CanLogin: true,
		},
		apiAccount("openai", "OpenAI API", "OPENAI_API_KEY", keys.OpenAI, "Fallback API key for OpenAI billing. When Codex subscription auth is signed in, OpenAI/Codex model selections prefer subscription auth first."),
		apiAccount("anthropic", "Anthropic API", "ANTHROPIC_API_KEY", keys.Anthropic, "Use an Anthropic Console API key."),
		apiAccount("openrouter", "OpenRouter API", "OPENROUTER_API_KEY", keys.OpenRouter, "Use an OpenRouter API key for OpenAI-compatible routing, including Gemini-through-OpenRouter models."),
		apiAccount("google", "Google Gemini API", "GOOGLE_API_KEY / GEMINI_API_KEY", keys.Google, "Stored for MCP servers and future direct Gemini support. Current chat runtime can use Gemini through OpenRouter."),
		apiAccount("brave", "Brave Search API", "BRAVE_API_KEY", keys.ForProvider("brave"), "Powers nullbot-web-mcp web_search when Brave Search is selected or auto-detected. Stored as a named MCP/search provider key."),
	}
	for provider, key := range keys.Other {
		name := provider
		if name != "" {
			name = strings.ToUpper(name[:1]) + name[1:]
		}
		accounts = append(accounts, apiAccount(provider, name+" API", strings.ToUpper(provider)+"_API_KEY", key, "Stored as a named provider key. Direct model runtime support depends on provider integration."))
	}
	return AccountState{
		Accounts:      accounts,
		KeysPath:      nullbot.KeysPath(config),
		CodexAuthPath: authPath,
	}
}

func apiAccount(id, label, envName, key, detail string) AccountInfo {
	status := "not set"
	masked := nullbot.MaskSecret(key)
	if strings.TrimSpace(key) != "" {
		status = "saved"
	} else if envValueFor(envName) != "" {
		status = "environment"
		masked = "env:" + strings.Fields(envName)[0]
	}
	return AccountInfo{
		ID:         id,
		Label:      label,
		Kind:       "api key",
		Status:     status,
		Masked:     masked,
		Detail:     detail,
		CanSaveKey: true,
	}
}

func envValueFor(names string) string {
	for _, name := range strings.FieldsFunc(names, func(r rune) bool {
		return r == '/' || r == ',' || r == ' '
	}) {
		name = strings.TrimSpace(name)
		if name == "" {
			continue
		}
		if value := os.Getenv(name); value != "" {
			return value
		}
	}
	return ""
}

func parseCSVRows(content string) ([]string, [][]string) {
	return parseRowsWith(content, ',')
}

func parseRowsWith(content string, separator rune) ([]string, [][]string) {
	reader := csv.NewReader(strings.NewReader(content))
	reader.Comma = separator
	reader.LazyQuotes = true
	reader.FieldsPerRecord = -1
	var rows [][]string
	for len(rows) < 200 {
		row, err := reader.Read()
		if err != nil {
			break
		}
		rows = append(rows, row)
	}
	if len(rows) == 0 {
		return nil, nil
	}
	return rows[0], rows[1:]
}

func parseXLSXPreview(path string) ([]string, [][]string, error) {
	zr, err := zip.OpenReader(path)
	if err != nil {
		return nil, nil, err
	}
	defer zr.Close()
	shared := readSharedStrings(zr.File)
	sheetName := firstWorksheet(zr.File)
	if sheetName == "" {
		return nil, nil, fmt.Errorf("no worksheet found")
	}
	file := zipFileByName(zr.File, sheetName)
	if file == nil {
		return nil, nil, fmt.Errorf("worksheet not found")
	}
	rc, err := openZipEntry(file)
	if err != nil {
		return nil, nil, err
	}
	defer rc.Close()
	rows := decodeWorksheetRows(rc, shared, 201)
	if len(rows) == 0 {
		return nil, nil, nil
	}
	return rows[0], rows[1:], nil
}

func readSharedStrings(files []*zip.File) []string {
	file := zipFileByName(files, "xl/sharedStrings.xml")
	if file == nil {
		return nil
	}
	rc, err := openZipEntry(file)
	if err != nil {
		return nil
	}
	defer rc.Close()
	decoder := xml.NewDecoder(rc)
	var out []string
	var inSI bool
	var inT bool
	var b strings.Builder
	for {
		tok, err := decoder.Token()
		if err != nil {
			break
		}
		switch t := tok.(type) {
		case xml.StartElement:
			switch t.Name.Local {
			case "si":
				inSI = true
				b.Reset()
			case "t":
				if inSI {
					inT = true
				}
			}
		case xml.EndElement:
			switch t.Name.Local {
			case "si":
				inSI = false
				out = append(out, truncateRunes(b.String(), 2000))
				if len(out) >= 200_000 {
					return out
				}
			case "t":
				inT = false
			}
		case xml.CharData:
			if inSI && inT {
				b.Write([]byte(t))
			}
		}
	}
	return out
}

func firstWorksheet(files []*zip.File) string {
	for _, file := range files {
		if strings.HasPrefix(file.Name, "xl/worksheets/sheet") && strings.HasSuffix(file.Name, ".xml") {
			return file.Name
		}
	}
	return ""
}

func decodeWorksheetRows(reader io.Reader, shared []string, limit int) [][]string {
	decoder := xml.NewDecoder(reader)
	var rows [][]string
	var current []string
	var inRow bool
	var inV bool
	var cellRef string
	var cellType string
	var cellText strings.Builder
	for {
		tok, err := decoder.Token()
		if err != nil {
			break
		}
		switch t := tok.(type) {
		case xml.StartElement:
			switch t.Name.Local {
			case "row":
				inRow = true
				current = nil
			case "c":
				cellRef = attrValue(t.Attr, "r")
				cellType = attrValue(t.Attr, "t")
				cellText.Reset()
			case "v", "t":
				if inRow {
					inV = true
				}
			}
		case xml.EndElement:
			switch t.Name.Local {
			case "c":
				col := cellColumnIndex(cellRef)
				if col >= 200 {
					// Far-right columns aren't shown; don't allocate up to them.
					continue
				}
				for len(current) <= col {
					current = append(current, "")
				}
				value := strings.TrimSpace(cellText.String())
				if cellType == "s" {
					if idx, err := strconv.Atoi(value); err == nil && idx >= 0 && idx < len(shared) {
						value = shared[idx]
					}
				}
				current[col] = truncateRunes(value, 2000)
			case "v", "t":
				inV = false
			case "row":
				inRow = false
				rows = append(rows, current)
				if len(rows) >= limit {
					return rows
				}
			}
		case xml.CharData:
			if inV {
				cellText.Write([]byte(t))
			}
		}
	}
	return rows
}

func extractDocxText(path string) (string, error) {
	zr, err := zip.OpenReader(path)
	if err != nil {
		return "", err
	}
	defer zr.Close()
	file := zipFileByName(zr.File, "word/document.xml")
	if file == nil {
		return "", fmt.Errorf("word/document.xml not found")
	}
	rc, err := openZipEntry(file)
	if err != nil {
		return "", err
	}
	defer rc.Close()
	decoder := xml.NewDecoder(rc)
	var b strings.Builder
	var inText bool
	for {
		tok, err := decoder.Token()
		if err != nil {
			break
		}
		switch t := tok.(type) {
		case xml.StartElement:
			switch t.Name.Local {
			case "t":
				inText = true
			case "tab":
				b.WriteByte('\t')
			case "br":
				b.WriteByte('\n')
			}
		case xml.EndElement:
			switch t.Name.Local {
			case "t":
				inText = false
			case "p":
				b.WriteString("\n\n")
			}
		case xml.CharData:
			if inText {
				b.Write([]byte(t))
			}
		}
		if b.Len() > maxExtractedText {
			break
		}
	}
	return strings.TrimSpace(b.String()), nil
}

func zipFileByName(files []*zip.File, name string) *zip.File {
	for _, file := range files {
		if file.Name == name {
			return file
		}
	}
	return nil
}

func readSessionFile(path string, limit int) ([]nullbot.Message, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	var messages []nullbot.Message
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 0, 64*1024), 4*1024*1024)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var record persistedMessage
		if err := json.Unmarshal([]byte(line), &record); err == nil {
			messages = append(messages, record.Message)
		}
	}
	if limit > 0 && len(messages) > limit {
		messages = messages[len(messages)-limit:]
	}
	return messages, scanner.Err()
}

func (a *App) sessionPath(sessionID string) (string, error) {
	sessionID = strings.TrimSuffix(filepath.Base(strings.TrimSpace(sessionID)), ".jsonl")
	if sessionID == "" {
		return "", fmt.Errorf("session id is required")
	}
	root := filepath.Join(a.bot.Config().AppDir, "history")
	path := filepath.Join(root, sessionID+".jsonl")
	cleanRoot, _ := filepath.Abs(root)
	cleanPath, _ := filepath.Abs(path)
	if cleanPath != cleanRoot && !strings.HasPrefix(cleanPath, cleanRoot+string(os.PathSeparator)) {
		return "", fmt.Errorf("session path escapes history directory")
	}
	return cleanPath, nil
}

func buildUsageReport(records []nullbot.UsageRecord, filter UsageFilter) UsageReport {
	filtered := filterUsage(records, filter)
	bucketKind := strings.ToLower(strings.TrimSpace(filter.Bucket))
	if bucketKind == "" {
		bucketKind = "day"
	}
	bucketsByKey := map[string]*UsageBucket{}
	var totals nullbot.UsageTotals
	for _, record := range filtered {
		addTotals(&totals, record)
		key := usageBucketKey(record.Time, bucketKind)
		bucket := bucketsByKey[key]
		if bucket == nil {
			bucket = &UsageBucket{Key: key}
			bucketsByKey[key] = bucket
		}
		addTotals(&bucket.Totals, record)
	}
	buckets := make([]UsageBucket, 0, len(bucketsByKey))
	for _, bucket := range bucketsByKey {
		buckets = append(buckets, *bucket)
	}
	sort.Slice(buckets, func(i, j int) bool { return buckets[i].Key < buckets[j].Key })
	report := UsageReport{Records: filtered, Totals: totals, Buckets: buckets}
	report.Markdown = usageMarkdown(report, filter)
	return report
}

func filterUsage(records []nullbot.UsageRecord, filter UsageFilter) []nullbot.UsageRecord {
	start := parseDate(filter.Start, false)
	end := parseDate(filter.End, true)
	var out []nullbot.UsageRecord
	for _, record := range records {
		if !start.IsZero() && record.Time.Before(start) {
			continue
		}
		if !end.IsZero() && record.Time.After(end) {
			continue
		}
		if filter.Provider != "" && !strings.EqualFold(record.Provider, filter.Provider) {
			continue
		}
		if filter.Model != "" && !strings.Contains(strings.ToLower(record.Model), strings.ToLower(filter.Model)) {
			continue
		}
		if filter.Agent != "" && !strings.Contains(strings.ToLower(record.Agent), strings.ToLower(filter.Agent)) {
			continue
		}
		out = append(out, record)
	}
	return out
}

func parseDate(value string, endOfDay bool) time.Time {
	value = strings.TrimSpace(value)
	if value == "" {
		return time.Time{}
	}
	if t, err := time.Parse(time.RFC3339, value); err == nil {
		return t
	}
	// A bare date is a day on this computer's calendar, matching the
	// local-time buckets the report groups by.
	if t, err := time.ParseInLocation("2006-01-02", value, time.Local); err == nil {
		if endOfDay {
			return t.AddDate(0, 0, 1).Add(-time.Nanosecond)
		}
		return t
	}
	return time.Time{}
}

func usageBucketKey(t time.Time, bucket string) string {
	t = t.Local()
	switch bucket {
	case "hour", "hourly":
		return t.Format("2006-01-02 15:00")
	case "week", "weekly":
		year, week := t.ISOWeek()
		return fmt.Sprintf("%04d-W%02d", year, week)
	case "month", "monthly":
		return t.Format("2006-01")
	default:
		return t.Format("2006-01-02")
	}
}

func addTotals(total *nullbot.UsageTotals, record nullbot.UsageRecord) {
	total.Requests++
	total.InputTokens += record.InputTokens
	total.OutputTokens += record.OutputTokens
	total.TotalTokens += record.TotalTokens
	total.CachedInputTokens += record.CachedInputTokens
	total.CacheCreationInputTokens += record.CacheCreationInputTokens
	total.ReasoningOutputTokens += record.ReasoningOutputTokens
	total.CostUSD += record.CostUSD
	if record.Estimated {
		total.Estimated++
	}
}

func usageMarkdown(report UsageReport, filter UsageFilter) string {
	var b strings.Builder
	b.WriteString("# NullBot Usage Report\n\n")
	fmt.Fprintf(&b, "- Records: %d\n", len(report.Records))
	fmt.Fprintf(&b, "- Requests: %d\n", report.Totals.Requests)
	fmt.Fprintf(&b, "- Tokens: %d total (%d input, %d output)\n", report.Totals.TotalTokens, report.Totals.InputTokens, report.Totals.OutputTokens)
	fmt.Fprintf(&b, "- Estimated cost: $%.6f\n", report.Totals.CostUSD)
	if filter.Start != "" || filter.End != "" {
		fmt.Fprintf(&b, "- Date range: %s to %s\n", firstNonEmpty(filter.Start, "beginning"), firstNonEmpty(filter.End, "now"))
	}
	b.WriteString("\n## Buckets\n\n")
	b.WriteString("| Bucket | Requests | Tokens | Cost |\n")
	b.WriteString("| --- | ---: | ---: | ---: |\n")
	for _, bucket := range report.Buckets {
		fmt.Fprintf(&b, "| %s | %d | %d | $%.6f |\n", bucket.Key, bucket.Totals.Requests, bucket.Totals.TotalTokens, bucket.Totals.CostUSD)
	}
	return strings.TrimSpace(b.String())
}

func skillMeta(content, fallback string) (string, string) {
	name := fallback
	desc := ""
	lines := strings.Split(content, "\n")
	inFrontMatter := len(lines) > 0 && strings.TrimSpace(lines[0]) == "---"
	if inFrontMatter {
		for _, line := range lines[1:] {
			line = strings.TrimSpace(line)
			if line == "---" {
				break
			}
			if key, value, ok := strings.Cut(line, ":"); ok {
				switch strings.TrimSpace(key) {
				case "name":
					name = strings.Trim(strings.TrimSpace(value), `"'`)
				case "description":
					desc = strings.Trim(strings.TrimSpace(value), `"'`)
				}
			}
		}
	}
	if desc == "" {
		for _, line := range lines {
			line = strings.TrimSpace(line)
			if strings.HasPrefix(line, "#") {
				desc = strings.TrimSpace(strings.TrimLeft(line, "#"))
				break
			}
		}
	}
	return firstNonEmpty(name, fallback), desc
}

func summarizeReadme(content string) (string, []string) {
	if strings.TrimSpace(content) == "" {
		return "Local MCP server directory.", nil
	}
	var description string
	var tools []string
	for _, line := range strings.Split(content, "\n") {
		trimmed := strings.TrimSpace(line)
		if description == "" && strings.HasPrefix(trimmed, "`") {
			description = strings.Trim(trimmed, "`")
		}
		if description == "" && trimmed != "" && !strings.HasPrefix(trimmed, "#") && !strings.HasPrefix(trimmed, "|") && !strings.HasPrefix(trimmed, "![") {
			description = trimmed
		}
		if strings.HasPrefix(trimmed, "| `") {
			parts := strings.Split(trimmed, "|")
			if len(parts) > 2 {
				tools = append(tools, strings.Trim(parts[1], " `"))
			}
		}
	}
	if description == "" {
		description = "Local MCP server directory."
	}
	if len(tools) > 12 {
		tools = tools[:12]
	}
	return truncateRunes(description, 180), tools
}

func titleFromID(id string) string {
	id = strings.TrimPrefix(id, "nullbot-")
	id = strings.TrimSuffix(id, "-mcp")
	parts := strings.Fields(strings.ReplaceAll(id, "-", " "))
	for i, part := range parts {
		if part == "" {
			continue
		}
		parts[i] = strings.ToUpper(part[:1]) + part[1:]
	}
	return "NullBot " + strings.Join(parts, " ") + " MCP"
}

func slugName(value string) string {
	var b strings.Builder
	lastDash := false
	for _, r := range strings.ToLower(strings.TrimSpace(value)) {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			b.WriteRune(r)
			lastDash = false
		case r == '-' || r == '_' || r == ' ' || r == '.' || r == '/':
			if !lastDash && b.Len() > 0 {
				b.WriteByte('-')
				lastDash = true
			}
		}
	}
	return strings.Trim(b.String(), "-")
}

func attrValue(attrs []xml.Attr, name string) string {
	for _, attr := range attrs {
		if attr.Name.Local == name {
			return attr.Value
		}
	}
	return ""
}

func cellColumnIndex(ref string) int {
	ref = strings.ToUpper(strings.TrimSpace(ref))
	col := 0
	seen := false
	for _, r := range ref {
		if r < 'A' || r > 'Z' {
			break
		}
		seen = true
		col = col*26 + int(r-'A'+1)
	}
	if !seen || col == 0 {
		return 0
	}
	return col - 1
}

func truncateRunes(text string, limit int) string {
	if limit <= 0 {
		return ""
	}
	runes := []rune(text)
	if len(runes) <= limit {
		return text
	}
	return string(runes[:limit]) + "..."
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func themeCatalog() []ThemePalette {
	return []ThemePalette{
		{ID: "steel", Name: "Classic NullBot", Description: "Black glass, arcade gold borders, and molten title light.", Background: "#050505", Panel: "#10120F", Activity: "#151711", Border: "#D8A900", Accent: "#FFD300", Accent2: "#E08A12", Text: "#F4F0DF", Muted: "#AFA68A"},
		{ID: "ember", Name: "Ember Terminal", Description: "Warm oranges and smoky panels for late-night work.", Background: "#140B08", Panel: "#21120D", Activity: "#28170F", Border: "#B5531E", Accent: "#FFB000", Accent2: "#FF6B35", Text: "#F8E8D8", Muted: "#B99078"},
		{ID: "aurora", Name: "Aurora Glass", Description: "Polar greens, cyan glass, and violet-blue shadows.", Background: "#071014", Panel: "#0D1F25", Activity: "#102830", Border: "#52E0C4", Accent: "#B6F44A", Accent2: "#52E0C4", Text: "#E7FFF9", Muted: "#8BB8B1"},
		{ID: "cyberlime", Name: "Cyber Lime", Description: "High-voltage lime with sharp console contrast.", Background: "#050805", Panel: "#0B120B", Activity: "#10180C", Border: "#39FF14", Accent: "#F8FF00", Accent2: "#39FF14", Text: "#E9FFE8", Muted: "#82A67D"},
		{ID: "rose", Name: "Rose Circuit", Description: "Wine shadows, rose highlights, and mint accents.", Background: "#130A10", Panel: "#21121C", Activity: "#251722", Border: "#FF7AA2", Accent: "#FFB3C7", Accent2: "#8EF0D0", Text: "#FFF0F5", Muted: "#B98FA0"},
		{ID: "deepsea", Name: "Deep Sea", Description: "Blue-black ocean panels with cyan instrument light.", Background: "#06111F", Panel: "#0B1D33", Activity: "#0E2740", Border: "#2FA7FF", Accent: "#7FDBFF", Accent2: "#3FE6D0", Text: "#E8F6FF", Muted: "#88AFC9"},
		{ID: "mono", Name: "Mono Paper", Description: "Low-distraction grayscale with restrained contrast.", Background: "#0E0E0E", Panel: "#171717", Activity: "#1D1D1D", Border: "#B8B8B8", Accent: "#FFFFFF", Accent2: "#CFCFCF", Text: "#F2F2F2", Muted: "#9A9A9A"},
		{ID: "retro", Name: "Retro Amber", Description: "Amber CRT glow and old hardware energy.", Background: "#100B00", Panel: "#1B1200", Activity: "#211800", Border: "#FFB000", Accent: "#FFD166", Accent2: "#FFB000", Text: "#FFECC2", Muted: "#B59252"},
		{ID: "matrix", Name: "Matrix Rain", Description: "Green-on-black with phosphor highlights.", Background: "#020604", Panel: "#07100A", Activity: "#09160D", Border: "#00D26A", Accent: "#7CFF6B", Accent2: "#00D26A", Text: "#D8FFE1", Muted: "#6AA878"},
		{ID: "midnight", Name: "Midnight Violet", Description: "Indigo panels, violet edge light, and moonlit cyan.", Background: "#090B1A", Panel: "#11152B", Activity: "#171A35", Border: "#7C83FF", Accent: "#D67CFF", Accent2: "#82D8FF", Text: "#EEF0FF", Muted: "#9EA4C8"},
		{ID: "sunset", Name: "Sunset Synth", Description: "Coral, magenta, and warm gold.", Background: "#160814", Panel: "#24101F", Activity: "#2B1322", Border: "#FF5C8A", Accent: "#FFBE5C", Accent2: "#FF5C8A", Text: "#FFF0F7", Muted: "#C18A9F"},
		{ID: "forest", Name: "Forest Console", Description: "Moss greens and soft leaf highlights.", Background: "#071008", Panel: "#101A10", Activity: "#142113", Border: "#6DBF67", Accent: "#C7D36F", Accent2: "#6DBF67", Text: "#EEF7E8", Muted: "#9CAF8F"},
		{ID: "ice", Name: "Icebreaker", Description: "Cool whites and arctic blues with high clarity.", Background: "#07131A", Panel: "#0D202B", Activity: "#122B38", Border: "#9BE7FF", Accent: "#E4F8FF", Accent2: "#9BE7FF", Text: "#F2FCFF", Muted: "#A7C7D3"},
		{ID: "coffee", Name: "Coffeehouse", Description: "Espresso panels, cream text, and caramel highlights.", Background: "#120D09", Panel: "#201710", Activity: "#251B13", Border: "#C58B4C", Accent: "#E7C27D", Accent2: "#C58B4C", Text: "#F8EBD8", Muted: "#B49B7F"},
		{ID: "bubblegum", Name: "Bubblegum Lab", Description: "Playful pink, cyan, and candy yellow.", Background: "#120A18", Panel: "#21122A", Activity: "#281631", Border: "#FF8BD1", Accent: "#FFCA3A", Accent2: "#7DEBFF", Text: "#FFF2FB", Muted: "#C79BC8"},
		{ID: "terminal", Name: "Terminal Blue", Description: "IBM-ish blues and business-machine confidence.", Background: "#071126", Panel: "#0C1B3A", Activity: "#10234A", Border: "#4F8CFF", Accent: "#8FD3FF", Accent2: "#4F8CFF", Text: "#EDF4FF", Muted: "#A3B8D8"},
		{ID: "crimson", Name: "Crimson Ops", Description: "Controlled red-alert incident-response drama.", Background: "#120506", Panel: "#210B0E", Activity: "#2A0D11", Border: "#FF4D5E", Accent: "#FFB74D", Accent2: "#FF4D5E", Text: "#FFEDEF", Muted: "#BE8C91"},
		{ID: "lavender", Name: "Lavender Fog", Description: "Gentle lavender with dusty blue accents.", Background: "#0E0B18", Panel: "#19152A", Activity: "#201A33", Border: "#B8A7FF", Accent: "#D6C8FF", Accent2: "#8CCFFF", Text: "#F3F0FF", Muted: "#AAA0C8"},
		{ID: "desert", Name: "Desert Radar", Description: "Sand, olive, and dark clay field-computer styling.", Background: "#100E08", Panel: "#1E1A10", Activity: "#252015", Border: "#B7A35A", Accent: "#E8C766", Accent2: "#8EA35A", Text: "#F4EBD0", Muted: "#A89B77"},
		{ID: "neon", Name: "Neon Noir", Description: "Black glass, hot cyan, and magenta edge light.", Background: "#05070B", Panel: "#0A0F16", Activity: "#0E1420", Border: "#00E5FF", Accent: "#FF2EC4", Accent2: "#00E5FF", Text: "#EDFBFF", Muted: "#7D9AA6"},
	}
}
