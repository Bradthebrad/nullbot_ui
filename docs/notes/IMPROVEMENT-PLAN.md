# NullBot UI: Improvement Plan

_Drafted 2026-10-26 from a read-through of `nullbot_ui`, `nullbot/pkg/app`, `tinychain/{mcp,agent,callbacks}` and the seven `nullbot-*-mcp` READMEs. File:line references are to the current working trees._

## Summary

There are four problems you can feel, and each one has a concrete cause:

| Symptom | Main cause |
| --- | --- |
| **Memory keeps growing and the app feels sluggish** | Every retained submission job holds a **full copy of the chat history** (up to 64 jobs), and the UI pulls all of them **every 1.5 s, forever**. `State()` makes **live HTTP calls** for model catalogs and ships the **entire usage log** on almost every action. Every streamed token re-renders the **whole React tree** and re-parses the markdown of **every message**. |
| **Clicking a link in a bot reply opens inside the app** | Markdown links have no handler, so WebView2 navigates the app's own frame away. The SPA unloads and the Go bindings go with it. |
| **Live Activity is raw JSON and doesn't say what it's doing** | The backend **truncates tool args to 180 chars of a JSON string**, which breaks `JSON.parse`, so the UI falls back to the raw text. Friendly labels exist only for 8 file tools from `nullbot-code-mcp`. None of the web/email/drive/message/parser/image tools have one. |
| **It looks bubbly and janky** | Every surface has a tinted accent border, a radius and a background tint (boxes inside boxes). There are gradients and glows, an Impact headline, a rainbow-animated skill token, 16 sidebar destinations and 13 buttons under the composer. |

One more problem is easy to miss and matters a lot for org users: **MCP tools are silently disabled unless every project is set to Full access.** The default project is read-only (`projects.go:24`, `runtime.go:576`), so a new user can enable a server and the bot never sees its tools, with nothing in chat explaining why.

The plan has five phases. **Phase 0** fixes memory, links and responsiveness in small, low-risk PRs. **Phase 1** makes Live Activity readable. **Phase 2** pools MCP sessions so servers really load and unload on the fly. **Phase 3** is the visual redesign. **Phase 4** splits App.tsx and adds tests, in parallel with Phase 3.

---

## 1. Findings

### 1.1 Memory growth and sluggishness

**Backend (`nullbot/pkg/app`, `nullbot_ui/app.go`)**

| # | Where | What happens | Fix |
| --- | --- | --- | --- |
| B1 | `submissions.go:195`, `app.go:261-265` | `job.Reply` is a full `Reply`: **entire `History`** + `Config` + activity slice. Up to 64 completed jobs are retained (`pruneSubmissionsLocked`, `:400`), so memory is O(64 × history length) and grows quadratically with a long conversation. | Store only `{message, status, error, ids, open_panel}` on the job. History has exactly one owner, `a.history`. |
| B2 | `submissions.go:275-287, 383-399` | `SubmissionState()` JSON-marshals then unmarshals (`cloneSubmission`) every retained reply on every call. | Slim jobs make the clone trivial. Return only active + queued + the last ~10 finished. |
| B3 | UI `App.tsx:387`, `:389` | `ChatView` polls `ChatSubmissionState` **every 1.5 s even when idle or hidden**, plus once per `reply` event. With B1 that can be megabytes per poll through two JSON encoders and the WebView parser. | Push a `submissions:changed` event from Go and delete the poll. |
| B4 | `tasks.go:215-245`, `runtime.go:386-406` | `a.tasks` is **never pruned**. Every callback, **including every streamed token**, is appended to `task.Activity` (cap 120) and overwrites `task.Current` with `response delta: <token>`. | Keep running tasks + the last 50 finished, and drop `Activity` from finished tasks. Don't record token or reasoning deltas into tasks. |
| B5 | `app.go:259`, `submissions.go:84` | `a.logs` and `requestReceipts` grow forever. | Ring buffer of 200 for logs. Prune receipts alongside their jobs. |
| B6 | `app.go:333-347` | The 400-record activity ring is filled mostly by **token deltas**, so tool events are evicted during one long answer. Subscribers also receive every token. | Route token and reasoning deltas to a separate stream channel that is never stored in the ring. |
| B7 | UI `app.go:282-287` | Each token is emitted **twice** (`activity` + `agent:stream`). Nothing in the frontend listens to `agent:stream`. | Remove the duplicate emit. |
| B8 | UI `app.go:295-319`, `models.go:135-168`, `usage.go:234-275` | `State()` makes **up to three sequential HTTP calls** (Codex, OpenAI and OpenRouter model lists, 12 s timeout each). It also reads the **whole `usage.jsonl`** and returns *all* records, scans the local MCP folders and lists the workspace. The frontend calls it after nearly every action, and every settings mutation returns it. | Split into `Bootstrap()` (cheap and in-memory), `ModelCatalog(refresh bool)` (cached with a 10-minute TTL) and `UsageSummary(range)` (aggregates only). |
| B9 | `runtime.go:204, 294, 573-610` | **Every turn, every subagent and every Also job spawns a fresh process for every enabled MCP server**, runs initialize + `tools/list` (5 s timeout each, one after another), then kills it. That slows the first token and churns processes constantly. | Long-lived MCP session pool (Phase 2). |
| B10 | `tinychain/mcp/client.go:232-241` | `Process.Kill()` on Windows kills only the direct child. Servers launched through `python`, `cmd /c`, `go run` or `npx` can leave orphaned grandchildren that hold RAM. | Put each server in a Windows **Job Object** with kill-on-close. |
| B11 | UI `app.go:770-790` | Image and PDF previews up to 14 MB are base64-encoded into JSON over IPC and held in React state. | Serve local files through a Wails `AssetServer.Handler` (`/local/<token>`) so the WebView streams them. |
| B12 | UI `main.go` | No `OnShutdown`: the scheduler and MCP children aren't cleaned up on exit. | Add `OnShutdown` → stop the scheduler, close the MCP pool. Add `SingleInstanceLock`. |

