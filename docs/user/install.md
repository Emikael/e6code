# Install E6 Code

E6 Code runs coding agents on your computer and lets you control them from its
desktop, web, or mobile app. Set up the machine where the agents will work first.

## Requirements

You need an installed, authenticated provider before starting a thread. You can
launch E6 Code and configure providers afterwards.

## Command line

```bash
curl -fsSL https://e6code.com/install.sh | sh
```

On Windows, in PowerShell:

```powershell
irm https://e6code.com/install.ps1 | iex
```

This puts `e6` in `~/.local/bin`. If your shell reports `command not found`
afterwards, that directory is not on your `PATH` yet; the installer prints the
line to add. Set `E6CODE_CHANNEL=nightly` to install the nightly train, or
`E6CODE_VERSION` to pin an exact version.

| Task                                             | Command                                                   |
| ------------------------------------------------ | --------------------------------------------------------- |
| Start the server and open the web app            | `e6`                                                      |
| Start the server without a browser               | `e6 serve`                                                |
| Keep it running in the background (macOS, Linux) | `e6 service install` ([details](./background-service.md)) |
| Move to the newest release                       | `e6 update`                                               |
| Remove it again                                  | `e6 uninstall`                                            |

Run `e6 --help` for the full reference.

To try E6 Code once without installing it, run `npx e6@latest` instead (needs
Node.js for `npx`).

### Intel Macs

There is no `e6` executable for Intel Macs (the desktop app is available). To
run a server there, build it from source with Node.js 24 and `vp`
([Install vp](https://github.com/emikael/e6code#install-vp)):

```bash
git clone https://github.com/emikael/e6code
cd e6code && vp i && vp run build:desktop
node apps/server/dist/bin.mjs
```

`e6 update` and the background service do not apply to a server run this way;
update it with `git pull` and a rebuild.

## Desktop app

Download a release from [GitHub Releases](https://github.com/emikael/e6code/releases),
or use a package manager:

| Platform           | Install                         |
| ------------------ | ------------------------------- |
| Windows            | `winget install E6Tools.E6Code` |
| macOS              | `brew install --cask e6-code`   |
| Arch Linux         | `yay -S e6code-bin`             |
| Arch Linux nightly | `yay -S e6code-nightly-bin`     |

### Windows Subsystem for Linux

Choose a WSL distro in **Settings → Connections** to run agents and projects
there. Install the provider CLIs inside that distro. E6 Code installs its own
server runtime there automatically; the first launch after an app update can
take longer.

### Open a project from a terminal

With the desktop app already running on the same machine:

```bash
e6 app
```

This opens a new thread for the current directory, adding the project if needed.
Pass a path, such as `e6 app ../my-project`, to open another directory. It requires
the desktop app, so a standalone server or an SSH session is not enough. If the
command cannot reach the app, start or update the desktop app and try again.

## Mobile app

Install E6 Code from the
[App Store](https://apps.apple.com/us/app/e6-code-remote-claude-more/id6787819824) or
[Google Play](https://play.google.com/store/apps/details?id=com.e6tools.e6code).
The phone connects to a server on another machine. Follow
[remote access](./remote-access.md) to link it through E6 Connect or a pairing URL.

If the app crashes during launch, open Settings → Diagnostics on the next launch
that succeeds. It lists startup crashes from the last 7 days with the error and
component stack that store crash reports leave out. Copy the report and paste it
into a GitHub issue. Error messages can quote values from the app, so read it over
before sharing.

## Providers

Open **Settings → Providers** in the web or desktop app, select the environment,
and enable the provider you want. Installation, login, and configuration belong
to that environment's machine, even when you connect from a phone or another
computer.

| Provider    | Install and authenticate                                                                     |
| ----------- | -------------------------------------------------------------------------------------------- |
| Codex       | Install [Codex CLI](https://developers.openai.com/codex/cli), then run `codex login`.        |
| Claude      | Install [Claude Code](https://claude.com/product/claude-code), then run `claude auth login`. |
| Cursor      | Install [Cursor CLI](https://cursor.com/cli), then run `agent login`.                        |
| Grok Build  | Install [Grok Build CLI](https://x.ai/cli), then run `grok login`.                           |
| OpenCode    | Install [OpenCode](https://opencode.ai), then run `opencode auth login`.                     |
| Antigravity | Install and sign in with Google from E6 Code's provider settings.                            |

Provider CLIs must be on the server's `PATH`. If E6 Code cannot find one, set its
**Binary path** in provider settings, especially when using a version manager.
Cursor's executable is `cursor-agent`, although its login command is
`agent login`. Antigravity can use its managed runtime without a `PATH` entry.

When a provider CLI is behind its latest release, its provider card shows the
available version. **Update now** appears only when E6 Code can tell which
installer owns the CLI (its own update command, Homebrew, or a global npm, pnpm,
bun, or Vite+ install) and runs that installer. Otherwise update the CLI the same
way you installed it. Homebrew installs compare against the version Homebrew
offers, which can trail the npm release by a few hours.

Add another provider instance for a separate account or configuration. Each
instance can have its own environment variables, such as API keys or a custom
base URL. Mark secret values as sensitive; after saving, E6 Code does not display
their original values.

For provider-specific setup and accounts, see [Codex](./providers-codex.md),
[Claude](./providers-claude.md), [OpenCode](./providers-opencode.md), and
[Antigravity](./providers-antigravity.md).

## Next steps

- [Working with threads](./thread-sidebar.md): start tasks and organize parallel work.
- [Permission modes](./permission-modes.md): choose when agents ask before acting.
- [Remote access](./remote-access.md): connect from another device.
- [Running in the background](./background-service.md): keep a Linux or macOS host available.
- [Updating E6 Code](./updating.md): update the app and connected servers.
