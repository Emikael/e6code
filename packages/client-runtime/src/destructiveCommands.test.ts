import { describe, expect, it } from "vite-plus/test";

import { classifyDestructiveApproval, classifyDestructiveCommand } from "./destructiveCommands.ts";

const reasonOf = (command: string) => classifyDestructiveCommand(command)?.reason ?? null;

describe("classifyDestructiveCommand", () => {
  it.each([
    ["rm -rf /", "Deletes files recursively"],
    ["rm -fr ~", "Deletes files recursively"],
    ["rm -Rf ~/", "Deletes files recursively"],
    ["rm -r -f $HOME", "Deletes files recursively"],
    ["rm --recursive --force .", "Deletes files recursively"],
    ["rm -rf *", "Deletes files recursively"],
    ["rm -rf ../*", "Deletes files recursively"],
    ["rm -rf /usr/", "Deletes files recursively"],
    ["rm -rf --no-preserve-root /tmp/x", "Deletes files recursively"],
    ["sudo rm -rf /", "Deletes files recursively"],
    ["sudo -u root rm -rf /etc", "Deletes files recursively"],
    ["cd repo && rm -rf .", "Deletes files recursively"],
    ["bash -c 'rm -rf ~'", "Deletes files recursively"],
    ["git push --force origin main", "Rewrites remote history"],
    ["git push -f origin master", "Rewrites remote history"],
    ["git push --force-with-lease origin release/2.0", "Rewrites remote history"],
    ["git push origin +main", "Rewrites remote history"],
    ["git push --force origin HEAD:refs/heads/main", "Rewrites remote history"],
    ["git -C app push -f origin trunk", "Rewrites remote history"],
    ["git push --mirror --force origin", "Rewrites remote history"],
    ["git reset --hard HEAD~3", "Discards local changes"],
    ["git clean -fdx", "Deletes untracked and ignored files"],
    ["git clean -xdf", "Deletes untracked and ignored files"],
    ['psql -c "DROP TABLE users"', "Drops a database table"],
    ["mysql -e 'drop database prod'", "Drops a database"],
    ["mkfs.ext4 /dev/sdb1", "Formats a disk"],
    ["dd if=/dev/zero of=/dev/sda bs=1M", "Overwrites a disk device"],
    ["chmod -R 777 /", "Opens permissions on every file"],
    [":(){ :|:& };:", "Starts a fork bomb that can freeze the machine"],
  ])("flags %s", (command, reason) => {
    expect(reasonOf(command)).toBe(reason);
  });

  it.each([
    "rm -rf dist",
    "rm -rf apps/web/dist .turbo",
    "rm -rf ./node_modules",
    "rm -f /tmp/build.log",
    "rm ~/notes.txt",
    "git push origin main",
    "git push -f origin feature/login",
    "git push --force-with-lease",
    "git reset --soft HEAD~1",
    "git reset HEAD file.ts",
    "git clean -n -x",
    "git clean -fd",
    'echo "drop table users"',
    'grep -r "rm -rf /" docs',
    "chmod -R 755 /",
    "chmod 777 script.sh",
    "dd if=/dev/sda of=disk.img",
    "vp test run",
    "ls -la /",
  ])("leaves %s alone", (command) => {
    expect(reasonOf(command)).toBeNull();
  });
});

describe("classifyDestructiveApproval", () => {
  it("reads the command out of a Claude-style tool detail", () => {
    expect(
      classifyDestructiveApproval({
        requestKind: "command",
        detail: "Bash: git push -f origin main",
      }),
    ).toEqual({ reason: "Rewrites remote history" });
  });

  it("only classifies requests that run commands", () => {
    expect(classifyDestructiveApproval({ requestKind: "file-change", detail: "rm -rf /" })).toBe(
      null,
    );
    expect(classifyDestructiveApproval({ requestKind: "command" })).toBeNull();
  });
});
