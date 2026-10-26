# Phases 0–3: handoff

Everything from the improvement plan's Phases 0 to 3 is on a branch named
`ux/phase0-3-overhaul` in each of the three repos. Nothing is merged to
`main`. This page says what is on each branch, how to merge it, and what is
left.

## Branches

| Repo | Branch commits (oldest first) |
| --- | --- |
| tinychain | `eac2c06` MCP: spec metadata, multiplexed stdio, roots, remote sessions, tree kill |
| nullbot | `0dcb3f5` WIP snapshot of your uncommitted service-accounts work, then `158724b` permissions, MCP session pool, bounded memory; `0591fc2` network-free model lists; `1f1a1b6` appearance and accent config; `c5f2fe4` access checks per capability, outside paths refused before any I/O; `24bcdaa` tool calls saved per session, searchable history for agents |
| nullbot_ui | `ff2ff9f` WIP snapshot of your uncommitted service-accounts work, then `bf76dd2` bridge (batched activity, push events, streamed previews, safe links); `4f59f73` the redesign; then this handoff and the fixes from an independent review |

The two WIP commits are your local, uncommitted work as it was on your disk
on 26 October, so nothing of yours was lost. They are also on
`wip/local-snapshot-20261026`. Merging the overhaul branch merges them too;
if you'd rather review them separately, merge the `wip/` branch first.

## Merge order

The modules depend on each other through `go.mod`, so merge from the bottom
up:

1. **tinychain**: merge `ux/phase0-3-overhaul` into `main`.
2. **nullbot**: point it at the merged tinychain, then merge.
   ```sh
   go get github.com/Bradthebrad/tinychain@main
   go mod tidy
   go test ./...
   ```
3. **nullbot_ui**: point it at both, then merge.
   ```sh
   go get github.com/Bradthebrad/tinychain@main github.com/Bradthebrad/nullbot@main
   go mod tidy
   go test ./...
   ```

If you build with a `go.work` that `use`s all three folders, the
requirement bumps can wait; the workspace resolves to your local copies.

## Building the desktop app

```sh
cd nullbot_ui
wails build
```

`wails build` (or `wails generate module`) regenerates `frontend/wailsjs`.
The bindings in `App.js` and `App.d.ts` were updated by hand for the new
methods, and the regenerated files will match them. `wailsjs/go/models.ts`
will gain the new Go types; the frontend doesn't import those (it has its
own types in `frontend/src/lib/types.ts`), so nothing breaks if it changes.

## Tests

```sh
# Go, in each repo
go test -race ./...

# Frontend (nullbot_ui/frontend)
npm install
npx tsc --noEmit
npm test            # vitest (jsdom + Testing Library), then the node tests
npm run build
```

The vitest suite covers the activity model and describer, link routing, the
store, transcript streaming, chat state, the composer, and the app shell
against a fake bridge (boot, chat persistence across views, links opening
in the system browser, bounded memory over 300 turns, the command palette,
and change-driven refetch).

## What changed for people using the app

- **Permissions follow projects.** Each project is Read only, Read & write,
  Full, or Custom (read plus any of edit, delete, run programs). Every tool
  call, including tools from local and remote MCP servers, is checked
  against the project its paths fall in. The primary project is where the
  bot starts and what pathless calls are judged by. Details in
  `nullbot/docs/PERMISSIONS.md`.
- **Tool servers load on demand.** Servers start on first use, are shared
  by all agents, restart after a crash, stop after 15 idle minutes, and
  start in the primary project. The Tools page shows each server's state,
  why it failed (with what it printed), and what each tool needs; any tool
  can be reclassified or set to never run.
- **Activity says what happened.** Each step reads as a sentence, such as
  "Searched the web for “acme outage”" with "8 results", and blocked calls
  say which project and permission stopped them. No raw JSON.
- **Links open in your browser.** Web and mail links open in the system
  browser; file paths open in Files (Ctrl+click opens them in the system
  app). Nothing navigates the app window. Links to network shares
  (`\\host\share`, `//host/...`) are never followed, and images from the
  web in a reply load only when you click them, so a reply can't make the
  app contact another machine on its own.
- **Files stays inside projects.** The Files view, previews, path
  completion and "open with the system app" only reach folders inside your
  projects, and the backend refuses anything else before touching the
  disk. Deleting needs the project's delete permission; editing and
  renaming need write. Unsaved edits ask before they're discarded.
- **Memory stays flat.** Streamed tokens are batched, nothing polls, and the
  activity kept in memory is capped. Nothing on disk is trimmed.
- **History is searchable, by agents and in the app.** Every message and
  every finished tool call is saved per session. Agents get
  `history_search` (words, role, tool, session, time range, paging) and a
  `history_session_read` that reads any range at full length with the tool
  calls in between. The History view searches the same way, with filters for
  time and for messages or tool calls. See `nullbot/docs/HISTORY.md`.
- **New look.** Clean panes, IBM Plex type, light and dark themes and five
  signal colors (Settings → Appearance). Ctrl+K opens commands; Ctrl+1–5
  switch views; Ctrl+. shows or hides the activity panel.

## Left to do

- **Phase 1.5:** add `title` and `annotations` (`readOnlyHint`,
  `destructiveHint`) to the tools in the NullBot MCP server repos. Until
  then, NullBot classifies those tools by name, which is safe but means
  some read-only tools are treated as needing write.
- **Phase 4 extras:** code-splitting the frontend bundle (540 KB, loaded
  from disk) and a Playwright smoke test inside CI.
- `go_projects/.claude-transfer/` on your computer holds the archives used
  to move the code and Go module cache into the build environment. It is
  safe to delete.
