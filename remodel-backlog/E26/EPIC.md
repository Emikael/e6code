---
key: E26
title: "Theming and appearance"
linear_title: "E26 · Theming and appearance"
labels: [Epic, Web, Desktop, Mobile, Server]
priority: 2 # High
milestone: "M5 · Settings, connections, usage and theming"
parent: none # this is the epic issue itself
linear_documents:
  - https://linear.app/elomigroup/document/pending-tasks-e26-theming-and-appearance-7cdd229f725d
---

# E26 · Theming and appearance

## What this epic covers

Everything that decides how E6 Code looks on a device: the theme system (a stock palette with four accents, five built-in themes, 60 semantic colour roles, light and dark halves), the Appearance settings page and the runtime that applies it, the floating theme editor with its element inspector, importing themes from JSON, VS Code files and Open VSX, themes published by a server (`e6 theme`), and typography. It is the largest cross-cutting piece of today's design system: every colour on web, desktop and mobile goes through these roles, and users already own custom and imported themes built on them.

## State today

![Appearance today: Theme cards, Accent chips, Reading section (dark, stock theme)](https://uploads.linear.app/cc840e3b-47d5-41a3-b7e2-88fc6be4c968/c4adbd9e-03f1-43f3-89a4-054508ab8a82/f3e44863-ca60-4118-8ad1-894aaa0aaf64)

_Appearance today: Theme cards, Accent chips, Reading section (dark, stock theme)_
![The floating theme editor over Appearance](https://uploads.linear.app/cc840e3b-47d5-41a3-b7e2-88fc6be4c968/a72c53b1-fc84-4a58-a8e6-05c14b03baef/fc3ec4b5-c66a-455d-b34c-ef29103b992c)

_The floating theme editor over Appearance_

The system is disciplined (colour only through roles, contrast-checked built-ins, reserved ids) but its data lives in three hand-synced places (`index.css`, `packages/shared/src/themePalettes.ts`, the boot script in `index.html`), it has no notion of planes, so all panels render at one brightness, and the code is large (about 9.7k lines across theme files, plus the Appearance panel inside a 3,819-line settings file).

## What the remodel must achieve

- One token source (E01-T06, specified by E01-T07, retuned and audited by E01-T11) generates web CSS, mobile themes, desktop window colours and the boot palette.
- The Key Light plane and light roles are **derived** from existing roles, so every existing custom theme, VS Code import and published theme file keeps working with no migration and no rewrite of stored data (design decision D8). Built-ins are re-mapped and pass a contrast audit in both appearances.
- Appearance gains the app-wide Motion setting (Follow system, Full, Reduced, Off) in place of the panel animation slider.
- Theme switches are instant token swaps with one style recalculation; the first frame on every surface matches the stored theme.

## Tasks

- E26-T02 Theme system: built-ins and halves (foundation; role model, derived planes, compatibility).
- E26-T01 Appearance settings and runtime sync (the page and the code that applies it).
- E26-T06 Typography and fonts.
- E26-T03 Theme editor (floating panel, inspector, custom library).
- E26-T04 Theme import (JSON, VS Code, Open VSX).
- E26-T05 Environment-published themes (server, CLI, adoption).

## Order

T02 first (it decides the data model every other task uses), then T01 and T06 (the page), then T03 and T04 (authoring and import over the new model), then T05 (server publishing; small, can run in parallel once T02 lands).

## Exit criteria

- Fixture sets of today's custom themes, VS Code imports and published theme files render correctly on web, desktop and mobile with no stored-data migration.
- Contrast audit passes for stock × 4 accents and the five built-ins in dark and light.
- Theme, appearance, accent, editor and Motion are reachable from Settings, the command palette and keybindings.
- No theme flash on cold start (desktop, web, mobile).
- User docs (`docs/user/appearance.md`) match the shipped behaviour.