**Frontend (`nullbot_ui/frontend/src/App.tsx`)**

| # | Where | What happens | Fix |
| --- | --- | --- | --- |
| F1 | `:184-187` | Every token runs `setState` at the **App root**, so all 16 views' props change and the tree re-renders. `MessageList` re-runs `ReactMarkdown` for **every message** in the transcript on each token. | Use an external store with selectors and **coalesce tokens per animation frame**. Wrap message rows in `React.memo` keyed by id + content hash, so only the streaming row re-renders. |
| F2 | `:3167-3184` | `mergeActivityRecords` runs `JSON.stringify` on **every stored record** into a fresh `Set` for each incoming event (O(n²) over a run). Its comment says _"Reasoning has its own unbounded live buffer"_: reasoning deltas are never trimmed. | Dedupe by a stable id (`submission:run:seq`) and bound everything. Reasoning becomes one aggregated string per round, not a record per delta. |
| F3 | `:824`, `:2685-2735` | `buildActivityTimeline` re-derives the whole timeline (with another `JSON.stringify` per record) on every render. | Build the timeline incrementally in the store, where a step is upserted by `call_id`. |
| F4 | `:883`, `:2017`, `:2149` | More fixed pollers: Agents (Tasks + Thoughts, 1.5 s), Plan (1.8 s), Tasks (1.5 s). | Replace them with push events. If any poll survives, pause it when the view is hidden or the app is idle. |
| F5 | `:3204-3238` | `ingestChatStream` scans and copies the whole messages array per token. | Mutate the single streaming buffer in the store. Commit to the transcript once, at the end. |
| F6 | `:788` | The disclosure-state `Map` grows forever. | Bound it, or key it on durable message ids and drop entries when messages are cleared. |

### 1.2 Links open inside the app window

- `MarkdownContent` (`App.tsx:2488`) overrides `pre` and `code` but not `a`. In Wails/WebView2 a plain `<a href>` navigates the **main frame**, which unloads the React app and its bindings. To the user it looks like the frontend got disconnected from the backend.
- The web MCP's `browser_*`, `fetch_url` and `web_search` tools put a lot of URLs into replies, so this comes up constantly.
- There's no handling for `window.open`, `target=_blank`, `mailto:`, or local file paths the bot mentions.

**Fix:**
- Add a capture-phase `click`/`auxclick` listener on `document` and a custom `a` renderer.
- `http(s)` and `mailto:` links go to `BrowserOpenURL`, and middle-click does the same.
- Local paths go to a new `OpenPath` binding, checked against project grants, or open in the in-app Files preview.
- Anything else is blocked with a toast.
- Shim `window.open` the same way.
- Show the URL host on hover, and mark external links with a small ↗.

### 1.3 Live Activity doesn't explain anything

