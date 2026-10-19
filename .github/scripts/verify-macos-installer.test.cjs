const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const test = require("node:test");

// Run the real shell gate with stand-ins for Apple's platform tools. These
// tests prove failed assessments stop validation and mounted images are detached.
function verify(t, failure = "", appCount = 1) {
  const root = mkdtempSync(path.join(tmpdir(), "e6-installer-gate-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = path.join(root, "bin");
  mkdirSync(bin);
  const log = path.join(root, "commands.log");
  writeFileSync(log, "");
  const shim = `#!/usr/bin/env bash
set -eu
name="$(basename "$0")"
echo "$name $*" >> "$COMMAND_LOG"
case "$name" in
  xcrun)
    if [[ "$3" == *.dmg && "$FAILURE" == dmg-ticket ]]; then exit 1; fi
    if [[ "$3" == *.app && "$FAILURE" == app-ticket ]]; then exit 1; fi
    ;;
  hdiutil)
    if [[ "$1" == attach ]]; then
      mountpoint=""
      while [[ $# -gt 0 ]]; do
        if [[ "$1" == -mountpoint ]]; then mountpoint="$2"; break; fi
        shift
      done
      for ((i=0; i<APP_COUNT; i++)); do mkdir "$mountpoint/E6 Code $i.app"; done
    else
      rm -rf "$2"/*.app
    fi
    ;;
  codesign)
    if [[ "$1" == --verify && "$FAILURE" == signature ]]; then exit 1; fi
    if [[ "$1" == --display ]]; then
      if [[ "$FAILURE" == runtime ]]; then
        echo 'CodeDirectory v=20500 size=123 flags=0x0(none)' >&2
      else
        echo 'CodeDirectory v=20500 size=123 flags=0x10000(runtime)' >&2
      fi
    fi
    ;;
  spctl)
    if [[ "$FAILURE" == gatekeeper ]]; then exit 1; fi
    ;;
esac
`;
  for (const name of ["xcrun", "hdiutil", "codesign", "spctl"]) {
    writeFileSync(path.join(bin, name), shim, { mode: 0o755 });
  }
  const dmg = path.join(root, "E6 Code.dmg");
  writeFileSync(dmg, "fixture");
  const result = spawnSync(
    "bash",
    [path.join(__dirname, "verify-macos-installer.sh"), dmg, "JC6WK5QTW5"],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        TMPDIR: root,
        COMMAND_LOG: log,
        FAILURE: failure,
        APP_COUNT: String(appCount),
      },
    },
  );
  return { ...result, commands: readFileSync(log, "utf8") };
}

test("accepts an installer only after all assessments pass and detaches it", (t) => {
  const result = verify(t);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.commands, /spctl --assess --type execute/);
  assert.match(result.commands, /hdiutil detach/);
});

for (const failure of ["dmg-ticket", "signature", "runtime", "app-ticket", "gatekeeper"]) {
  test(`rejects a failed ${failure} assessment`, (t) => {
    const result = verify(t, failure);
    assert.notEqual(result.status, 0);
    if (failure === "dmg-ticket") {
      assert.doesNotMatch(result.commands, /hdiutil attach/);
    } else {
      assert.match(result.commands, /hdiutil detach/);
    }
    if (failure !== "gatekeeper") {
      assert.doesNotMatch(result.commands, /spctl --assess/);
    }
  });
}

for (const appCount of [0, 2]) {
  test(`rejects an installer containing ${appCount} apps and detaches it`, (t) => {
    const result = verify(t, "", appCount);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Expected exactly one app/);
    assert.doesNotMatch(result.commands, /codesign/);
    assert.match(result.commands, /hdiutil detach/);
  });
}
