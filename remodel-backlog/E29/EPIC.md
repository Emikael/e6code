---
key: E29
title: "Connections and remote access"
linear_title: "E29 · Connections and remote access"
labels: [Epic, Web, Desktop, Mobile, Server]
priority: 1 # Urgent
milestone: "M5 · Settings, connections, usage and theming"
parent: none # this is the epic issue itself
linear_documents:
  - https://linear.app/elomigroup/document/pending-tasks-e29-connections-and-remote-access-part-1-of-2-7a338f212105
  - https://linear.app/elomigroup/document/pending-tasks-e29-connections-and-remote-access-part-2-of-2-c7193a46d1e4
---

# E29 · Connections and remote access

## What this epic covers

Remote access, one of E6 Code's core principles: how other devices reach an environment and how a client uses several environments. Client side: the Settings → Connections page and its dialogs, pairing links and authorized clients, saved environments (remote link, SSH, E6 Connect cloud) and remote-only desktop, Tailscale and network access, load balancing and GitHub sharing. Server side: the environment auth model (scopes, cookie, bearer and DPoP sessions, WebSocket tickets, keychain), SSH launch, environment identity, and E6 Connect (Clerk account, relay Worker, managed tunnel, agent activity publishing).

## State today

![Settings → Connections in a browser client on a loopback-only server (dark)](https://uploads.linear.app/cc840e3b-47d5-41a3-b7e2-88fc6be4c968/027fb74a-50ca-40a6-b4e2-cfe79879a207/ae8fad41-8c8c-458f-b567-ea43a5e0ef53)

_Settings → Connections in a browser client on a loopback-only server (dark)_
![Add Environment dialog](https://uploads.linear.app/cc840e3b-47d5-41a3-b7e2-88fc6be4c968/ab01ec81-b82b-478b-87b2-f36bef57e404/00a834eb-5318-466e-bd3b-f800642f6e0f)

_Add Environment dialog_

The security model is careful and documented (`docs/internals/environment-auth.md`, `remote.md`, `e6-connect.md`); the UI is one 3,779-line file whose content changes heavily by platform, permission and cloud config. Many states (authorized clients, QR, Tailscale, SSH, E6 Connect) could not be photographed because they need network access, a tailnet, a desktop shell or cloud config, which is also why they are easy to regress.

## What the remodel must achieve

- Rebuild the Connections UI on the v2 shell with every security property unchanged: one-time, short-lived, scope-carrying pairing links; narrowing-only exchange; metadata-only access lists; revocation; DPoP without bearer fallback; secrets in URL fragments only; trusted-origin rules; relay never holding environment sessions.
- Reachability and access stated in words, so a user can tell who can reach this machine and how.
- Tested in every connection mode: local, LAN, tailnet, relay (plus SSH and hosted web).

## Tasks

- E29-T03 Environment auth model and secrets (server foundation; parity and security regression suite).
- E29-T10 Environment identity and machine descriptor.
- E29-T02 Pairing links and authorized clients.
- E29-T04 Saved environments and local environment.
- E29-T05 Tailscale and network access.
- E29-T01 Connections settings and dialogs (the page that hosts the above).
- E29-T06 SSH environments.
- E29-T07 E6 Connect account, relay and cloud environments.
- E29-T08 Load balancing across environments.
- E29-T09 GitHub sharing between environments.

## Order

T03 and T10 first (they freeze the contracts and add the security test suite), then T02, T04 and T05, then T01 assembling the page, then T06 and T07 (desktop- and cloud-specific), then T08 and T09. Architecture §5 keeps the auth, pairing and DPoP machinery out of scope for the UI rewrite, and the `/pair` and `/connect` routes move last.

## Exit criteria

- Every task's parity checklist passes on web and desktop, and mobile counterparts (E34-T03, E34-T04) agree on vocabulary.
- A single test session covers local, LAN (HTTP), tailnet (HTTPS), relay, SSH and hosted web, as a standard-scope client and an administrative client.
- Security regression suite green; no pairing secret in logs, analytics, URLs to the hosted origin or persisted client state.
- `docs/user/remote-access.md` matches shipped behaviour.
