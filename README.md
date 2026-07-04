# NullBot UI

NullBot UI is a Wails + React desktop shell for the NullBot agent runtime. It keeps the underlying NullBot configuration, model routing, session history, plans, skills, usage tracking, MCP marketplace, and tool integrations, then maps them into a richer graphical workflow.

This repo is intentionally a UI layer. The Go backend imports the sibling `../nullbot` module and the `../tinychain/*` packages through local `replace` directives while the NullBot app internals are still organized under Go `internal` packages.

## What It Includes

- Chat view with live activity, attachments, drag-and-drop file intake, `/also` support, copyable blocks, compaction, pause/resume, analyze, reset/clear, and plan launch controls.
- Agent dashboard with manager/subagent tabs, task cards, tool activity summaries, token usage, reasoning summary surfaces, and background task visibility.
- Files view with directory navigation, search/filtering, path completion, previews for common document/data/text formats, edit support, create/rename/delete actions, and workspace switching.
- Model/settings views for OpenAI, Codex subscription auth, OpenRouter, Anthropic, Google/Gemini, Brave Search, reasoning controls, config fields, prompts, themes, bot naming, and API-key management.
- Sessions/history, usage reporting, skills, MCP tools, marketplace, plans, and tasks panels.

## How This Differs From The TUI

The TUI is terminal-first: keyboard driven, modal oriented, fast to launch, and comfortable over a plain shell or SSH session. It exposes NullBot through slash commands, hotkeys, Bubble Tea views, and terminal-rendered modals.

This UI is desktop-first: persistent sidebar navigation, mouse-friendly controls, pinned tabs, richer previews, visual dashboards, file drag/drop, browse/save dialogs, copy buttons, and form-based settings. Most TUI hotkeys and command modals become visible buttons, tabs, panes, context menus, or editable forms.

The intended runtime behavior is the same where it matters: model selection, manager/subagent routing, MCP servers, skills, sessions, plans, usage, compaction, marketplace installs, and workspace-aware file tooling all come from NullBot and its companion packages. The UI mostly changes how those capabilities are surfaced.

The TUI remains the leanest option for terminal workflows and quick keyboard operation. The Wails UI is better for long-running agent supervision, multi-pane inspection, file previews, model/account management, and visual usage/task review.

## Development

Prerequisites:

- Go with the same version used by the sibling NullBot checkout.
- Node.js and npm.
- Wails CLI.
- Local sibling checkouts for `../nullbot`, `../tinychain/client`, `../tinychain/agent`, and `../tinychain/mcp`.

Install frontend dependencies:

```powershell
cd frontend
npm install
```

Run the app in development mode:

```powershell
wails dev
```

Build frontend assets:

```powershell
cd frontend
npm run build
```

Build the desktop app:

```powershell
wails build
```

## Privacy Notes

No API keys, account tokens, Codex auth files, NullBot config files, session data, or local workspace content should be committed here. Runtime credentials and user data are loaded from the user's NullBot data directory and local environment at run time.
