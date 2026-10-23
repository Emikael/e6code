#!/usr/bin/env bash
# One-time container setup, baked into prebuilds. Content-dependent work
# (dependency install, Chromium) lives in update-content.sh.
set -euo pipefail

# The Vite+ CLI is the repo task runner (vp i, vp run dev, vp test run).
# Download to a file first: a curl failure inside $( ) would yield an empty
# script and a false success. VP_NODE_MANAGER=no skips the installer's node
# shims; Node comes from the devcontainer feature. The VP_*_DIR group (set
# together, absolute) pins the install location instead of the installer's
# XDG platform defaults, which moved the binary from ~/.vite-plus/bin to
# ~/.local/share/vite-plus/bin between releases and would break the check
# below either way.
export VP_BIN_DIR="$HOME/.local/share/vite-plus/bin"
export VP_DATA_DIR="$HOME/.local/share/vite-plus"
export VP_CACHE_DIR="$HOME/.cache/vite-plus"
# vite.plus redirects to this script. Pin the bytes and the CLI version
# (the catalog's vite-plus, which CI's setup-vp installs). Update the
# sha256 when the installer script itself changes.
VP_VERSION=0.3.0
installer_sha256=6eaf139e16d45849bebc4a7de0dbc2992fd3b3a86a3f37bf7922b685f3a60d9e
installer=$(mktemp)
curl --proto '=https' --proto-redir '=https' --tlsv1.2 -fsSL https://viteplus.dev/install.sh -o "$installer"
echo "${installer_sha256}  ${installer}" | sha256sum -c -
VP_NODE_MANAGER=no VP_VERSION="$VP_VERSION" bash "$installer"
rm -f "$installer"

# Non-login lifecycle shells never source the profile the installer edits,
# so expose vp on the default PATH. test -x keeps a bad install loud.
test -x "$VP_BIN_DIR/vp"
sudo ln -sf "$VP_BIN_DIR/vp" /usr/local/bin/vp

# First-run terminal notice, rendered by the devcontainers base image.
sudo mkdir -p /usr/local/etc/vscode-dev-containers
sudo tee /usr/local/etc/vscode-dev-containers/first-run-notice.txt >/dev/null <<'EOF'
E6 Code devcontainer

  vp run dev            start server + web, then open the pairing URL it
                        prints (the bare forwarded port will not authenticate)
  cp .env.example .env  optional: enable E6 Connect cloud features
                        (public identifiers, not secrets)

Details: docs/internals/devcontainer.md
EOF
