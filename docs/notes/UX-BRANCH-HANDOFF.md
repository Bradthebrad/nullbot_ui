# Coordinated UX branch handoff

## Scope
These changes span `tinychain`, `nullbot`, and `nullbot_ui` and must be reviewed together:
- Provider streaming, invocation identities, and steering instruction inboxes.
- Independent Also runs, FIFO queueing, safe steering boundaries, and durable public history.
- Project permissions, attachment staging/validation, selected skills, and model assignment controls.
- Busy-send chooser, resizing, transcript/disclosure continuity, and Live Activity cleanup.

Live Activity now always shows all agents (latest 80 timeline items). The agent selector, filter-only counts, and filter-specific empty text were removed. Agent identity remains on individual cards. Three new frontend regressions cover all-agent rendering, the item cap, and empty state.

## Local verification (2026-09-14 UTC)
- Frontend Node suite: 54 passed, 0 failed.
- TypeScript: `node node_modules/typescript/bin/tsc --noEmit` passed.
- Production frontend: `node node_modules/vite/bin/vite.js build` passed.
- Coordinated Go suite: `go test ./nullbot_ui/... ./nullbot/... ./tinychain/... -count=1 -timeout=90s` passed with cached dependencies.
- No native WebView visual smoke test or real-provider end-to-end test was performed for this final cleanup. Previously built desktop executables are not refreshed by the frontend-only build.

## Build and merge dependencies
The current published module requirements (`nullbot v0.4.0`, `tinychain v0.2.0`) do not contain the new cross-repository APIs. Validation uses all three sibling checkouts through the existing parent `go.work`:

```go
go 1.27.0

use (
    ./nullbot_ui
    ./nullbot
    ./tinychain
)
```

Keep this workspace arrangement for local integration. Merge/release in dependency order: tinychain, nullbot, then nullbot_ui. Before standalone CI/release builds, publish compatible dependency revisions and update the downstream module requirements/sums. A local-only `replace github.com/Bradthebrad/nullbot => ../nullbot` edit is intentionally not included in the UI commit; the workspace already supplies this override.

## Remaining limits
- Race-detector coverage remains outstanding (the earlier attempt required unavailable CGO support). Review identified an existing unsynchronized config read in `nullbot/pkg/app/commands.go`'s `reply` helper; this UI-only final cleanup does not change its locking design.
- Queue/dedup state remains process-local, and steering cannot interrupt a blocked provider/tool. See CHAT-ROUTING-VERIFICATION.md for prior implementation limits.
- Runtime logs, temporary source-rewriting scripts, unused alternative UI implementations/styles, machine-specific build harnesses, and old coordination notes are left local rather than committed. The existing frontend lockfile refresh is retained as part of the saved work; no packages were installed in this pass.
