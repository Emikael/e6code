---
key: E27
title: "Providers and models"
linear_title: "E27 · Providers and models"
labels: [Epic, Web, Desktop, Server]
priority: 2 # High
milestone: "M5 · Settings, connections, usage and theming"
parent: none # this is the epic issue itself
linear_documents:
  - https://linear.app/elomigroup/document/pending-tasks-e27-providers-and-models-d0781ba63866
---

# E27 · Providers and models

## What this epic covers

How a user connects E6 Code to the coding agents on each environment: provider instances (several accounts or configurations per driver, each with its own binary path, home directory and environment variables), install, update and sign-in flows, the model list with favourites, hiding, ordering and custom models, Antigravity's in-app runtime and Google sign-in, and the provider status snapshots and health refresh that every other screen reads. Server parts (status, manifest, maintenance) are included where they drive the settings UI; the provider runtimes themselves are E37.

## State today

![Settings → Providers today: instance list with status words and enable switches, Codex editor on the right (dark)](https://uploads.linear.app/cc840e3b-47d5-41a3-b7e2-88fc6be4c968/d85ed3f7-cef8-40a2-862d-622cc0d29433/49182d1e-bf8d-4348-a1cb-2e18d74bd085)

_Settings → Providers today: instance list with status words and enable switches, Codex editor on the right (dark)_
![Add provider instance wizard, driver step](https://uploads.linear.app/cc840e3b-47d5-41a3-b7e2-88fc6be4c968/b4a98204-0186-4dcf-ad7e-1551aef42b39/7cd6c638-aa97-4161-99c0-43ae60e11270)

_Add provider instance wizard, driver step_

The page is capable (schema-driven forms per driver, unknown-driver preservation, redacted secrets) but status is a line of text, five of six providers require leaving the app to sign in, the page uses its own environment tabs instead of the settings scope, and model preferences are split between device (favourites, hidden, order) and server (custom models). About 4.5k lines of client code.

## What the remodel must achieve

- A status board: each instance shows one status mark and one next action, using the shared status vocabulary, with per-provider facts taken from the capability matrix (E37-T11), never from driver-kind checks.
- Every flow works from a remote client against an environment on another machine.
- Unknown drivers, redacted secrets, instance ids and stored model preferences survive unchanged.

## Tasks

- E27-T01 Provider instances (the page and the add-instance wizard).
- E27-T05 Provider status and health refresh.
- E27-T02 Provider install, update and auth.
- E27-T03 Models: manifest, favourites, custom models.
- E27-T04 Antigravity setup and sign-in.

## Order

E37-T11 must be settled first. Then T01 with T05 (page and the data it shows), then T02 (update and sign-in actions), T03 (models), and T04 (Antigravity, which reuses T02's patterns).

## Exit criteria

- Parity checklist from each task passed on web and desktop, against a local and a remote environment.
- No client branches on driver kind for anything the capability descriptor covers.
- Reviewed in dark and light, keyboard only; user docs for providers still accurate.
