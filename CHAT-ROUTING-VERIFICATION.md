# Chat routing UX verification

## Implemented
- Busy Send/Enter route chooser with Also, Queue after Current Tasks, Steer Current Workers, and draft-preserving Cancel.
- Typed desktop bridge with selected-skill validation, existing attachment-token transport, client request identity, and target-job steering protection.
- Independent Also manager/tool/subagent runs and labeled lane identity; separate conversation does not imply separate filesystem or MCP side effects.
- Backend FIFO queue waits for primary descendants and final history write attempts. Pause holds queued work; queue removal supported.
- Per-invocation steering inboxes, complete tool-result handoffs, broadcast to active workers, and inheritance by future workers. Sealed manager rejects late steering.
- Durable public commentary/provider-visible summaries, session isolation, atomic session replacement, and compare-and-replace compaction.
- Persisted, clamped, accessible activity/composer resizing and wider previews.

## Automated evidence
- Full Go suite passed after final runtime broadcast changes: `go test ./nullbot_ui/... ./nullbot/... ./tinychain/... -count=1 -timeout=90s` (2026-09-13, parent cmd-10).
- Bridge regression covers invalid draft rejection, selected-skill validation, paused queued request dedup/removal, slash command routing, stale steer rejection, and session lane filtering/held-queue rejection.
- Runtime regression covers FIFO worker/history ordering, Also tools/workers/isolation, prepared steering skills, target identity, canceled held queue, durable output, active/future instruction recipients, and complete tool boundaries.
- Final frontend pass: 51/51 tests, TypeScript check, production Vite build; includes transcript near-bottom following and in-memory disclosure continuity. See workspace FRONTEND-POLISH.md.
- Final integrated Go suite passed again after all source edits (parent cmd-13). Focused routing/instruction tests passed ten consecutive runs (parent cmd-11).
- Windows desktop build succeeded (parent cmd-12): `build/bin/nullbot-ui-routing-test.exe`, using `go build -tags desktop,production -trimpath -ldflags '-s -w -H windowsgui'`. Previous test executables were preserved.
- `git diff --check` for desktop tracked changes found no whitespace errors (line-ending warnings only).

## Limits and unverified items
- No native Windows/WebView smoke test or real provider/MCP end-to-end test performed in this pass. Manually verify drag/drop, resizing, busy chooser, Also, queued requests, steering, and transcript reading in the built desktop app.
- Race tests were attempted; local Go reports `-race requires cgo`. Race-detector coverage remains outstanding.
- Queue and dedup state are process-local. Completed-job snapshots retain the newest 64; request receipts remain for process lifetime.
- Steering cannot interrupt a blocked tool/provider. Pending instructions rejected on cancellation are reported through activity events.
- Persistence failures are currently logged rather than changing a successful job to an error.
- Also public records are persisted with lane identity but excluded from primary session import/model context.

Existing unrelated workspace edits were preserved. No commits, installs, or application launches were performed in this implementation pass.