What you see today comes from:

1. **Arg truncation.** `tasks.go:406` sets `detail = "args: " + compactAny(input, 180)`, and `compactAny` cuts the *serialized JSON* at 180 chars. Any realistic args (a search query plus options, an email filter, a URL with params) become invalid JSON. `activityArgs()` (`App.tsx:2864`) catches the parse error and returns `{}`, so the card falls back to dumping the raw string.
2. **Results flattened to text.** `result: <first 2000 chars>` carries no item count, no type and no preview.
3. **Labels exist for only 8 tools** (`App.tsx:2828-2862`): `read_file`, `list_dir` and the rest from `nullbot-code-mcp`. The tools people actually use get `"Running Web Search"` / `"Tool running"`. That covers `web_search`, `fetch_url`, `browser_*`, `email_list/get/send`, `drives_search/read`, `message_list/send`, `parse_file`, `extract_tables`, `generate_image_*` and more.
4. **No server attribution.** You can't tell which MCP server a tool came from, or whether it's read-only or can send and delete.
5. **Noise cards.** "Submission Running", "Submission Done", "Work Complete", per-delta reasoning cards and "messages=14" chips.
6. **The MCP tool model is behind the spec.** `tinychain/mcp.Tool` lacks the 2025-06-18 fields `title`, `annotations` (`readOnlyHint`, `destructiveHint`, `openWorldHint`), `outputSchema`, and `structuredContent` on results. Image results are dropped (`ResultText` keeps text only).

The good news is that tool start and end already carry the provider's call ID (`agent.go:203-242`, `RunID: call.ID`), so each step can be keyed by it.

### 1.4 Visual design and information architecture

What reads as bubbly or janky:

