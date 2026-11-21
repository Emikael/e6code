# E6 Code

E6 Code is a minimal GUI for coding agents. A Node WebSocket server wraps provider CLIs and agents (Codex, Claude Code, Cursor, Grok, OpenCode, Antigravity) and serves web, desktop, and mobile clients.

You can think of E6 Code as an open source "bring-your-own-subscription" alternative to apps like Claude Desktop, Codex App, Cursor Glass and Conductor.

## What makes E6 Code special?

E6 Code is a new project. Keep these priorities as it grows.

### 1. Open at the core

E6 Code is open source. Keep implementation decisions visible so people can understand the code and build their own forks.

### 2. Performance without compromise

Keep startup and interactions fast. Watch WebSocket payload sizes, unnecessary CSS animations, and list rendering. Measure hot paths before adding work to them.

### 3. Remote ready

The server's WebSocket layer supports remote clients. Account for local-network, Tailscale, and tunnel connections when changing behavior that crosses the connection boundary.

### 4. Multi-surface

E6 Code has 3 key app surfaces: **web**, **desktop**, and **mobile**.

**Web** can be served locally by the server or hosted separately. Support both paths where reasonable.

**Desktop** is an Electron app that bundles the server runner. It can host connections from remote web and mobile clients.

**Mobile** is a React Native app for iOS and Android. It connects to an E6 Code server to control work remotely.

## Maintainer direction

Emikael Silveira maintains E6 Code. Favor small, clear solutions that preserve performance, remote access, and consistency across clients. Understand the constraint before adding machinery.

Honor the developer's intent and avoid scope creep. These instructions are defaults; the developer can override them for a task.

E6 Code may be used to modify itself, including through remote clients. Protect running instances and their data while working.

## A small glossary

We need to be on the same page with terminology. When communicating, use this language:

- **you** means the agent reading this file and changing E6 Code.
- **we** and **us** mean the E6 Code project.
- **maintainer** means Emikael Silveira.
- **user** means the person using E6 Code to direct coding agents.
- **agent** means the coding agent a user runs inside E6 Code. Depending on context, that may also include you.
- **provider** means the agent runtime or harness E6 Code talks to, such as Codex, Claude, Cursor, or OpenCode.
- **client** means the web, desktop, or mobile UI.
- **environment** means one running E6 server and the machine, filesystem, provider credentials, and state it owns.
- **project** means an environment-local workspace record rooted at a directory.
- **thread** means the durable conversation and work history for a project.
- **turn** means one user-to-agent cycle, including follow-up work such as checkpointing.
- **E6 home** means the base data directory. Runtime state normally lives below its userdata directory.

## The three ways to hurt yourself

1. **Killing by pattern.** Never `pkill -f`, `pgrep | kill`, or `kill` a PID found by matching a name, path, or worktree string. Stop only a PID captured when you started the process. If that PID is unavailable, find the listener on your port with `lsof -nP -iTCP:<port> -sTCP:LISTEN` on macOS or `ss -H -ltnp` on Linux. Confirm its working directory is your worktree with `lsof -a -p <pid> -d cwd` on macOS or `/proc/<pid>/cwd` on Linux before stopping it.
2. **Writing to the live install.** The active E6 home, normally `~/.e6`, contains the developer's live database under `userdata`. Reading it and making a consistent snapshot are fine (see Test data). Never start a test server against it, open it read-write, or clean it up.
3. **Baking in origins.** Never set `VITE_HTTP_URL` or `VITE_WS_URL` for dev. Dev is single-origin and Vite proxies `/api`, `/ws`, `/oauth`, and `/.well-known`. Setting them bakes localhost into the bundle and silently breaks every remote browser.

## Hit every surface

Cross-surface gaps are easy to miss. Before calling frontend work done, walk this list and say which entries applied:

