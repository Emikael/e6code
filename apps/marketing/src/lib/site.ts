export const GITHUB_REPOSITORY_URL = "https://github.com/Emikael/e6code";

/** The page description, social card text and structured data share it. No ADHD wording. */
export const SITE_DESCRIPTION =
  "Open-source app for running coding agents in parallel. Use Claude Code, Codex, Cursor, Grok Build, OpenCode and Antigravity with the subscriptions you already have.";

/** Proposals go to Ideas discussions, per CONTRIBUTING.md. */
export const IDEAS_DISCUSSIONS_URL = `${GITHUB_REPOSITORY_URL}/discussions/categories/ideas`;

export const SECURITY_REPORT_URL = `${GITHUB_REPOSITORY_URL}/security/advisories/new`;

export const IOS_APP_STORE_URL =
  "https://apps.apple.com/us/app/e6-code-remote-claude-more/id6787819824";

export const ANDROID_PLAY_STORE_URL =
  "https://play.google.com/store/apps/details?id=com.e6tools.e6code";

/** What a phone visitor shares to their computer: the page with every desktop build. */
export const DESKTOP_LINK_URL = "https://e6code.com/download";

export const INSTALL_COMMANDS = {
  unix: "curl -fsSL https://e6code.com/install.sh | sh",
  windows: "irm https://e6code.com/install.ps1 | iex",
} as const;
