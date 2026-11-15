---
key: E20
title: "Terminal"
linear_title: "E20 · Terminal"
labels: [Epic, Web, Desktop, Server]
priority: 2 # High
milestone: "M3 · Workspace panels"
parent: none # this is the epic issue itself
linear_documents:
  - https://linear.app/elomigroup/document/pending-tasks-e20-terminal-ec4d5f08554d
---

# E20 · Terminal

## What this epic covers

The integrated terminal: the bottom drawer and the Terminal tab in the right panel, terminal groups and splits, selection to chat and link handling, the custom Ghostty WASM rendering engine (Canvas 2D, not xterm.js), and the server PTY manager with bounded, restart-safe scrollback.

## State today

![Terminal drawer with shell output and the group list](https://uploads.linear.app/cc840e3b-47d5-41a3-b7e2-88fc6be4c968/b8809a1e-cd67-4a6d-b982-4bddd7583d7e/c87a68af-7e54-4921-90a6-3b2981ff2d4c)

_Terminal drawer with shell output and the group list_
![The same terminal model as a right-panel tab](https://uploads.linear.app/cc840e3b-47d5-41a3-b7e2-88fc6be4c968/b4323d02-78fc-4df7-b59d-9fcec91bed96/8fda57a2-5aec-4f9a-ae65-77ecf13fc8d9)

_The same terminal model as a right-panel tab_

- Two parallel UI state models: drawer groups in `terminalUiStateStore` and panel groups inside right-panel surfaces, cross-checked so one PTY never gets two viewports. `ThreadTerminalDrawer.tsx` is 1720 lines and one drawer stays mounted per mounted thread.
- The engine (`libghostty-vt` WASM, Canvas renderer, 2024-line surface) is an asset to keep; it shares its C ABI with Android.
- The server manager (3068 lines) keeps 5,000 lines / 8 MiB of history per terminal and polls `ps` every second for subprocess labels.

## What the remodel must achieve

- One terminal model per thread: a session shown in the drawer or the panel, never both.
- The drawer follows the §3.8 panel rule vertically (height committed once, transform-only dolly); the canvas itself is never animated and output is instant (design direction §3.10).
- Keep the engine and its rules (no React in the render loop, replay protection, reproducible pinned build); hidden terminals do no rendering work.
- Replace `ps`/`lsof` polling with the native resource monitor while keeping the retention guarantees.

## Tasks

- **E20-T01** Terminal drawer and panel surface (groups, splits, lifecycle).
- **E20-T02** Ghostty terminal engine (foundation, kept).
- **E20-T03** Terminal selection, links and chat context.
- **E20-T04** Terminal manager (PTY) on the server.

## Order

E20-T02 and E20-T04 first (foundations, can run in parallel; E20-T04 waits on the resource monitor work in E39-T03 for its polling change), then E20-T01 on top of E17-T01, then E20-T03.

## Exit criteria

- Drawer and panel terminals run in the v2 UI on one state model, with persisted state migrated and the legacy drawer deleted.
- Output throughput and retention behaviour unchanged (benchmarked), no frames from hidden terminals, no idle `ps` processes with the monitor present.
- Selection-to-chat and link routing work identically on web and desktop.
