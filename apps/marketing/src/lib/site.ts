export const GITHUB_REPOSITORY_URL = "https://github.com/emikael/e6code";

export const SECURITY_REPORT_URL = `${GITHUB_REPOSITORY_URL}/security/advisories/new`;

export const IOS_APP_STORE_URL =
  "https://apps.apple.com/us/app/e6-code-remote-claude-more/id6787819824";

export const ANDROID_PLAY_STORE_URL =
  "https://play.google.com/store/apps/details?id=com.e6tools.e6code";

export const INSTALL_COMMANDS = {
  unix: "curl -fsSL https://e6.codes/install.sh | sh",
  windows: "irm https://e6.codes/install.ps1 | iex",
} as const;