- **Boxes in boxes.** Messages, activity cards, pills, stat tiles, panels and inputs all get an accent-tinted border, a radius and a tinted background (`App.css` has 41 rules with `border-radius: 8px`, and many `color-mix(... var(--border) ...)` borders).
- **Decoration:** gradient primary buttons, radial background glows, an uppercase Impact title with text-shadow glow (`App.css:180-190`), and a rainbow-animated sparkle on matched skill words (`skill-composer.css:4-5`).
- **Themes:** 20 neon palettes where *border = accent*, so gold or cyan outlines are everywhere.
- **Too many destinations:** 16 sidebar items, several of which are one form (Bot Name, Themes, Prompts).
- **Composer overload:** Undo, Redo, Also, Also answers, Focus input, Analyze, Plan, Compact, Pause, Resume, Save, Clear Chat and Send are always visible, even when nothing is running.
- **Native dialogs:** `window.prompt` and `window.confirm` (11 call sites) feel like a web page, not an app.
- **Type:** the CSS asks for Inter, but only Nunito is bundled (and it's unused), so Windows falls back to Segoe UI with mixed Impact, Georgia and Cascadia accents.

### 1.5 MCP and skills (the primary interface for most people)

- The full-access gate is silent. This is the biggest *"it doesn't work"* trap (see the Summary).
- There's no live server state. The MCP view shows config (command, args, enabled) but not whether a server is running, healthy, how many tools it exposes or when it was last used. "Load/unload on the fly" has no visible feedback.
- `DiscoverMCPTools` spawns another fresh process with an 8 s timeout on every click (`app.go:1153-1201`).
- Tool schemas render as raw JSON, not a parameter table.
- Skills are a list + textarea. The composer's skill matching shows as a rainbow glow rather than an explicit `/` picker.

### 1.6 Code health

- `App.tsx` is 3,320 lines with `any` everywhere. Two bindings are called through `(window as any).go...` even though typed ones exist (`App.tsx:16-17`).
- Tests read `App.tsx` as text, extract functions with the TS AST and run them in `vm` (`tests/live-activity.test.mjs:7-19`). They'll break the moment the file is split.
- Contracts are implicit. `UI_API_REQUESTS.md` already asks for an `ACTIVITY_API.md` with canonical fields and correlation IDs, and nothing defines it yet.

---

## 2. Target design

### 2.1 Principles

1. **Quiet chrome, loud content.** Neutral surfaces, hairline neutral borders and one accent used only for focus, primary action and "running".
2. **Nothing moves unless something is happening.** No idle animation. 120–160 ms ease-out on popovers and disclosures only. Respect `prefers-reduced-motion`.
3. **Every pixel of status is a sentence.** "Searching the web for *acme q3 earnings*", not `Running Web Search` + JSON.
4. **Instant input.** The composer and transcript never wait on the backend. Optimistic rows, rAF-batched tokens, and no network calls on navigation.

### 2.2 Layout

```
┌──┬────────────────────────────────────────────────┬─────────────────────────┐
│N │ acme-ops ▾   gpt-5.1 ▾   ● Tools: 6 ready       │ Activity            ⫶ × │
│──├────────────────────────────────────────────────┤ ─ Turn 3 · 4.1s         │
│C │ You                                            │  ✓ Searched the web     │
│A │ Summarize unread finance mail and flag         │    "acme q3 earnings"   │
│F │ anything over $10k                             │    8 results · 1.2s     │
│T │                                                │  ✓ Listed inbox         │
│H │ NullBot                                        │    finance · 23 unread  │
│  │ ▸ Used 3 tools · 4.2s                          │  ● Reading 4 messages…  │
│  │ Here's what came in today: …                   │    web · email · drives │
│  │                                                │                         │
│S ├────────────────────────────────────────────────┤ ─ Turn 2 · 1.8s      ▸  │
│  │ Message NullBot…                               │                         │
│  │ ⊕  /                         Also   ■ Stop/Send │                         │
└──┴────────────────────────────────────────────────┴─────────────────────────┘
 rail: Chat · Activity · Files · Tools · History · Settings
```

- **Rail (48 px, labels on hover)** with 6 destinations instead of 16:
  - **Chat**
  - **Activity**: Agents, Tasks, Plan and Schedules merged
  - **Files**: browser plus project access
  - **Tools**: MCP servers, Marketplace and Skills
  - **History**: Sessions
  - **Settings**: Models & Accounts, Prompts, Appearance (theme + bot name), Usage, Advanced
- **Top bar (40 px):** project and access chip, model picker, tool readiness, and the run state with a Stop button. No giant title.
- **Inspector (right, resizable, collapsible with `Ctrl+.`):** the Live Activity timeline for the current conversation.
- **Command palette (`Ctrl+K`):** navigation plus the actions that leave the composer (Analyze, Plan, Compact, Save session, Clear, Load session, Toggle server…).

### 2.3 Transcript and composer

- The assistant renders as plain document text (max ~72ch, 15 px / 1.6). User turns are a subtle, borderless tinted block. No left accent bars and no role labels in caps.
- Each assistant turn has one collapsed line, **"Used N tools · Xs ▸"**, that expands inline to the step list or jumps to it in the inspector.
- Reasoning summaries become one muted, collapsible "Thinking" line per round.
- The composer is one bordered field:
  - Left: attach and `/` (opens the commands + skills picker, which replaces the rainbow glow).
  - Right: Also, then **Send**, which turns into **Stop** while running. Pause/Resume collapses into Stop; queued items show as a small chip above the composer.
  - Undo/Redo move to keyboard shortcuts only. The busy-send chooser (Queue / Steer / Also) becomes a split-button menu on Send.

### 2.4 Live Activity step model

A **turn** (one submission) contains **steps**. A step is a tool call, a subagent, a reasoning round or an error. Each step renders as:

```
✓  Searched the web for "acme q3 earnings"           1.2s
   web · 8 results · read-only                         ▸
```

When expanded, it shows an **args table** (key → value, with long values clamped and a copy button) and a **result preview** that depends on the result type (link list, table, message list, text excerpt, image thumb). Raw JSON is available only behind "View raw".

**Describer registry** (`activity/describe.ts`). It uses the tool's MCP `title` when the server provides one. It falls back to templates for the servers you ship, then to a generic heuristic:

| Tool (server) | Running | Done |
| --- | --- | --- |
| `web_search` (web) | Searching the web for "{query}" | Found {n} results |
| `fetch_url` (web) | Opening {host}{path…} | Read {bytes} from {host} |
| `browser_navigate` / `browser_read` / `browser_click` (web) | Browsing {host} / Reading page / Clicking "{selector}" | – |
| `email_list` (emails) | Checking {account} inbox{filter} | {n} messages |
| `email_get` / `email_send` (emails) | Reading "{subject}" / Sending to {to} | Sent ✓ (destructive badge) |
| `drives_search` / `drives_read` (drives) | Searching {drive} for "{query}" / Opening {name} | {n} files / {bytes} |
| `message_list` / `message_send` (messages) | Reading {provider} {channel} / Sending to {channel} | {n} messages / Sent ✓ |
| `parse_file` / `extract_tables` / `vision_extract` (parsers) | Parsing {file} / Extracting tables from {file} / Reading {file} with vision | {n} tables / {pages} pages |
| `generate_image_*` / `resize_image` … (imagetools) | Generating image: "{prompt…}" / Resizing {file} | thumbnail |
| `read_file` / `search_text` / `run_command` (code) | Reading {path} / Searching "{query}" in {path} / Running `{cmd…}` | {lines} lines / {n} matches / exit {code} |
| `spawn_subagent` (built-in) | Started subagent "{name}": {task…} | nested group |
| *generic* | {Verb from name prefix} {most salient arg}<sup>†</sup> | first line of result / item count |

<sup>†</sup> The verb comes from the name prefix (`search_` → Searching, `get_`/`read_` → Reading, `list_` → Listing, `send_` → Sending, `create_`/`write_` → Writing, `delete_` → Deleting). The salient arg is the first of `query, q, url, path, file, to, subject, channel, name, id`.

Noise rules: hide submission lifecycle rows. Render "model call started" as the turn's spinner, not a card. Fold reasoning deltas into one line.

### 2.5 Visual tokens (starting point)

```css
/* dark (default) */
--surface-0: #0e0f11;  --surface-1: #15171a;  --surface-2: #1c1f23;  --surface-3: #24282d;
--border:    #2a2e34;  --border-strong: #3a3f46;
--text-1: #e8eaed;     --text-2: #a9afb7;     --text-3: #6f7680;
--accent: #5b8cff;     --accent-weak: color-mix(in oklab, var(--accent) 16%, transparent);
--success: #3fb27f;    --warning: #d9a440;    --danger: #e5534b;
--radius-sm: 4px;      --radius-md: 6px;      --radius-lg: 8px;  /* no 999px pills */
--font-ui: "Inter Variable", "Segoe UI Variable Text", system-ui, sans-serif;  /* bundle Inter */
--font-mono: "JetBrains Mono", "Cascadia Code", ui-monospace, monospace;
--text-xs: 11px; --text-sm: 12px; --text-md: 13px; --text-lg: 15px; --text-xl: 18px;
--row-h: 28px; --control-h: 30px; --gap: 8px;
```

There's a light theme with the same token names. The 20 palettes collapse into **Light / Dark / System plus an accent picker**. Old `config.ui.theme` IDs map to Dark plus the closest accent, so existing users don't break.

---

## 3. Implementation plan

The work spans three repos, so it merges in dependency order, as `UX-BRANCH-HANDOFF.md` already describes: **tinychain → nullbot → nullbot_ui**, validated through the parent `go.work`. Each item below is sized to be one reviewable PR.

### Phase 0: Stop the bleeding (low risk, about 1–2 days)

Goal: flat memory over long sessions, links open in the browser, and streaming feels instant. No visual changes.

| # | Repo | Change | Acceptance |
| --- | --- | --- | --- |
| 0.1 | nullbot_ui | External link routing: a capture-phase document listener, a markdown `a` renderer, a `window.open` shim, and a new Go binding `OpenExternal(url)` with a scheme allowlist (`http`, `https`, `mailto`). Local paths go to `OpenPath(path)` (checked with `checkUIProjectPath`) or the Files preview. | Clicking any link in chat, file preview, skills or history opens the system browser, and the app never navigates. A unit test covers allowed and blocked schemes. |
| 0.2 | nullbot | Slim submission jobs (B1, B2): `job.Reply` keeps only message, status, ids and `open_panel`. `SubmissionState` returns active + queued + last 10. Prune `requestReceipts` with their jobs. Ring-buffer `a.logs` (B5). | Benchmark: 200 turns × 50-msg history and the snapshot size stays constant. Existing submission tests pass. |
| 0.3 | nullbot | Task pruning and delta hygiene (B4, B6): don't store token/reasoning deltas in `task.Activity` or the activity ring. Keep running tasks + last 50 finished. Clear `Activity` on finish. | `len(a.tasks)` and `len(a.activity)` stay bounded in a soak test. Tool events survive a long answer. |
| 0.4 | nullbot_ui | Remove the duplicate `agent:stream` emit (B7). Add `submissions:changed`, `tasks:changed` and `runtime:changed` push events, and delete the 1.5 s pollers in Chat, Agents, Tasks and Plan (B3, F4). | With the app idle, IPC traffic is ~0 (verify with a counter in dev). |
| 0.5 | nullbot_ui + nullbot | Cheap state (B8): `Bootstrap()` replaces `State()` for refreshes. Add `ModelCatalog(refresh)` with a 10-minute cache and `UsageSummary(filter)` with aggregates only. Mutations return the slice they changed, not the full state. | `Bootstrap()` takes under 20 ms with no network. Opening Settings → Models is the only thing that hits the provider APIs. |
| 0.6 | nullbot_ui | Frontend hot path (F1, F2, F5, F6): a small external store (Zustand or `useSyncExternalStore`), tokens coalesced per `requestAnimationFrame`, memoized message rows, id-based activity dedupe with hard caps (including reasoning). | 10k-token stream: the React profiler shows only the streaming row committing, and the store size is bounded. Frame time stays under 16 ms on your machine. |
| 0.7 | nullbot_ui | Make the gate visible: if `!allProjectsFull`, show a persistent banner in Chat and Tools ("External tools are off: project *X* is read-only. Review access →"). | A fresh install with an enabled server shows the banner, not silence. |
| 0.8 | nullbot_ui | `OnShutdown` + `SingleInstanceLock` (B12). | Closing the app leaves no `nullbot-*-mcp` processes behind. |

### Phase 1: Activity that explains itself (about 2–4 days)

| # | Repo | Change |
| --- | --- | --- |
| 1.1 | tinychain | Extend `mcp.Tool` with `Title`, `Annotations{Title, ReadOnlyHint, DestructiveHint, IdempotentHint, OpenWorldHint}` and `OutputSchema`. Extend `ToolResult` with `StructuredContent` and keep non-text `Content` (image, resource) instead of dropping it. Thread server id and tool metadata into `agent.ToolFunc` so callbacks can report them. |
| 1.2 | nullbot | Add a structured tool-call record, documented as `docs/ACTIVITY_API.md` (closes the request in `UI_API_REQUESTS.md`). It keeps the existing `ActivityRecord` fields for the TUI and adds: `call_id`, `server_id`, `tool`, `tool_title`, `args` (an **object**, truncated per field at 1 KB, never as a whole string), `started_at`, `ended_at`, `duration_ms`, `result_preview` (≤ 2 KB), `result_meta{kind, items, bytes, mime}`, `error`, `read_only`, `destructive`, `parent_call_id` (for subagents). |
| 1.3 | nullbot_ui | `activity/` module: the store builds the turns → steps model incrementally, keyed by `call_id`. Add the describer registry (§2.4) with templates for the 7 shipped servers + the generic heuristic, and the step row and expanded detail (args table, typed result preview, "View raw"). |
| 1.4 | nullbot_ui | An inline "Used N tools · Xs ▸" summary per assistant turn, linked to the inspector. |
| 1.5 | each `nullbot-*-mcp` | Add `title` + `annotations` to every tool definition (a one-line change per tool, and it also improves other MCP clients). |

Acceptance: a recorded session using web + email + drives renders with **zero raw JSON** in the default view, every step names its server, and destructive tools show a badge.

### Phase 2: MCP session pool, real "load/unload on the fly" (about 3–5 days)

| # | Repo | Change |
| --- | --- | --- |
| 2.1 | nullbot | `mcpPool`: one long-lived session per enabled server. It starts lazily on first use (or eagerly at launch, configurable), starts servers **in parallel**, caches `tools/list`, health-pings and auto-restarts with backoff, and idles out after 10 min. Manager, subagents and Also borrow from it, and `buildRuntime` no longer spawns processes. Concurrent calls to a stdio server go through a per-server call queue (the transport is already mutex-guarded). |
| 2.2 | nullbot | Hot reconfigure: enable/disable/remove/add apply immediately (start or stop just that server) and replace `MarkRuntimeDirty` for MCP changes. An in-flight call on a disabled server finishes, then the session closes. |
| 2.3 | tinychain | A Windows Job Object (`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`) per stdio server, and a process-group kill on Unix. Add a stderr capture ring (last 100 lines) for diagnostics. |
| 2.4 | nullbot_ui | `mcp:status` push event and a new **Tools** page. Each server row shows status dot, name, tool count, last used, p50 latency, and Restart / Disable / Logs. Expanding a row shows the tools with their titles, read-only/destructive badges and a parameter table generated from the schema. `DiscoverMCPTools` reads from the pool instead of spawning. |

Acceptance: first-token latency on a warm pool doesn't depend on how many servers are enabled. Toggling a server is reflected in under a second without restarting anything else. After 100 turns the process count is stable.

### Phase 3: Visual redesign and information architecture (about 5–8 days)

1. **Tokens + primitives** (`ui/`): Button, IconButton, Input, Textarea, Select, Tabs, Dialog, Menu, Tooltip, Toast, Badge, StatusDot, Disclosure, Table, EmptyState, Kbd. Bundle Inter Variable and remove Nunito and Impact.
2. **Shell:** rail nav (6), slim top bar, resizable inspector, `Ctrl+K` command palette. Keep persistent chat mounting (already done) but stop passing it the world.
3. **Chat:** the new transcript and composer (§2.3), the `/` commands + skills picker, Send/Stop, the queue chip and a split-button for Queue / Steer / Also.
4. **Activity page:** Agents + Tasks + Plan + Schedules on one page with sub-tabs. Plans get a structured step editor; raw JSON moves behind "Edit JSON".
5. **Tools, Files, History, Settings** consolidated per §2.2. Usage gets formatted numbers (1.2M tokens, $3.41) and a real bar chart.
6. Replace all `window.prompt` and `window.confirm` calls with `Dialog`, and status strings with toasts plus the top-bar run state.
7. **Themes:** Light / Dark / System + accent, plus the legacy ID mapping.

Before writing Phase 3 code, a clickable mockup of the shell, chat and activity is worth an afternoon. Review it first so the direction is settled before any CSS gets written.

### Phase 4: Structure and tests (runs alongside Phase 3)

- Split `App.tsx` into `features/{chat,activity,files,tools,history,settings}`, `ui/`, `store/` and `lib/{bindings,events,links}.ts`. Use the generated `wailsjs` models everywhere and enable `noImplicitAny` in `features/`.
- Typed event bus (`lib/events.ts`), the only place `EventsOn` is called.
- Move tests to **Vitest + Testing Library**: port the 54 existing tests to module imports and add:
  - a streaming perf test (10k tokens → bounded store, one row re-rendered)
  - link routing
  - describer coverage for every tool in the 7 READMEs
  - an activity reducer test (out-of-order start/end, parallel same-name calls, errors).
- Go:
  - a soak test (200 synthetic turns with a fake model and a fake MCP server) asserting bounded heap, goroutines, `len(tasks)`, `len(jobs)` and the child process count
  - pool restart and timeout tests
  - `go test -race` in CI, where CGO is available.

---

## 4. Measuring it

Take a baseline **before** Phase 0, so the gains are concrete:

| Metric | How | Target after Phase 0–2 |
| --- | --- | --- |
| Memory over a long session | Private bytes of `nullbot_ui.exe` + its `msedgewebview2.exe` children, sampled every 10 turns over a 100-turn scripted session | Flat (±10%) after warm-up |
| Idle IPC | Dev-only counter on `EventsEmit` + binding calls | ~0 msgs/s when idle |
| Time to first token | Timestamp from Send to first `response delta` | Independent of enabled server count; less than 300 ms of UI overhead |
| Stream smoothness | React profiler / Performance panel during a 2k-token reply | Under 16 ms frames; only the streaming row commits |
| `Bootstrap()` latency | Go timer | Under 20 ms, no network |
| Child processes | `Get-Process nullbot-*` after 100 turns and after exit | Stable during the session; 0 after exit |

---

## 5. Decisions needed

1. **Order.** The recommendation is Phase 0 first: it's the part users feel, it's low risk, and it makes Phases 1–3 easier to build. If the redesign matters most for an upcoming demo, Phase 3 can start in parallel after 0.1 and 0.6.
2. **The full-access gate.** Keep "all projects must be Full for any external tool", or move to **per-server grants** (for example, web search allowed with read-only projects, but code/shell servers need Full)? This is a security and policy call for your org, and it changes the Tools page design.
3. **Visual defaults.** Dark-first or system? Keep a "Classic NullBot" gold accent as a nod to the TUI?
4. **TUI parity.** The structured activity record is additive, so the Bubble Tea TUI keeps working. Should it also adopt the describer sentences?
5. **Branching.** One branch per phase across the three repos (same branch name in each), merged in tinychain → nullbot → nullbot_ui order?
