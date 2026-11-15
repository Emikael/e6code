---
key: E28
title: "Usage and limits"
linear_title: "E28 · Usage and limits"
labels: [Epic, Web, Desktop, Server]
priority: 3 # Medium
milestone: "M5 · Settings, connections, usage and theming"
parent: none # this is the epic issue itself
linear_documents:
  - https://linear.app/elomigroup/document/pending-tasks-e28-usage-and-limits-dd6db5e85847
---

# E28 · Usage and limits

## What this epic covers

Everything about what agent work costs and how much subscription quota is left: the Usage page (Cost and Tokens tabs across environments), the Limits tab and the shared limits view used by `/usage-limits` and the thread overview, custom model prices, and external usage-limit sources (CLIProxyAPI hubs). Behind it sit the server's transcript scanner and pricing, and per-provider limit fetchers.

## State today

![Usage today: Cost tab with total, provider share, daily chart, cost by model, tiles and models table](https://uploads.linear.app/cc840e3b-47d5-41a3-b7e2-88fc6be4c968/1ee7cfa4-d09b-4187-a707-5bf9b62d8d82/da0c855d-4128-40d4-ac04-d15558b54618)

_Usage today: Cost tab with total, provider share, daily chart, cost by model, tiles and models table_

- `/usage` is its own route and nav-rail destination; one 1,229-line component with a custom DOM chart, a second summary query per window just for the period delta, and hard-coded provider hex colours.
- The server scans Codex, Claude Code and Grok Build transcripts (so usage includes work outside E6 Code), prices at API rates, and merges client-side across environments with coverage notices for failing, outdated or duplicate sources.
- Limits come from provider events and fetchers that differ per provider, plus CLIProxyAPI hubs configured on the Providers page.
- Model prices hide in the environment filter menu; hub status is only visible as a warning on Limits.

## What the remodel must achieve

- Data display per the design direction: totals roll once with `numberChange`, no animated loops, one hue family per series role through tokens, values readable without hover, a table equivalent for every chart.
- Half the query cost for comparisons, a single-path chart, and server scans that respect the event-loop budget while agents stream.
- One limits view model in `client-runtime` shared by the Limits tab, `/usage-limits`, the thread overview, mobile and widgets, consistent with the per-provider capability matrix.

## Tasks

- E28-T01 Usage page: Cost and Tokens, filters, comparison, chart and table, coverage notices, server scanning.
- E28-T02 Limits and pooled subscriptions: pooled windows, pace, reset credits, refresh rules.
- E28-T03 Custom model prices: per-environment price overrides.
- E28-T04 Usage limit sources and hubs: CLIProxyAPI hubs and per-provider sources.

## Order

E37-T11 must be settled first (which providers report usage and limits). Then E28-T01 and E28-T02 in parallel (they share the page shell), then E28-T03 and E28-T04.

## Exit criteria

- Usage and Limits rebuilt behind their flag with every control, notice and state preserved, in dark and light.
- Charts on semantic tokens with table views; no hex colours.
- Comparison query cost and server scan impact measured against budgets.
- Limits view shared across web, `/usage-limits` and mobile; per-provider sources match the capability matrix.
