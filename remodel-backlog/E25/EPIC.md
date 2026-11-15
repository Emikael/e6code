---
key: E25
title: "Settings shell and system settings"
linear_title: "E25 · Settings shell and system settings"
labels: [Epic, Web, Desktop, Server]
priority: 2 # High
milestone: "M5 · Settings, connections, usage and theming"
parent: none # this is the epic issue itself
linear_documents:
  - https://linear.app/elomigroup/document/pending-tasks-e25-settings-shell-and-system-settings-part-1-of-3-921a2582c668
  - https://linear.app/elomigroup/document/pending-tasks-e25-settings-shell-and-system-settings-part-2-of-3-6ed67dfec3de
  - https://linear.app/elomigroup/document/pending-tasks-e25-settings-shell-and-system-settings-part-3-of-3-c465c3920189
---

# E25 · Settings shell and system settings

## What this epic covers

The settings shell (navigation, search, the scope selector and the shared row primitives), the two storage planes behind every setting (device preferences and each environment's `settings.json`), and the "system" pages: General, Keybindings, Project, Source Control, Integrations, SnapShots, Storage, Archive, Diagnostics and Open source licenses, plus the background activity policy. Appearance and theming (E26), Providers (E27), Usage (E28) and Connections (E29) plug into this shell but are owned by their own epics.

## State today

![Settings today: the sidebar in settings mode, scope breadcrumb, and the General page](https://uploads.linear.app/cc840e3b-47d5-41a3-b7e2-88fc6be4c968/e3ef12e2-6fa3-4825-85f2-ad3b86a7fd06/707c5905-4461-4a8e-8a55-43840258b996)

_Settings today: the sidebar in settings mode, scope breadcrumb, and the General page_
![The scope breadcrumb's environment menu](https://uploads.linear.app/cc840e3b-47d5-41a3-b7e2-88fc6be4c968/57b7b4e3-de04-42b9-a642-c39e587944a9/5be471a8-b7aa-4c7f-b39f-d4df6efe54bf)

_The scope breadcrumb's environment menu_

- A TanStack Router layout route with 13 thin child routes; about 150 files and 33k lines including tests. The largest files are `SettingsPanels.tsx` (3,819 lines: General, Appearance, Archive, About), `KeybindingsSettings.tsx` (1,595), `IntegrationsSettings.tsx` (1,464), `DiagnosticsSettings.tsx` (1,319), `ResourceTelemetryDiagnostics.tsx` (1,281) and `settingsSearch.ts` (1,027).
- Two storage planes: **client settings** saved on the device (localStorage on web, the main process on desktop) and **server settings** saved per environment. Server settings are edited through a two-axis **scope** held in the URL (machine; project or checkout). Writes fan out to every connected environment in scope, rows show "Mixed" when environments disagree, and 17 keys can be overridden per project with an inheritance chain. The whole page remounts on every scope change.
- Settings search is a hand-maintained index (about 110 entries plus one per keybinding command, "Search 169 settings" in the UI) with availability flags that must match when rows render.
- Known defects found while writing this epic: "Restore device defaults" also resets server settings across the scope; Archive's Delete is only reachable by right-click; Diagnostics does not say which environment it shows; there is no keybinding to open Settings.

## What the remodel must achieve

- One shell on the v2 primitives, "calm, dense, instant" (design direction 8): cuts between pages, the `sweep` highlight for search landings, no row animations, and every page code-split within the 150 KB incremental route budget.
- A scope model a user can read before acting: every server row says where a change goes, device rows are visibly separate, and the owner's decision on multi-environment editing is recorded first (E25-T02).
- No silent loss: each page task carries its full control list with storage, and parity is checked row by row; the search index is tied to the rows so it cannot drift.
- Every behaviour reachable from Settings, the command palette and a keybinding, with the reverse states (unarchive, reset to inherit, restore) first class.

## Tasks

- E25-T01 Settings shell, navigation and search: the frame, nav, search index and row primitives.
- E25-T02 Settings scope: machine, project, checkout: the two-axis scope, fan-out writes, Mixed and inheritance. Owner decision on multi-environment editing.
- E25-T03 Client settings persistence and sync: device preference store, hydration, shared preferences, Restore device defaults.
- E25-T04 Server settings service: `settings.json`, secrets, change stream, schema evolution.
- E25-T05 General settings: about 35 rows across both planes, About and updates.
- E25-T06 Keybindings settings: rules, recorder, when clauses, `keybindings.json`.
- E25-T07 Project settings and defaults: project identity, checkouts, actions, per-project overrides.
- E25-T08 Source control settings: discovery, rescan, pull, merge and writing defaults.
- E25-T09 Integrations: browser and devices: agent access, preview defaults, profiles, device hosts.
- E25-T10 SnapShot settings and setup: desktop-only capture settings and per-platform setup.
- E25-T11 Storage and worktree cleanup: retention rules and the server sweeper.
- E25-T12 Background activity policy: profiles, overrides, server policy, token streaming warning.
- E25-T13 Archived threads: the way back from archiving.
- E25-T14 Diagnostics and resource telemetry: resource monitor, processes, traces.
- E25-T15 Open source licenses: generated notices viewer.

## Order

1. E25-T02 decision (multi-environment editing) and E25-T04 contract rules, in parallel.
2. E25-T03 (store) and E25-T01 (shell, search, primitives); both block every page.
3. E25-T05 General with E25-T12 (its dialogs), then E25-T07 and E25-T08 (project-scoped rows), E25-T11.
4. E25-T06 Keybindings, E25-T09 Integrations, E25-T10 SnapShots (after E21/E22 decisions).
5. E25-T13, E25-T14, E25-T15.

## Exit criteria

- Every settings page renders on the v2 shell behind its flag in dark and light, and each page's control list from its task has passed a row-by-row parity check.
- Scope behaviour (fan-out, partial failure, Mixed, overrides, stale ids) matches the ported tests, with the owner's multi-environment decision applied.
- Settings search covers every row and every keybinding command, tied to the rows by type or test.
- Scope changes do not remount pages; the settings route meets the bundle budget.
- Each page reachable from the command palette and by keybinding; reduced and off motion checked.