- **Entry points.** A behavior reachable from the chat view is usually also reachable from Settings, the command palette, and a keybinding. Fixing one is not fixing the feature.
- **Clients.** Web, desktop (wraps web, adds Electron shell/IPC), and mobile (React Native, separate navigation). Shared logic lives in `packages/client-runtime`
- **Providers.** Codex, Claude, Cursor, Grok, OpenCode, and Antigravity each have an adapter. Provider-shaped features need a decision per adapter, even if the decision is "not supported here".
- **Contracts.** Anything crossing the wire is typed in `packages/contracts`. Change the schema and the server, web, mobile, and desktop all follow.
- **Reverse states.** If you added a way in, add the way out and the way to see it. Snooze needs unsnooze. Close needs reopen. A one-way door is a bug.
- **Connection modes.** Local, remote/relay, and tunnel behave differently. Multi-device and multi-environment cases are real.
- **Docs.** Check whether the change makes existing guidance inaccurate. Apply the [documentation rules](#documentation) before adding anything.

## Dev servers

- `vp i` installs. Worktrees get this from the e6.json setup script; if module resolution looks broken, it probably did not run.
- `vp run dev` starts server and web. In a worktree, state defaults to that worktree's gitignored `.e6`, which deliberately outranks an ambient `E6CODE_HOME` so you cannot land on shared state by accident. An explicit `--home-dir` still wins.
- Ports derive from the worktree path and are stable across restarts, but read the real ones from the `[dev-runner]` line since occupied ports shift.
- Sharing over the tailnet is three steps: run `vp run dev --share` in the background, wait for the `pairingUrl:` line in its output, then give that full URL to an unpaired browser. Do not wire up `tailscale serve` by hand, open the URL yourself, or consume the user's pairing link. A browser with the reusable dev cookie can use the bare origin. If a normal one-time token was consumed, mint a fresh one with `node apps/server/src/bin.ts pair`. It carries standard scopes, while the startup URL carries admin scopes needed for Connections settings.
- To reuse web dev auth across worktrees, configure one fixed `E6CODE_DEV_AUTH_TOKEN` in the main checkout's gitignored `.env`. The `e6.json` setup links that file into worktrees. Never commit or publish the token or a startup URL. See [Reusable dev credential](docs/operations/development.md#reusable-dev-credential).
- Stop what you started, by the PID you tracked. See rule 1.

## Test data

When a test needs realistic data, seed the worktree's `.e6/userdata` from a snapshot instead of pointing at live state. Preserve any data already present in the worktree.

- Identify the active E6 home from the server's launch arguments or `E6CODE_HOME`. By default, source data is in `~/.e6/userdata`; use `~/.e6/dev` only if that is the dataset you intend to test. Worktree state lives at `<worktree>/.e6/userdata`.
- For the default home, snapshot the database with `VACUUM INTO`. It yields one consistent file while the server has the source open. The target must not already exist:

  ```bash
  mkdir -p .e6/userdata
  bun -e "new (require('bun:sqlite').Database)(process.env.HOME + '/.e6/userdata/state.sqlite', { readonly: true }).run(\"VACUUM INTO '.e6/userdata/state.sqlite'\")"
  ```

  A plain `cp` is only safe when no server has the source open, and must bring the `-wal` and `-shm` siblings along. A live file copy is a corrupt copy.

- Bring `secrets` and `settings.json` only if the flow under test needs them.
- Copy in, never symlink. Data flows one way: into your sandbox, never back out.

## Verifying

- Smallest proof that the change works. `vp test run <files>` for the tests you touched, targeted lint and typecheck for the scope you changed.
- Test meaningful logic or observable behavior. Do not render components to static markup to assert props or attributes, or add tests that merely assert callback wiring or mirror the implementation.
- **Do not run repo-wide checks.** No `vp check`, no `vp run -r test`, no `vp run -r typecheck` unless I ask. The CI workflow is intended to run the full suite once committed.
- Backend behavior changes ship with focused tests for that behavior.
- The server is event-sourced and its async flows emit typed receipts. Wait on receipts and worker drains, never on sleeps or polling. A test that needs a timeout to pass is wrong.
- Upon request, user-visible frontend changes should get one integrated pass in a real client: `test-e6-app` for web, `test-e6-mobile` for mobile. The primary agent does this once after integrating. Subagents do not launch their own dev servers. Ask permission before doing computer use or spinning up browsers.

For authorized mobile verification, a missing or outdated native client is a build step, not a blocker. Run `node scripts/mobile-native-client.ts ensure <ios|android> <device-id>` on the simulator host before starting Metro. It checks the local Expo fingerprint and builds/installs when needed. See `test-e6-mobile` for the full workflow.

## Pull requests

- Never make a PR unless the developer explicitly asks you to do so.
- Conventional commit titles, plain language: `fix(web): new threads no longer spike CPU`.
- Body: the problem in a sentence or two, then how you fixed it. End with the model and harness that did the work.
- UI changes need before/after images. Motion or timing needs a short video.
- Upload PR evidence to GitHub. Never commit PR-only screenshots or assets such as `.github/pr-assets/`.
- One concern per PR. If the description says "also", split it.
- When babysitting: poll checks and comments newer than the last push, verify each bot finding against the source, fix real ones, dismiss false positives with a written reason. Stay quiet when nothing is new. Stop when the bots are green on the latest commit.

## Documentation

Most code changes do not need an internal documentation change. Agents can read the code.

- `docs/internals/` is for architectural decisions and their reasons, constraints that span components, and implementation traps that are hard to discover from the source. Before adding a paragraph, ask what a maintainer would get wrong without it. If reading the relevant code answers the question, leave it out.
- Do not document every feature, enumerate fields or methods, narrate control flow, maintain file catalogs, or append PR summaries. Types, tests, and code already record the implementation. The glossary defines shared vocabulary; it is not a feature index.
- Keep a local implementation explanation in a nearby code comment. Use an internal doc when the reasoning crosses boundaries or needs context the code cannot carry well. Link to the relevant source instead of copying it.
- When a documented decision or constraint changes, rewrite or remove the affected text. Do not append another account of the new behavior. A new internal page needs a distinct, durable reason to exist.
- `docs/user/` helps users accomplish tasks. Give each major feature a concise section explaining what it does, how to start, and anything unintuitive. A settings path is useful; descriptions of visible buttons, icons, layouts, animations, or every UI state are not. Before adding text, ask what task or decision it helps the user with.
- Keep user docs in the shipped product's voice, without implementation details or contributor tooling. Update the relevant feature section when how to use it changes. A UI tweak does not need a documentation entry, and a new control does not need its own page.
- `docs/operations/` holds maintainer setup, release, and debugging procedures. Keep instructions for operating an installed E6 Code server in the user guides.

## Plans and work artifacts

- Do not commit implementation plans, research notes, or agent scratch files. Keep temporary working material outside the worktree. `.plans/` is gitignored only as a safety net for legacy tooling.
- Track active maintainer work in the GitHub issue or project item that owns it. External proposals follow `CONTRIBUTING.md` and belong in Ideas discussions.
- A merged PR is the implementation record. Close or update its tracking item when the work lands; do not preserve a second checklist in the repository.
- `remodel-backlog/` is the one approved exception: remodel tasks that could not be filed in Linear wait there until they are filed or implemented (see its README).

## How it works

Clients send typed WebSocket requests. The server turns them into _commands_, a pure _decider_ turns commands into persisted _events_, and a _projector_ derives the read model the UI renders. Provider CLIs run as subprocesses; per-provider _adapters_ translate their native protocols into orchestration events. Side effects run in queue-backed _reactors_ that emit _receipts_ when milestones land. Each turn ends with a _checkpoint_, a hidden git ref, so the app can diff and restore.

Full glossary with file links: `docs/internals/glossary.md`

## Where code lives

- `apps/server` - WebSocket, orchestration, providers, checkpointing. Effect-heavy: read `.repos/effect-smol/LLMS.md` before writing Effect code.
- `apps/web` - React/Vite UI. `apps/desktop` wraps it, `apps/mobile` is React Native, `apps/marketing` is the site. Web code outside `apps/web/src/next/` is legacy: frozen except for fixes and for the remodel tasks whose plan migrates it, such as the icon codemod and the screen-flag switches.
- `apps/web/src/next/` - redesigned (v2) web code only. See [The remodel](#the-remodel).
- `packages/design-tokens` - the single token source: colours, planes, type, layout, motion durations and the icon name registry. Web CSS is generated from it; mobile and the desktop window import its values.
- `packages/contracts` - Effect/Schema contracts plus small derived helpers. No heavy runtime logic.
- `packages/shared` - shared runtime utils, subpath exports, no barrel.
- `packages/client-runtime` - client code shared by web and mobile.
- `.repos/` - vendored read-only references. Prefer their patterns over invented ones. Never edit or import from them. Sync with `vpr sync:repos` when bumping the matching dependency.

## The remodel

The E6 Code Remodel rewrites every screen in phases. Its decisions live in the Linear project "E6 Code Remodel", in the documents "Architecture decisions and performance budgets", "Design direction" and "Agent team and workflow". Tasks not yet filed in Linear are files in `remodel-backlog/`.

- Remodel work integrates on the `remodel` branch. Start each task from the latest `remodel`; one task is one PR into `remodel`. Keep `remodel` current by merging `main` into it, never by rebasing it.
- A rule below that names a task still to land applies already; that task adds the code or the enforcement. Until it lands, do not build a substitute for a layer another task owns, such as a flag registry or an icon layer: wait for that task or ask the maintainer.

### v2 layout

- v2 web code lives in `apps/web/src/next/`: `app/` (shell frame, launch, route switches), `features/<feature>/` (screen, components, view-model hooks, feature stores), `ui/` (primitives over Base UI), `motion/` and `icons/`. `motion/` and `ui/` exist; `app/` and `features/` arrive with the strangler shell (E04-T02, ENG-81) and the first screen tasks, and `icons/` with E03-T04 (ENG-93).
- Legacy code does not import from `next/`. The legacy imports of `next/motion` and `next/redesignedScreens.ts` that shipped with the Motion setting (ENG-126) already exist; add others only where a task's approved plan names them, such as the E04-T02 route switches, or with the maintainer's agreement. `next/**` never imports `components/ChatView*`, `components/Sidebar*`, `LegacySidebar`, `composerDraftStore` or any legacy zustand store; move the logic into `packages/client-runtime` or `next/features/<feature>/model` first.
- Features do not import each other's internals; they share through `client-runtime` atoms or an explicit `features/<feature>/index.ts`. A component file over 600 lines needs a reason in review.
- Server state lives only in Effect atoms in `client-runtime`: lists subscribe to ordered ids, each row to its own entity atom. UI state lives in per-feature zustand stores that persist per key. No `useEffect` copies of atom values into stores.
- Presentation logic mobile also needs (row view models, status wording) lives in `client-runtime`, so web and mobile render the same view model.
- E04-T05 (ENG-85) adds lint rules for these boundaries. Today, besides the repository-wide rules, `next/**` has only the raw-palette and animation-engine rules in `vite.config.ts`.

### Screen flags

- Each v2 screen ships behind its own flag (`ui.v2.sidebar`, `ui.v2.thread`, ...) in the typed registry `apps/web/src/next/flags.ts`, stored in client settings (E04-T02, ENG-81). Until it lands no screen flag exists: `next/redesignedScreens.ts` is the one hook that asks whether any v2 screen is on, and it answers no.
- With a flag off, none of that screen's v2 code loads, and with it on, none of the legacy screen's code loads.
- Lifecycle, per screen (ENG-99): off in stable; on in nightly once the screen meets its budgets; then default-on in stable; one release later the legacy screen and its flag are deleted in the same change. A flag is never left behind.
- Settings decoding accepts unknown flags, so an older client survives settings written by a newer one.

### Motion and icons

- v2 code animates only through the named presets in `next/motion`, which apply MotionPolicy (Full, Reduced, Off). No hand-written keyframes or durations. Entrances are opt-in with `data-enter`; mounting alone never animates.
- Only `transform` and `opacity` animate. The named exceptions are `checkDraw` (stroke-dashoffset on small checks) and `iconSwap` (scale down to 0.6 on icons of 20 px or less). Never animate width, height, position, margin, padding, border width, box-shadow or blur radius; height changes and reorders go through the `layout` preset.
- `motion` is the default engine. `gsap` is only for authored timelines (launch, onboarding, celebrations): it arrives with the launch sequence (E04-T16) through the one runner module the lint allows in `next/motion/cinematic/`, loads lazily, stays off the chat critical path and always runs under MotionPolicy. `apps/marketing` may load it lazily too. Anime.js stays behind the legacy `apps/web/src/lib/motion.ts` until its last caller is deleted. The `e6code/no-animation-library-imports` lint rule enforces where each engine may be imported (ENG-110). ScrollTrigger, SplitText and MorphSVG in the app need their own decision.
- v2 icons come only from `next/icons` (ENG-87): Phosphor artwork generated into named components (`<IconChevronDown />`) for static use, and `<Icon name>` only for dynamic names such as saved project icons and palette entries; `@phosphor-icons/react` is not used at runtime. Regular weight at rest, fill when selected or active, bold at 12 to 14 px, duotone for empty states. Semantic names live in `packages/design-tokens/src/icons`. `next/**` never imports an icon library directly.

### Budgets

v2 screens and server changes are measured against the budgets approved in ENG-124. Reference machines are a 2023 Apple Silicon laptop and a 4-core Linux CI runner; the remote profile is 60 ms round trip at 20 Mbps; latencies are p95 unless stated.

- Startup: desktop cold start to first themed paint ≤ 300 ms after process start, to interactive from cache ≤ 1.2 s, to live (backend ready) ≤ 3.0 s excluding provider probes; web first paint on a local server ≤ 500 ms; web interactive on the remote profile ≤ 2.5 s cold, ≤ 1.0 s warm (HTTP cache plus IndexedDB).
- Interaction: thread switch to first rows ≤ 100 ms from cache, ≤ 400 ms to live-synced; keystroke to paint ≤ 32 ms during a 50 events/s stream, with no long task over 50 ms; a 1,000-turn timeline scrolls with ≥ 99% of frames within 16.7 ms at 60 Hz and no long task over 50 ms.
- Resources: renderer JS heap ≤ 350 MB after an 8-hour replay soak with 50 threads, server RSS ≤ 500 MB, and no monotonic growth; server event-loop delay ≤ 20 ms p99 during the streaming scenario; command acknowledgement ≤ 10 ms (the existing `orchestrationCommandAckDuration` metric).
- Deterministic budgets block PRs once the E05-T06 (ENG-145) gates exist: no live WebSocket frame over 256 KiB, live event p95 ≤ 4 KiB before compression, streaming ≤ 30 KB/s per client per active thread on the wire; entry plus chat route ≤ 350 KB brotli JS, any other route ≤ 150 KB more, boot script evaluation ≤ 150 ms. Provider snapshot frames already exceed the frame budget (449 KB); task E05-T12, in the Linear document "Pending tasks · E05", fixes them before that gate blocks. Timing budgets run nightly on a dedicated runner, are compared with a rolling baseline, and open an issue on a regression above 15%.
- Measure today with Settings > Diagnostics > Server Performance and the `metrics-snapshot` trace records (`docs/operations/observability.md`), the desktop startup record in `<home>/userdata/logs/desktop-startup.ndjson`, `apps/server/integration/TransferBudget*.integration.ts`, and the provider replay recordings (`docs/operations/development.md`). The web harness arrives with E05-T02 (ENG-128).
- Until a gate covers a budget, report the numbers you measured and how, or name the budgets you could not measure and why. Measuring never overrides [Verifying](#verifying): a subagent that needs a running client asks the primary agent.

### Non-negotiables

- Persisted events stay decodable forever. Event schemas change only by adding optional fields; event-log compaction (ENG-98) is versioned, runs only after a turn completes, and waits for the upgrade-fixture corpus (E04-T08).
- SQLite migrations are additive and forward-only, and finish before the server reports `prepared`.
- The wire stays compatible with clients from the last three releases: new members are optional or behind a capability flag the client sends (ENG-95).
- Auth, pairing, DPoP, WebSocket tickets, cookie-origin rules, the relay and its link proofs, the launcher's update trial and desktop updates are out of scope for the UI rewrite. v2 screens call the same `client-runtime` services; `/pair` and `/connect` move last.
- The provider adapter test suites are the behavioural spec for providers.
- An Effect upgrade is its own PR, never mixed with a screen rewrite.

### Agent team

Five roles do the remodel, defined in `.claude/agents/remodel-*.md`: program manager, feature planner, screen designer, implementer and validator (ENG-105).

- The program manager is the only agent that edits the Linear project's structure: phases, epics, priorities and dependencies.
- Each screen task gets one feature planner and one screen designer. Planning and design for several tasks may run in parallel.
- Implementers run in parallel only on tasks the ownership map (E04-T05) shows as file-disjoint, and at most three at once. The limit is raised once the CI performance gates (E05-T06) have caught a regression.
- The validator is always a different agent from the task's implementer.
- Real-client verification follows [Verifying](#verifying): the primary agent, after integration, with the maintainer's permission.

### Taste Skill

The Taste Skill (`design-taste-frontend`) is used as decided in ENG-116:

- App screens: advisory review only, never generation. After a redesign is built, a reviewer may read it against the skill's checklist (version 2.5.1, `SKILL.md` section 5, "Checklist") where that checklist fits app UI: contrast, focus, hover and press feedback, tap size. No skill scripts run on the app, its page rules do not apply, and review notes stay outside the worktree. Looking at the running screen follows [Verifying](#verifying).
- Its findings are advisory. The design direction and these rules win: Iris stays the `primary` accent and nothing moves at idle. It never generates the app shell, sidebar, timeline or composer.
- `apps/marketing`: it drives the design. Keep the palette and type (Iris is allowed), pin what it deals so a pass is reproducible, and use only safely licensed pictures, each credited. Its checker and screenshot scripts launch Chrome, so each run needs the maintainer's agreement, as in [Verifying](#verifying).
- ENG-116 recorded review flags (`--app`, `--keep palette,type`, `--allow palette-purple`, a pinned `--direction`) from the skill's 2.1.x tools, which version 2.5.0 removed. How app review runs now is open for the maintainer; until then, use the checklist read above.

### v2 screen PR checklist

A PR that adds or changes a v2 screen answers each item in its description:

- [ ] **Budgets met.** The screen's budgets from [Budgets](#budgets), with the numbers and how they were measured, or which could not be measured yet and why.
- [ ] **Entry points covered.** Every entry point and reverse state from [Hit every surface](#hit-every-surface).
- [ ] **Mobile view model shared.** Presentation logic mobile needs is in `client-runtime`, or the PR says "mobile not changed in this task".
- [ ] **Legacy flag plan.** The screen's flag, its lifecycle stage, and the task that deletes the legacy screen and the flag.

The design review checklist (Design direction, section 9) joins this one with E06-T05 (ENG-113).

## Taste

- Complexity belongs at the adapter boundary. Orchestration stays pure, UI stays dumb.
- Inferred types over annotations. `any` is the enemy.
- Comments describe how a thing is used, and move when the code moves. To be used mostly to describe functions, not to annotate every line of behavior.
- People using E6 Code will notice dropped frames, lying spinners, and stale labels. Nothing moves at idle: every animation ends, or is stepped and tied to a live turn, or is the ambient canvas on an allowed screen. Continuous repaints peg the GPU on high-refresh displays.
- What that allows: the live-mark breath (opacity stepped from 1 to 0.55 and back over 2.4 s in 6 steps, compositor-only, only while a turn runs in the focused, visible window at Full motion, stopping on turn end, blur or hide); the live ambient canvas, only on welcome and onboarding, pairing and the marketing hero, never behind a work surface, and paused when hidden, blurred, off-screen, after 10 s without input, below Full or while the focused thread streams; and continuous effects in the launch for at most 2.5 s, each with its reason and budget stated in the launch design. The launch's authored choreography stays within its own 900 ms cap.
- Color goes through the semantic roles in `packages/design-tokens` and `apps/web/src/index.css`, never hard-coded Tailwind palette colors. The `@design-tokens` blocks in `index.css` are generated from the package; change the package, not those blocks. Built-in themes and mobile follow those roles; a raw `blue-500` follows nothing.
- `primary` (Iris in the stock palette) means the next action or a live agent. Do not use it for decoration or headings. Text on a `primary` fill uses `primary-foreground`, never a hard-coded white. Text and icons coloured as the accent use `text-primary-text`, and selected outlines use `primary-edge`: those roles stay readable on every ground, while a theme's raw `primary` may not.
- Never show a status by color alone. Pair every status dot or tint with a word or an icon.
- One key light per view: the brightest element is the live agent, the pending decision or the primary next action, and a decision outranks a live agent. At most one key-light wash and one attention wash are lit at once.
- Surfaces sit on five planes (ground, stage, raised, floating, overlay) through the `--plane-*` and `--elev-*` tokens and the `next/ui` primitives. Shadows come only from the `--elev-*` tokens; never animate `box-shadow`, fade the layer that carries the shadow instead; blur is only a static material on floating planes smaller than a quarter of the viewport.
- Instant where the hands are (Design direction 3.10): typing, caret, selection, IME and the composer resizing as you type; scrolling, with no smooth-scroll hijack and no scroll-linked effect in the app; keyboard navigation; the content of thread, tab and settings switches, where route changes are cuts; terminal output, diff scrolling and the file tree; dragging and resizing follow the pointer 1:1 and only the drop settles; toggles apply at once; remote actions animate from local state without waiting on the server.
- If a rule here fights the task in front of you, say so loudly and get a human sign-off before breaking it.

## Additional tips

- Don't verify with browsers or computer use unless the user explicitly agrees or requests it.
- Security is important, but should not be over-indexed on, especially for dev mode/maintainer-only features.
