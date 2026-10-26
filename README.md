# NullBot UI

NullBot UI is a Wails + React desktop shell for the NullBot agent runtime. It keeps the underlying NullBot configuration, model routing, session history, plans, skills, usage tracking, MCP marketplace, and tool integrations, then maps them into a richer graphical workflow.

This repo is intentionally a UI layer. The Go backend imports the public `github.com/Bradthebrad/nullbot/pkg/app` runtime package and the tagged `github.com/Bradthebrad/tinychain` module, so a fresh clone can build without co-located sibling repositories.

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

- Go.
- Node.js and npm.
- Wails CLI.
- Network access for `go mod download` and `npm install`.

Install frontend dependencies:

```powershell
go mod download
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

## Local Service Accounts

The shared Accounts panel in Settings and Models stores configuration locally through the NullBot Windows current-user DPAPI vault. Status is metadata only and always unverified; credentials are never read back into the UI. Replacing an account replaces **all** fields, with blank required secrets rejected and blank/omitted optional secrets removed. Write/send permission defaults off even on replacement; sending also requires explicit per-call confirmation.

New provider setup:

- **Gmail (IMAP/SMTP)** (`gmail_imap`): required nonsecret `email` and secret `app_password`, using fixed TLS Gmail endpoints. Use a Google app password, not your normal password; Google/Workspace policy may restrict availability. The existing **Gmail** REST OAuth tile remains unchanged.
- **Discord (bot)**: required secret `bot_token`. Bot channel read/send subject to permissions and message-content policy; no selfbot, user token or personal-account login.
- **Telegram (bot)**: required secret `bot_token` in numeric bot-ID, colon, URL-safe token format. Reads show pending updates, **not history**, without advancing an offset or acknowledging updates. Existing webhooks may block polling. Sends use numeric chat IDs, not usernames; no personal-account login.
- **Signal (unofficial bridge)**: required nonsecret `bridge_url` and E.164 `number`, optional secret `api_token`. Outbound only through a separately installed/configured `signal-cli-rest-api` bridge. Only `http://127.0.0.1:<port>` or `http://[::1]:<port>` (1–65535, no trailing slash) is accepted; no URL credentials, path, query, fragment or remote host. Secure the local HTTP bridge and bind it only to loopback. NullBot does not install the bridge, register a number, link a device or read an inbox.

Saving, deleting and refreshing status do not contact providers, install/enable MCPs, or send tests. Vault credentials are injected only into the correct enabled, hash-pinned official stdio connector. Reserved provider environment prefixes cannot override that boundary. Marketplace release/trust state is unchanged by this UI support; a compatible connector must be separately available and explicitly installed/enabled.

The frontend catalog fixture is checked against the backend catalog by `service_accounts_test.go` and against UI definitions by `frontend/tests/service-accounts.test.mjs`. Validate both together with the updated NullBot source (the local Go workspace), not an older pinned module whose catalog lacks these providers. No dependency version or release update is implied.

## Privacy Notes

No API keys, account tokens, Codex auth files, NullBot config files, session data, or local workspace content should be committed here. Runtime credentials and user data are loaded from the user's NullBot data directory and local environment at run time.
