# Paste/drop attachment test build

## Implemented
- Normal prose/mixed prose-and-path paste stays native. Clipboard File objects (including screenshots) are read as bytes and staged through `AttachBytes(name, standardBase64)`; no path resolver is needed.
- Explorer clipboard file payloads and native Wails file drops use the same staging queue. Complete quoted absolute-path lists are also supported. Ambiguous unquoted paths containing spaces remain text; use quotes.
- Per-file Preparing / Ready / Failed chips with errors, stable removal, and send blocking until preparation completes or failed items are removed. Removed items cannot reappear after asynchronous completion.
- PNG/JPEG/GIF thumbnail buttons open modal previews with Escape and focus restoration. Preview images are re-encoded PNGs capped at 256x256, not full-resolution viewers. Original image bytes remain intact for Send.
- Files stay local under the workspace `.nullbot/attachments/import-*` directories until Send. Removing a chip removes it from the draft, not a successfully staged disk copy. Failed imports clean up partial files.
- Current history and Also-question image loading use active project read checks. Non-image attachments remain file tokens for tool inspection.

## Limits
- 20 MiB inclusive per file; bounded backend copies and frontend size checks before reading. No aggregate disk quota/automatic staged-file cleanup is added.
- GUI PNG/JPEG/GIF validation rejects malformed content and images over 16,777,216 pixels. Core loader independently limits images to 25,000,000 pixels.
- SVG/BMP/WebP have no GUI thumbnail. SVG/BMP retain the non-image tool workflow. WebP core validation checks RIFF/chunks/headers, not compressed pixel decoding. GIF validation/preview checks the first frame only.
- Destination project must permit writes. Explicit external path imports receive a source read grant without overriding configured source-project restrictions. Clipboard bytes have no trustworthy original path; destination permissions still apply.
- Existing project symlink/reparse checks remain conservative and are not race-proof OS isolation.
- Historical token-only chips do not restore thumbnails after history replacement/restart.
- `vision_extract` runtime exposure was not changed.

## Verification
The test build pipeline runs 36 frontend regression tests (including 13 attachment tests), TypeScript/Vite production compilation, Go tests across `nullbot_ui`, `nullbot`, and `tinychain`, Windows desktop compilation, and UPX integrity checking. Focused Windows junction and locked/unreadable-file tests passed; symlink tests can skip when the Windows privilege is unavailable.

Frontend handler/modal tests use executable TypeScript and mocked hooks/bridges, not native Windows UI automation. No interactive WebView2 clipboard/drop test, pixel-level review, or live-provider attachment send was performed in this pass.

## Manual acceptance checks
Use `build/bin/nullbot-ui-test.exe` with a writable test project; WebView2 is required.
1. Paste multiline prose: exactly one native insertion; no chips.
2. Copy a Snipping Tool screenshot, paste into chat: Preparing then Ready thumbnail; click preview, Escape closes, keyboard focus returns.
3. Copy multiple files in Explorer, paste; then drag files into chat. Check one chip per file, names with spaces, and no unintended navigation.
4. Paste a complete quoted path list; paste prose mentioning a path. Only the complete list should stage files.
5. Remove a Preparing item immediately; it must not return. Try Send/Enter while staging or with a failed item: no submission.
6. Try a >20 MiB file, corrupt PNG, and read-only destination: clear failure; removing the failed chip permits sending the remaining draft.
7. Explicitly Send a ready screenshot with a vision-capable model and check image understanding. Repeat in Also mode if used. This is the first step that sends image content to the configured provider.
8. Verify rejected submissions retain the draft and that edits/new attachments made during a submission survive its acceptance.

Unsigned/UPX-packed executables may trigger antivirus warnings. Prefer the normal executable; do not disable protection.
