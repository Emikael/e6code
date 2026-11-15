# Remodel backlog: tasks waiting for a Linear issue

This folder is temporary. It holds the part of the E6 Code Remodel backlog that could not be
created as Linear issues because the workspace reached its issue limit: 94 tasks and
6 epic descriptions. Everything else (275 issues, the roadmap, the design direction,
the architecture decisions and the screen galleries) lives in the Linear project
[E6 Code Remodel](https://linear.app/elomigroup/project/e6-code-remodel-aa5e22bf8b24).

The maintainer approved keeping these files in the repository as an exception to the rule in
`AGENTS.md` against committing plans. The exception covers this folder only and ends when the
folder is empty.

## How to use a file

Each file is one task, written to be handed to an agent on its own. The front matter carries what
a Linear issue would carry:

- `linear_title`, `labels`, `priority`, `milestone`: the issue fields.
- `parent`: the epic. An identifier such as `ENG-315` means the epic issue exists in Linear;
  "pending, in this folder" means its description is the `EPIC.md` next to the task.
- `blocked_by`: tasks that must land first, with their Linear identifier when they have one.
- `size`: S, M, L or XL. `sources`: ids in the inventory documents of the Linear project
  (`02:S-8` is entry `S-8` of "Inventory 02").
- `linear_documents`: the same text as a Linear document, where the screenshots render.

The body uses Linear's Markdown, so it can be pasted into an issue unchanged. `+++ Agent notes`
to `+++` is Linear's collapsible section.

Screenshots are links to files stored in Linear. They need a Linear sign-in, so they do not
render on GitHub. Open the linked Linear document to see them, or have an agent with the Linear
connector pass the Markdown to its image tool. The images were not committed, to keep about
250 MB of PNGs out of the repository's history.

## When a file leaves this folder

- **The task is filed in Linear.** Create the issue from the front matter and body (state
  Backlog, parent set, then the `blocked_by` relations), then delete the file in the same change
  and replace "pending, in this folder" with the new identifier in the files that name it.
- **The task is implemented and validated.** Delete the file in the pull request that completes
  the work. Task pull requests target the `remodel` branch, where this folder lives.

Delete an `EPIC.md` when its epic issue exists in Linear or its last task is gone. Delete the
folder, and this exception, with the last file. Do not add new planning material here: new tasks
go to Linear.

## Index

### E14 · Composer

M2 · Thread experience; epic issue ENG-315.

| Task                                                                     | Kind          | Priority | Size | Blocked by                                                                                            |
| ------------------------------------------------------------------------ | ------------- | -------- | ---- | ----------------------------------------------------------------------------------------------------- |
| [E14-T01](E14/E14-T01.md) Prompt editor and composer surface             | Foundation    | Urgent   | XL   | E13-T01 (ENG-262), E01-T03 (ENG-125), E02-T01 (ENG-110), E04-T05 (ENG-85), E05-T02 (ENG-128)          |
| [E14-T02](E14/E14-T02.md) Composer: mentions, slash commands and skills  | Functionality | Urgent   | L    | E14-T01, E37-T11 (ENG-46), E24-T13                                                                    |
| [E14-T03](E14/E14-T03.md) Attachments: drop, paste and upload            | Functionality | Urgent   | L    | E14-T01, E14-T06, E36-T04 (ENG-51), E37-T11 (ENG-46)                                                  |
| [E14-T04](E14/E14-T04.md) Context chips                                  | Functionality | High     | L    | E14-T01, E14-T06, E13-T07 (ENG-298), E13-T15 (ENG-313)                                                |
| [E14-T05](E14/E14-T05.md) Send pipeline                                  | Foundation    | Urgent   | XL   | E13-T01 (ENG-262), E14-T03, E14-T06, E37-T11 (ENG-46), E36-T01 (ENG-48)                               |
| [E14-T06](E14/E14-T06.md) Composer drafts persistence                    | Functionality | High     | XL   | E04-T03 (ENG-82), E04-T04 (ENG-83), E13-T01 (ENG-262), E05-T02 (ENG-128)                              |
| [E14-T07](E14/E14-T07.md) Prompt stash                                   | Functionality | Medium   | M    | E14-T01, E14-T03, E14-T06                                                                             |
| [E14-T08](E14/E14-T08.md) Prompt history recall and length validation    | Functionality | Medium   | S    | E14-T01, E13-T07 (ENG-298)                                                                            |
| [E14-T09](E14/E14-T09.md) Composer footer, resting mode and banner stack | Screen        | High     | M    | E14-T01, E15-T01 (ENG-319), E15-T02, E15-T08, E23-T01 (ENG-231), E12-T05 (ENG-311), E02-T03 (ENG-119) |
| [E14-T10](E14/E14-T10.md) Type-to-focus and global composer focus        | Functionality | Medium   | S    | E14-T01, E08-T04 (ENG-234), E01-T03 (ENG-125)                                                         |
| [E14-T11](E14/E14-T11.md) Voice input on web and desktop                 | Decision      | Low      | S    | E32-T05 (ENG-226)                                                                                     |

### E15 · Agent controls

M2 · Thread experience; epic issue ENG-316.

| Task                                                               | Kind          | Priority | Size | Blocked by                                                               |
| ------------------------------------------------------------------ | ------------- | -------- | ---- | ------------------------------------------------------------------------ |
| [E15-T02](E15/E15-T02.md) Effort and model traits                  | Screen        | Urgent   | M    | E15-T01 (ENG-319), E14-T06, E37-T11 (ENG-46), E26-T01                    |
| [E15-T03](E15/E15-T03.md) Context window meter and compaction      | Functionality | High     | M    | E37-T11 (ENG-46), E14-T05, E14-T09, E13-T09 (ENG-303), E27-T01           |
| [E15-T04](E15/E15-T04.md) Usage limits and handoff to a new thread | Functionality | High     | M    | E14-T05, E14-T09, E28-T02, E28-T04, E37-T11 (ENG-46), E32-T09 (ENG-272)  |
| [E15-T05](E15/E15-T05.md) Queue, steer and stop                    | Functionality | Urgent   | L    | E14-T05, E37-T11 (ENG-46), E13-T04 (ENG-292), E13-T13 (ENG-310), E25-T05 |
| [E15-T06](E15/E15-T06.md) Jev routing (System One pre-router)      | Decision      | Medium   | S    | E14-T05, E25-T04, E25-T05, E28-T01                                       |
| [E15-T07](E15/E15-T07.md) Codex feedback submission                | Functionality | Low      | S    | E14-T02, E14-T09, E37-T11 (ENG-46)                                       |
| [E15-T08](E15/E15-T08.md) Permission mode and plan mode            | Functionality | Urgent   | S    | E37-T11 (ENG-46), E14-T05, E14-T06, E25-T05, E25-T07                     |

### E16 · Approvals, questions, plans and revert

M2 · Thread experience; epic issue ENG-314.

| Task                                                                    | Kind          | Priority | Size | Blocked by                                                                                                                                                             |
| ----------------------------------------------------------------------- | ------------- | -------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [E16-T01](E16/E16-T01.md) Decision surface (replaces the frontier card) | Screen        | Urgent   | M    | E16-T02, E16-T03, E16-T04, E14-T01, E13-T05 (ENG-294), E13-T16 (ENG-317), E02-T01 (ENG-110), E02-T02 (ENG-114), E12-T04 (ENG-308), E09-T02 (ENG-250), E37-T11 (ENG-46) |
| [E16-T02](E16/E16-T02.md) Pending approval and hold-to-allow            | Functionality | Urgent   | M    | E14-T01, E14-T05, E37-T11 (ENG-46), E15-T08, E24-T08, E32-T06 (ENG-243)                                                                                                |
| [E16-T03](E16/E16-T03.md) Questions from the agent                      | Functionality | Urgent   | M    | E14-T01, E14-T03, E14-T05, E14-T06, E37-T11 (ENG-46), E32-T06 (ENG-243)                                                                                                |
| [E16-T04](E16/E16-T04.md) Plan follow-up and implement in new thread    | Functionality | High     | M    | E14-T05, E15-T08, E13-T10 (ENG-305), E37-T11 (ENG-46)                                                                                                                  |
| [E16-T05](E16/E16-T05.md) Revert and edit from here (checkpoint rewind) | Functionality | High     | M    | E14-T05, E14-T06, E13-T07 (ENG-298), E13-T10 (ENG-305), E18-T05 (ENG-219), E37-T11 (ENG-46), E09-T03 (ENG-276)                                                         |

### E20 · Terminal

M3 · Workspace panels; epic description in [`E20/EPIC.md`](E20/EPIC.md).

| Task                                                                 | Kind          | Priority | Size | Blocked by                          |
| -------------------------------------------------------------------- | ------------- | -------- | ---- | ----------------------------------- |
| [E20-T01](E20/E20-T01.md) Terminal drawer and panel surface          | Screen        | High     | L    | E17-T01 (ENG-167), E20-T02, E20-T04 |
| [E20-T02](E20/E20-T02.md) Ghostty terminal engine                    | Foundation    | High     | M    | E04-T01 (ENG-80), E39-T03 (ENG-65)  |
| [E20-T03](E20/E20-T03.md) Terminal selection, links and chat context | Functionality | Medium   | S    | E20-T01, E14-T04, E21-T09 (ENG-235) |
| [E20-T04](E20/E20-T04.md) Terminal manager (PTY) on the server       | Foundation    | High     | M    | E39-T03 (ENG-65), E36-T05 (ENG-52)  |

### E23 · Git workflow and project actions in the thread

M4 · Source control and pull requests; epic issue ENG-216.

| Task                                                                      | Kind          | Priority | Size | Blocked by                                                               |
| ------------------------------------------------------------------------- | ------------- | -------- | ---- | ------------------------------------------------------------------------ |
| [E23-T05](E23/E23-T05.md) Commit dialog                                   | Screen        | High     | S    | E23-T04 (ENG-273), E18-T03 (ENG-199), E23-T10                            |
| [E23-T06](E23/E23-T06.md) Default-branch protection                       | Functionality | High     | S    | E23-T04 (ENG-273)                                                        |
| [E23-T07](E23/E23-T07.md) Initialize Git and publish repository           | Screen        | Medium   | M    | E23-T04 (ENG-273), E25-T08, E24-T13                                      |
| [E23-T08](E23/E23-T08.md) Branch restore and PR thread dialogs            | Screen        | Medium   | S    | E23-T01 (ENG-231), E24-T10, E12-T02 (ENG-275)                            |
| [E23-T09](E23/E23-T09.md) Git VCS driver and status broadcaster           | Foundation    | High     | L    | E05-T02 (ENG-128), E36-T05 (ENG-52), E25-T12                             |
| [E23-T10](E23/E23-T10.md) Commit, PR and branch text generation           | Functionality | Medium   | M    | E37-T11 (ENG-46), E25-T08, E13-T17 (ENG-318)                             |
| [E23-T11](E23/E23-T11.md) Project actions: run, edit, import from e6.json | Functionality | High     | M    | E20-T01, E13-T12 (ENG-309), E25-T07, E03-T01 (ENG-87), E08-T04 (ENG-234) |

### E24 · Pull requests workspace

M4 · Source control and pull requests; epic issue ENG-215.

| Task                                                                      | Kind          | Priority | Size | Blocked by                                                                         |
| ------------------------------------------------------------------------- | ------------- | -------- | ---- | ---------------------------------------------------------------------------------- |
| [E24-T06](E24/E24-T06.md) PR review: comments and verdict                 | Functionality | Urgent   | L    | E24-T05 (ENG-269), E24-T13, E18-T04 (ENG-206)                                      |
| [E24-T07](E24/E24-T07.md) PR editing: title, labels, reviewers, reactions | Functionality | High     | L    | E24-T03 (ENG-252), E24-T13                                                         |
| [E24-T08](E24/E24-T08.md) Checks and merge actions                        | Functionality | Urgent   | XL   | E24-T03 (ENG-252), E24-T13, E24-T10, E29-T09, E08-T04 (ENG-234)                    |
| [E24-T09](E24/E24-T09.md) Stacked pull requests                           | Functionality | High     | M    | E24-T03 (ENG-252), E24-T08, E24-T13                                                |
| [E24-T10](E24/E24-T10.md) Agent handoffs from a PR                        | Functionality | High     | L    | E14-T04, E14-T06, E23-T03 (ENG-258), E24-T11, E18-T04 (ENG-206)                    |
| [E24-T11](E24/E24-T11.md) PR to thread linking                            | Functionality | High     | L    | E24-T13, E09-T03 (ENG-276), E33-T01 (ENG-210), E10-T01 (ENG-205), E36-T05 (ENG-52) |
| [E24-T12](E24/E24-T12.md) PR link routing and project assignment          | Functionality | Medium   | M    | E24-T03 (ENG-252), E17-T01 (ENG-167), E12-T03 (ENG-306), E25-T08                   |
| [E24-T13](E24/E24-T13.md) PR service, sync and host providers             | Foundation    | High     | XL   | E05-T02 (ENG-128), E36-T05 (ENG-52), E29-T09, E25-T08                              |

### E25 · Settings shell and system settings

M5 · Settings, connections, usage and theming; epic description in [`E25/EPIC.md`](E25/EPIC.md).

| Task                                                                 | Kind          | Priority | Size | Blocked by                                                                                                                                   |
| -------------------------------------------------------------------- | ------------- | -------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| [E25-T01](E25/E25-T01.md) Settings shell, navigation and search      | Screen        | Urgent   | L    | E04-T02 (ENG-81), E01-T03 (ENG-125), E01-T04 (ENG-129), E08-T01 (ENG-203), E08-T04 (ENG-234), E10-T01 (ENG-205), E02-T02 (ENG-114)           |
| [E25-T02](E25/E25-T02.md) Settings scope: machine, project, checkout | Functionality | Urgent   | XL   | E25-T04, E25-T03, E09-T06 (ENG-293), E29-T04, E29-T10, E04-T03 (ENG-82)                                                                      |
| [E25-T03](E25/E25-T03.md) Client settings persistence and sync       | Foundation    | High     | L    | E04-T03 (ENG-82), E04-T04 (ENG-83), E25-T04, E26-T01                                                                                         |
| [E25-T04](E25/E25-T04.md) Server settings service                    | Foundation    | High     | M    | E36-T06 (ENG-53), E29-T03                                                                                                                    |
| [E25-T05](E25/E25-T05.md) General settings                           | Screen        | High     | L    | E25-T01, E25-T02, E25-T03, E25-T12, E15-T01 (ENG-319), E15-T02, E15-T06, E30-T05 (ENG-71), E09-T10 (ENG-300), E37-T11 (ENG-46)               |
| [E25-T06](E25/E25-T06.md) Keybindings settings                       | Screen        | High     | L    | E25-T01, E25-T02, E08-T04 (ENG-234), E10-T01 (ENG-205), E01-T03 (ENG-125)                                                                    |
| [E25-T07](E25/E25-T07.md) Project settings and defaults              | Screen        | High     | M    | E25-T02, E11-T06 (ENG-304), E23-T11, E03-T01 (ENG-87), E15-T01 (ENG-319), E15-T02                                                            |
| [E25-T08](E25/E25-T08.md) Source control settings                    | Screen        | Medium   | M    | E25-T02, E25-T12, E23-T09, E23-T10                                                                                                           |
| [E25-T09](E25/E25-T09.md) Integrations: browser and devices          | Screen        | Medium   | L    | E21-T03 (ENG-186), E21-T04 (ENG-189), E21-T06 (ENG-204), E21-T07 (ENG-217), E21-T09 (ENG-235), E22-T01 (ENG-170), E22-T02 (ENG-175), E25-T02 |
| [E25-T10](E25/E25-T10.md) SnapShot settings and setup                | Screen        | Medium   | M    | E22-T04 (ENG-187), E22-T05 (ENG-190), E30-T08 (ENG-74), E02-T02 (ENG-114)                                                                    |
| [E25-T11](E25/E25-T11.md) Storage and worktree cleanup               | Screen        | Medium   | M    | E25-T02, E25-T04, E23-T02 (ENG-244), E36-T01 (ENG-48)                                                                                        |
| [E25-T12](E25/E25-T12.md) Background activity policy                 | Functionality | Medium   | M    | E25-T05, E27-T05, E25-T08, E30-T10 (ENG-76), E02-T02 (ENG-114)                                                                               |
| [E25-T13](E25/E25-T13.md) Archived threads                           | Screen        | Medium   | S    | E09-T03 (ENG-276), E12-T02 (ENG-275), E12-T03 (ENG-306), E25-T02                                                                             |
| [E25-T14](E25/E25-T14.md) Diagnostics and resource telemetry         | Screen        | Medium   | L    | E30-T10 (ENG-76), E38-T05 (ENG-60), E25-T02, E01-T05 (ENG-135)                                                                               |
| [E25-T15](E25/E25-T15.md) Open source licenses                       | Screen        | Low      | S    | E25-T01                                                                                                                                      |

### E26 · Theming and appearance

M5 · Settings, connections, usage and theming; epic description in [`E26/EPIC.md`](E26/EPIC.md).

| Task                                                             | Kind          | Priority | Size | Blocked by                                                                                                      |
| ---------------------------------------------------------------- | ------------- | -------- | ---- | --------------------------------------------------------------------------------------------------------------- |
| [E26-T01](E26/E26-T01.md) Appearance settings and runtime sync   | Screen        | High     | L    | E25-T01, E25-T03, E01-T06 (ENG-137), E01-T07 (ENG-141), E26-T02, E02-T06 (ENG-126), E02-T05 (ENG-123)           |
| [E26-T02](E26/E26-T02.md) Theme system: built-ins and halves     | Foundation    | High     | XL   | E01-T01 (ENG-118), E01-T06 (ENG-137), E01-T07 (ENG-141), E01-T11 (ENG-155), E30-T01 (ENG-67), E31-T06 (ENG-241) |
| [E26-T03](E26/E26-T03.md) Theme editor                           | Screen        | Medium   | L    | E26-T02, E01-T14 (ENG-165), E10-T03 (ENG-223)                                                                   |
| [E26-T04](E26/E26-T04.md) Theme import (JSON, VS Code, Open VSX) | Functionality | Medium   | M    | E26-T02, E26-T03                                                                                                |
| [E26-T05](E26/E26-T05.md) Environment-published themes           | Functionality | Medium   | M    | E26-T02, E36-T05 (ENG-52), E38-T01 (ENG-56)                                                                     |
| [E26-T06](E26/E26-T06.md) Typography and fonts                   | Functionality | Medium   | M    | E01-T12 (ENG-157), E01-T07 (ENG-141), E26-T01                                                                   |

### E27 · Providers and models

M5 · Settings, connections, usage and theming; epic description in [`E27/EPIC.md`](E27/EPIC.md).

| Task                                                                  | Kind          | Priority | Size | Blocked by                                                              |
| --------------------------------------------------------------------- | ------------- | -------- | ---- | ----------------------------------------------------------------------- |
| [E27-T01](E27/E27-T01.md) Provider instances                          | Screen        | Urgent   | L    | E25-T01, E25-T02, E37-T11 (ENG-46), E03-T02 (ENG-88)                    |
| [E27-T02](E27/E27-T02.md) Provider install, update and auth           | Functionality | High     | M    | E27-T01, E37-T11 (ENG-46), E12-T05 (ENG-311), E25-T12                   |
| [E27-T03](E27/E27-T03.md) Models: manifest, favourites, custom models | Functionality | High     | M    | E27-T01, E15-T01 (ENG-319), E37-T11 (ENG-46), E01-T20 (ENG-179)         |
| [E27-T04](E27/E27-T04.md) Antigravity setup and sign-in               | Functionality | Medium   | M    | E27-T01, E27-T02, E37-T09 (ENG-43), E37-T11 (ENG-46)                    |
| [E27-T05](E27/E27-T05.md) Provider status and health refresh          | Functionality | High     | M    | E27-T01, E25-T12, E37-T11 (ENG-46), E36-T05 (ENG-52), E01-T05 (ENG-135) |

### E28 · Usage and limits

M5 · Settings, connections, usage and theming; epic description in [`E28/EPIC.md`](E28/EPIC.md).

| Task                                                      | Kind          | Priority | Size | Blocked by                                                                                  |
| --------------------------------------------------------- | ------------- | -------- | ---- | ------------------------------------------------------------------------------------------- |
| [E28-T01](E28/E28-T01.md) Usage page                      | Screen        | High     | L    | E37-T11 (ENG-46), E36-T05 (ENG-52), E05-T01 (ENG-124), E01-T05 (ENG-135), E13-T09 (ENG-303) |
| [E28-T02](E28/E28-T02.md) Limits and pooled subscriptions | Screen        | High     | M    | E37-T11 (ENG-46), E28-T04, E15-T04, E27-T05, E12-T02 (ENG-275)                              |
| [E28-T03](E28/E28-T03.md) Custom model prices             | Screen        | Medium   | S    | E28-T01, E25-T02, E12-T02 (ENG-275)                                                         |
| [E28-T04](E28/E28-T04.md) Usage limit sources and hubs    | Functionality | Medium   | S    | E27-T01, E25-T04, E25-T12, E37-T11 (ENG-46)                                                 |

### E29 · Connections and remote access

M5 · Settings, connections, usage and theming; epic description in [`E29/EPIC.md`](E29/EPIC.md).

| Task                                                                       | Kind          | Priority | Size | Blocked by                                                              |
| -------------------------------------------------------------------------- | ------------- | -------- | ---- | ----------------------------------------------------------------------- |
| [E29-T01](E29/E29-T01.md) Connections settings and dialogs                 | Screen        | Urgent   | XL   | E25-T01, E29-T02, E29-T04, E29-T05, E30-T06 (ENG-72), E30-T07 (ENG-73)  |
| [E29-T02](E29/E29-T02.md) Pairing links and authorized clients             | Functionality | Urgent   | L    | E29-T03, E11-T02 (ENG-245), E29-T05                                     |
| [E29-T03](E29/E29-T03.md) Environment auth model and secrets               | Foundation    | Urgent   | XL   | E36-T04 (ENG-51), E36-T05 (ENG-52), E36-T06 (ENG-53)                    |
| [E29-T04](E29/E29-T04.md) Saved environments and local environment         | Functionality | High     | XL   | E04-T04 (ENG-83), E29-T10, E29-T03, E34-T03 (ENG-236), E30-T08 (ENG-74) |
| [E29-T05](E29/E29-T05.md) Tailscale and network access                     | Functionality | High     | M    | E30-T07 (ENG-73), E29-T03                                               |
| [E29-T06](E29/E29-T06.md) SSH environments                                 | Functionality | High     | L    | E29-T04, E30-T03 (ENG-69), E22-T02 (ENG-175)                            |
| [E29-T07](E29/E29-T07.md) E6 Connect account, relay and cloud environments | Functionality | High     | XL   | E29-T03, E29-T04, E34-T04 (ENG-248), E35-T01, E11-T01 (ENG-229)         |
| [E29-T08](E29/E29-T08.md) Load balancing across environments               | Functionality | Medium   | S    | E29-T04, E23-T01 (ENG-231)                                              |
| [E29-T09](E29/E29-T09.md) GitHub sharing between environments              | Functionality | Medium   | S    | E29-T04, E24-T13                                                        |
| [E29-T10](E29/E29-T10.md) Environment identity and machine descriptor      | Foundation    | Medium   | M    | E36-T03 (ENG-50)                                                        |

### E31 · Mobile shell, navigation and home

M7 · Mobile; epic issue ENG-184.

| Task                                                   | Kind          | Priority | Size | Blocked by                                                                                                     |
| ------------------------------------------------------ | ------------- | -------- | ---- | -------------------------------------------------------------------------------------------------------------- |
| [E31-T10](E31/E31-T10.md) Mobile OTA updates           | Functionality | Medium   | M    | E31-T09 (ENG-270), E35-T06, E34-T08, E04-T10 (ENG-95)                                                          |
| [E31-T11](E31/E31-T11.md) Android-specific platform UX | Functionality | Medium   | L    | E03-T07 (ENG-97), E03-T01 (ENG-87), E01-T03 (ENG-125), E01-T18 (ENG-174), E31-T06 (ENG-241), E02-T04 (ENG-122) |

### E34 · Mobile new task, connections and settings

M7 · Mobile; epic issue ENG-198.

| Task                                                                                  | Kind          | Priority | Size | Blocked by                                                              |
| ------------------------------------------------------------------------------------- | ------------- | -------- | ---- | ----------------------------------------------------------------------- |
| [E34-T06](E34/E34-T06.md) Mobile server settings pages                                | Screen        | Medium   | M    | E25-T04, E25-T01, E25-T02, E34-T05 (ENG-265), E15-T06                   |
| [E34-T07](E34/E34-T07.md) Mobile usage pages                                          | Screen        | Medium   | M    | E28-T01, E28-T02, E34-T05 (ENG-265)                                     |
| [E34-T08](E34/E34-T08.md) Mobile about, storage, diagnostics, licenses, legal         | Screen        | Low      | S    | E31-T10, E31-T09 (ENG-270), E35-T04                                     |
| [E34-T09](E34/E34-T09.md) Mobile project favicons, provider icons and machine symbols | Functionality | Medium   | S    | E03-T01 (ENG-87), E03-T02 (ENG-88), E03-T07 (ENG-97), E11-T06 (ENG-304) |

### E35 · Mobile native integrations and tooling

M7 · Mobile; epic issue ENG-271.

| Task                                                                                    | Kind          | Priority | Size | Blocked by                                                                                            |
| --------------------------------------------------------------------------------------- | ------------- | -------- | ---- | ----------------------------------------------------------------------------------------------------- |
| [E35-T01](E35/E35-T01.md) Agent awareness: push, Live Activities, ongoing notifications | Functionality | High     | XL   | E34-T04 (ENG-248), E34-T05 (ENG-265), E12-T04 (ENG-308), E29-T07, E31-T08 (ENG-260), E04-T10 (ENG-95) |
| [E35-T02](E35/E35-T02.md) Subscription usage widgets                                    | Functionality | Medium   | M    | E28-T02, E34-T07, E01-T18 (ENG-174)                                                                   |
| [E35-T03](E35/E35-T03.md) Share extension and incoming shares                           | Functionality | Medium   | L    | E34-T01 (ENG-207), E32-T03 (ENG-208), E31-T09 (ENG-270)                                               |
| [E35-T04](E35/E35-T04.md) Mobile observability and diagnostics                          | Foundation    | Medium   | S    | E38-T05 (ENG-60), E05-T02 (ENG-128), E34-T08                                                          |
| [E35-T05](E35/E35-T05.md) Showcase mode and store screenshots                           | Foundation    | Low      | M    | E06-T04 (ENG-111), E34-T03 (ENG-236), E33-T02 (ENG-224), E33-T04 (ENG-254)                            |
| [E35-T06](E35/E35-T06.md) Native dev workflow tooling                                   | Foundation    | Low      | S    | E39-T03 (ENG-65), E01-T01 (ENG-118)                                                                   |
