import { describe, expect, it } from "@effect/vitest";

import type { ProviderReplayRecording, RecordingLine } from "./recording.ts";
import {
  findLeaks,
  RECORDING_EPOCH_MS,
  SCRUB_VERSION,
  scrubRecording,
  SECRET_PLACEHOLDER,
} from "./scrub.ts";

// Secret-shaped values are assembled at runtime so no literal in this file
// looks like a real credential to push protection or secret scanners.
const repeat = (character: string, count: number) => character.repeat(count);
const fake = {
  anthropic: ["sk", "ant", "api03", repeat("A", 32)].join("-"),
  github: `${"gh"}p_${repeat("b", 36)}`,
  aws: `${"AK"}IA${repeat("C", 16)}`,
  jwt: [`eyJ${repeat("d", 12)}`, `eyJ${repeat("e", 12)}`, repeat("f", 16)].join("."),
  pem: `-----BEGIN ${"PRIVATE"} KEY-----\n${repeat("g", 40)}\n-----END ${"PRIVATE"} KEY-----`,
  bearer: `Bearer ${repeat("h", 24)}`,
};

const workspace = "/Users/alice/scratch/e6-replay-sample";
const tempFile = "/private/var/folders/x1/abc123/T/e6-replay/out.txt";

function textEvent(eventId: string, delta: string, createdAt: string): RecordingLine {
  return {
    kind: "event",
    dt: 10,
    event: {
      eventId,
      provider: "codex",
      threadId: "thread-1",
      turnId: "turn-1",
      createdAt,
      type: "content.delta",
      payload: { streamKind: "assistant_text", delta },
    },
  } as unknown as RecordingLine;
}

function dirtyRecording(): ProviderReplayRecording {
  return {
    header: {
      kind: "header",
      format: "e6.provider-replay",
      version: 1,
      id: "dirty",
      provider: "codex",
      scenarios: ["tool-heavy"],
      source: "recorded",
    } as unknown as ProviderReplayRecording["header"],
    lines: [
      { kind: "step", dt: 0, on: "sendTurn", turnId: "turn-1", input: `Fix ${workspace}/src/a.ts` },
      {
        kind: "event",
        dt: 5,
        event: {
          eventId: "e1",
          provider: "codex",
          providerInstanceId: "codex_personal",
          threadId: "thread-1",
          createdAt: "2026-11-17T12:00:00.000Z",
          type: "item.started",
          itemId: "item-1",
          turnId: "turn-1",
          raw: { source: "codex.eventmsg", payload: { cwd: workspace } },
          providerRefs: { providerTurnId: "native-turn" },
          payload: {
            itemType: "command_execution",
            title: "Run tests",
            detail: `cd ${workspace} && npm test`,
            data: {
              env: { password: "hunter22", Authorization: "Basic xyz" },
              inputTokens: 3,
              changes: { [`${workspace}/src/a.ts`]: { kind: "update" } },
            },
          },
        },
      } as unknown as RecordingLine,
      textEvent(
        "e2",
        [
          `Home ${"/Users/alice"}/.codex/config.toml, temp ${tempFile}.`,
          `Mail alice.smith@corp.example.io or alice@example.com.`,
          `Host alices-macbook.local and node.tail1234.ts.net at 10.1.2.3, loopback 127.0.0.1.`,
          `Keys ${fake.anthropic} ${fake.github} ${fake.aws} ${fake.jwt} ${fake.bearer}.`,
          `OPENAI_API_KEY=${repeat("k", 20)} and https://bob:pw123456@git.example.com/x.`,
          `See https://example.com/cb?token=${repeat("t", 10)}&page=2.`,
          fake.pem,
          `Signed off by Alice Smith; banana stays; settings.local.json stays.`,
        ].join("\n"),
        "2026-11-17T12:00:01.500Z",
      ),
    ],
  };
}

const options = {
  workspaceRoots: [workspace],
  homeDirectories: ["/Users/alice"],
  identities: ["alice", "Alice Smith", "alices-macbook"],
};

function deltaText(recording: ProviderReplayRecording): string {
  const line = recording.lines[2];
  if (line?.kind !== "event" || line.event.type !== "content.delta") throw new Error("no delta");
  return line.event.payload.delta;
}

describe("scrubRecording", () => {
  it("replaces paths, identities, hosts, emails, addresses and secrets", () => {
    const text = deltaText(scrubRecording(dirtyRecording(), options));

    expect(text).toContain("Home /home/user/.codex/config.toml");
    expect(text).toContain("temp /tmp/e6-replay/e6-replay/out.txt");
    expect(text).toContain("Mail user@example.com or user@example.com.");
    expect(text).toContain("Host host.example and host.example at 192.0.2.1, loopback 127.0.0.1.");
    expect(text).toContain(`OPENAI_API_KEY=${SECRET_PLACEHOLDER}`);
    expect(text).toContain(`https://${SECRET_PLACEHOLDER}@git.example.com/x`);
    expect(text).toContain(`?token=${SECRET_PLACEHOLDER}&page=2`);
    expect(text).toContain("Signed off by user; banana stays; settings.local.json stays.");
    for (const secret of Object.values(fake)) expect(text).not.toContain(secret);
  });

  it("maps the sample project to /workspace/repo in steps and events", () => {
    const scrubbed = scrubRecording(dirtyRecording(), options);
    const [step, event] = scrubbed.lines;

    expect(step).toMatchObject({ input: "Fix /workspace/repo/src/a.ts" });
    expect(event).toMatchObject({
      event: { payload: { detail: "cd /workspace/repo && npm test" } },
    });
  });

  it("drops native payloads and instance routing, and redacts credential fields", () => {
    const scrubbed = scrubRecording(dirtyRecording(), options);
    const line = scrubbed.lines[1];
    if (line?.kind !== "event") throw new Error("expected event");

    expect(line.event).not.toHaveProperty("raw");
    expect(line.event).not.toHaveProperty("providerRefs");
    expect(line.event).not.toHaveProperty("providerInstanceId");
    expect(line.event).toMatchObject({
      payload: {
        data: {
          env: { password: SECRET_PLACEHOLDER, Authorization: SECRET_PLACEHOLDER },
          inputTokens: 3,
          changes: { "/workspace/repo/src/a.ts": { kind: "update" } },
        },
      },
    });
  });

  it("rebases timestamps onto the recording epoch and stamps the scrub version", () => {
    const scrubbed = scrubRecording(dirtyRecording(), options);
    const times = scrubbed.lines.flatMap((line) =>
      line.kind === "event" ? [Date.parse(line.event.createdAt)] : [],
    );

    expect(times).toEqual([RECORDING_EPOCH_MS, RECORDING_EPOCH_MS + 1_500]);
    expect(scrubbed.header.scrubVersion).toBe(SCRUB_VERSION);
  });

  it("is a fixed point", () => {
    const once = scrubRecording(dirtyRecording(), options);

    expect(scrubRecording(once, options)).toEqual(once);
  });
});

describe("credential fields", () => {
  const opaque = repeat("z", 24);
  const recording = (data: Record<string, unknown>): ProviderReplayRecording => ({
    header: { ...dirtyRecording().header, scrubVersion: SCRUB_VERSION },
    lines: [
      {
        kind: "event",
        dt: 0,
        event: {
          eventId: "e1",
          provider: "codex",
          threadId: "thread-1",
          createdAt: "2026-01-01T00:00:00.000Z",
          type: "item.completed",
          payload: { itemType: "dynamic_tool_call", data },
        },
      } as unknown as RecordingLine,
    ],
  });
  const credentials = {
    OPENAI_API_KEY: opaque,
    GITHUB_TOKEN: opaque,
    "X-Auth-Token": opaque,
    sessionToken: opaque,
    "set-cookie": [`session=${opaque}`],
    clientSecret: opaque,
    apiKeys: [opaque],
    credentials: { github: { user: "octo", value: opaque } },
    auth: { refresh: opaque, access: opaque },
  };
  const counters = {
    inputTokens: 12,
    totalTokens: 40,
    cacheKey: "parser-v2",
    tokenCount: 3,
    // Named like a credential, but an object of counts and labels.
    tokenUsage: { usageScope: "main_agent", usageStatus: "complete", inputTokens: 12 },
  };

  it("flags and redacts credentials under any key style, keeping counters", () => {
    const dirty = recording({ ...credentials, ...counters });

    expect(findLeaks(dirty).map((leak) => leak.path)).toEqual(
      Object.keys(credentials).map((key) => `event.payload.data.${key}`),
    );
    const scrubbed = scrubRecording(dirty);
    const line = scrubbed.lines[0];
    if (line?.kind !== "event") throw new Error("expected event");
    expect(line.event.payload).toEqual({
      itemType: "dynamic_tool_call",
      data: {
        OPENAI_API_KEY: SECRET_PLACEHOLDER,
        GITHUB_TOKEN: SECRET_PLACEHOLDER,
        "X-Auth-Token": SECRET_PLACEHOLDER,
        sessionToken: SECRET_PLACEHOLDER,
        "set-cookie": [SECRET_PLACEHOLDER],
        clientSecret: SECRET_PLACEHOLDER,
        apiKeys: [SECRET_PLACEHOLDER],
        credentials: { github: { user: SECRET_PLACEHOLDER, value: SECRET_PLACEHOLDER } },
        auth: { refresh: SECRET_PLACEHOLDER, access: SECRET_PLACEHOLDER },
        ...counters,
      },
    });
    expect(findLeaks(scrubbed)).toEqual([]);
  });

  it("redacts quoted and plain assignments in text but leaves type annotations", () => {
    const text = [
      `{"API_KEY": "${opaque}"}`,
      `curl -u admin --data password=${opaque} --data db_password=${opaque}`,
      `{"client_secret": "${opaque}", "max_tokens": "unbounded"}`,
      `x-api-key: ${opaque}`,
      "const token: string = read();",
    ].join("\n");
    const scrubbed = scrubRecording(recording({ text }));
    const line = scrubbed.lines[0];
    if (line?.kind !== "event" || line.event.type !== "item.completed") throw new Error("event");

    expect((line.event.payload.data as { text: string }).text).toBe(
      [
        `{"API_KEY": "${SECRET_PLACEHOLDER}"}`,
        `curl -u admin --data password=${SECRET_PLACEHOLDER} --data db_password=${SECRET_PLACEHOLDER}`,
        `{"client_secret": "${SECRET_PLACEHOLDER}", "max_tokens": "unbounded"}`,
        SECRET_PLACEHOLDER,
        "const token: string = read();",
      ].join("\n"),
    );
  });
});

describe("files outside the workspace", () => {
  const readEvent = (path: string): RecordingLine =>
    ({
      kind: "event",
      dt: 0,
      event: {
        eventId: "e1",
        provider: "cursor",
        threadId: "thread-1",
        createdAt: "2026-01-01T00:00:00.000Z",
        type: "item.completed",
        payload: {
          itemType: "dynamic_tool_call",
          status: "completed",
          title: "Read file",
          detail: path,
          data: { kind: "read", rawOutput: { content: "private notes from the home folder" } },
        },
      },
    }) as unknown as RecordingLine;
  const recordingOf = (path: string): ProviderReplayRecording => ({
    header: { ...dirtyRecording().header, scrubVersion: SCRUB_VERSION },
    lines: [readEvent(path)],
  });

  it("drops the data of tool items that touched the home folder, keeping the item", () => {
    const dirty = recordingOf("/Users/alice/.claude/skills/notes/SKILL.md");
    const scrubbed = scrubRecording(dirty, { homeDirectories: ["/Users/alice"] });
    const line = scrubbed.lines[0];
    if (line?.kind !== "event") throw new Error("expected event");

    expect(line.event.payload).toEqual({
      itemType: "dynamic_tool_call",
      status: "completed",
      title: "Read file",
      detail: "/home/user/.claude/skills/notes/SKILL.md",
      data: { omitted: "outside-workspace" },
    });
    expect(findLeaks(scrubbed)).toEqual([]);
    expect(scrubRecording(scrubbed)).toEqual(scrubbed);
  });

  it("flags kept home data and leaves workspace reads alone", () => {
    const kept = recordingOf("/home/user/.config/tool/settings.toml");
    const workspace = recordingOf("/workspace/repo/src/parse.js");

    expect(findLeaks(kept).map((leak) => leak.kind)).toEqual(["outside-workspace"]);
    expect(findLeaks(workspace)).toEqual([]);
    expect(scrubRecording(workspace).lines).toEqual(workspace.lines);
  });
});

describe("streamed text", () => {
  const deltaLine = (
    eventId: string,
    delta: string,
    fields: Record<string, unknown> = {},
  ): RecordingLine =>
    ({
      kind: "event",
      dt: 5,
      event: {
        eventId,
        provider: "codex",
        threadId: "thread-1",
        turnId: "turn-1",
        itemId: "msg-1",
        createdAt: "2026-01-01T00:00:00.000Z",
        type: "content.delta",
        payload: { streamKind: "assistant_text", delta },
        ...fields,
      },
    }) as unknown as RecordingLine;
  const itemLine = (type: string, payload: Record<string, unknown>): RecordingLine =>
    ({
      kind: "event",
      dt: 5,
      event: {
        eventId: `${type}-1`,
        provider: "codex",
        threadId: "thread-1",
        turnId: "turn-1",
        itemId: "cmd-1",
        createdAt: "2026-01-01T00:00:00.000Z",
        type,
        payload,
      },
    }) as unknown as RecordingLine;
  const recordingOf = (...lines: Array<RecordingLine>): ProviderReplayRecording => ({
    header: { ...dirtyRecording().header, scrubVersion: SCRUB_VERSION },
    lines,
  });
  const textOf = (recording: ProviderReplayRecording, streamKind = "assistant_text") =>
    recording.lines
      .flatMap((line) =>
        line.kind === "event" &&
        line.event.type === "content.delta" &&
        line.event.payload.streamKind === streamKind
          ? [line.event.payload.delta]
          : [],
      )
      .join("");

  // A path and a name split across chunks, the way providers stream them.
  const split = recordingOf(
    ...[
      "See [parse.js](/Us",
      "ers/al",
      "ice/scr",
      "atch/e6-replay-sample/src/parse.js), ",
      "as al",
      "ice noted.",
    ].map((delta, index) => deltaLine(`e${index}`, delta)),
  );
  const options = {
    workspaceRoots: ["/Users/alice/scratch/e6-replay-sample"],
    homeDirectories: ["/Users/alice"],
    identities: ["alice"],
  };

  it("finds what is split across chunks and scrubs the joined text", () => {
    expect(findLeaks(split, { identities: ["alice"] }).map((leak) => leak.kind)).toEqual([
      "home-path",
      "identity",
    ]);
    const scrubbed = scrubRecording(split, options);

    expect(scrubbed.lines).toHaveLength(split.lines.length);
    expect(textOf(scrubbed)).toBe("See [parse.js](/workspace/repo/src/parse.js), as user noted.");
    expect(findLeaks(scrubbed, { identities: ["alice"] })).toEqual([]);
    expect(scrubRecording(scrubbed, options)).toEqual(scrubbed);
  });

  it("keeps a stream's chunks when nothing in it changes", () => {
    const clean = recordingOf(deltaLine("e1", "Hello "), deltaLine("e2", "there."));

    expect(
      scrubRecording(clean).lines.map((line) => line.kind === "event" && line.event.payload),
    ).toEqual(clean.lines.map((line) => line.kind === "event" && line.event.payload));
  });

  it("drops the output and long detail of a command that read the home folder", () => {
    const dirty = recordingOf(
      itemLine("item.started", {
        itemType: "command_execution",
        title: "Run",
        detail: "cat ~/.zshrc",
      }),
      deltaLine("o1", "export PATH=/opt/tools:$PATH\n", {
        itemId: "cmd-1",
        payload: { streamKind: "command_output", delta: "export PATH=/opt/tools:$PATH\n" },
      }),
      deltaLine("o2", "alias gs='git status'\n", {
        itemId: "cmd-1",
        payload: { streamKind: "command_output", delta: "alias gs='git status'\n" },
      }),
      itemLine("item.completed", {
        itemType: "file_change",
        status: "completed",
        title: "Write",
        detail: `Write: {"file_path":"/home/user/notes.md","content":"${repeat("n", 300)}"}`,
      }),
      itemLine("item.updated", {
        itemType: "file_change",
        status: "inProgress",
        title: "Write",
        detail: 'Write: {"file_path":"/home/user/todo.md","content":"short private note"}',
      }),
    );

    expect(findLeaks(dirty).map((leak) => leak.path)).toEqual([
      "event.payload.detail",
      "event.payload.detail",
      "stream:command_output",
    ]);
    const scrubbed = scrubRecording(dirty);

    expect(textOf(scrubbed, "command_output")).toBe("[omitted]");
    expect(scrubbed.lines).toHaveLength(5);
    expect(scrubbed.lines[3]).toMatchObject({
      event: { payload: { detail: "/home/user/notes.md" } },
    });
    expect(scrubbed.lines[4]).toMatchObject({
      event: { payload: { detail: "/home/user/todo.md" } },
    });
    expect(findLeaks(scrubbed)).toEqual([]);
    expect(scrubRecording(scrubbed)).toEqual(scrubbed);
  });
});

describe("the recorder's local environment", () => {
  const eventLine = (type: string, payload: Record<string, unknown>): RecordingLine =>
    ({
      kind: "event",
      dt: 0,
      event: {
        eventId: "e1",
        provider: "claudeAgent",
        threadId: "thread-1",
        createdAt: "2026-01-01T00:00:00.000Z",
        type,
        payload,
      },
    }) as unknown as RecordingLine;
  const recordingOf = (...lines: Array<RecordingLine>): ProviderReplayRecording => ({
    header: { ...dirtyRecording().header, scrubVersion: SCRUB_VERSION },
    lines,
  });
  const init = eventLine("session.configured", {
    config: {
      type: "system",
      subtype: "init",
      model: "claude-sonnet-5-5",
      cwd: "/workspace/repo",
      permissionMode: "default",
      tools: ["Bash", "mcp__personal-finance__list_accounts"],
      mcp_servers: [{ name: "personal-finance", status: "connected" }],
      plugins: [{ name: "team-plugin" }],
    },
  });
  const hook = eventLine("hook.completed", {
    hookId: "hook-1",
    outcome: "success",
    output: "context injected by the recorder's own SessionStart hook",
  });

  it("keeps only the session's own settings and drops hook output", () => {
    const scrubbed = scrubRecording(recordingOf(init, hook));
    const [config, completed] = scrubbed.lines;

    expect(config).toMatchObject({
      event: {
        payload: {
          config: {
            type: "system",
            subtype: "init",
            model: "claude-sonnet-5-5",
            cwd: "/workspace/repo",
            permissionMode: "default",
          },
        },
      },
    });
    const settings =
      config?.kind === "event" && config.event.type === "session.configured"
        ? config.event.payload.config
        : {};
    expect(Object.keys(settings)).toEqual(["type", "subtype", "model", "cwd", "permissionMode"]);
    expect(completed).toMatchObject({
      event: { payload: { hookId: "hook-1", outcome: "success", output: "[omitted]" } },
    });
    expect(findLeaks(scrubbed)).toEqual([]);
    expect(scrubRecording(scrubbed)).toEqual(scrubbed);
  });

  it("flags installed tools, servers and hook output left in a recording", () => {
    expect(findLeaks(recordingOf(init, hook)).map((leak) => leak.path)).toEqual([
      "event.payload.config.tools",
      "event.payload.config.mcp_servers",
      "event.payload.config.plugins",
      "event.payload.output",
    ]);
  });
});

describe("findLeaks", () => {
  it("flags every class of leak in an unscrubbed recording, without echoing values", () => {
    const leaks = findLeaks(dirtyRecording(), { identities: options.identities });
    const kinds = new Set(leaks.map((leak) => leak.kind));

    expect([...kinds].toSorted()).toEqual(
      [
        "credential-field",
        "email",
        "forbidden-field",
        "home-path",
        "hostname",
        "identity",
        "ip-address",
        "scrub-version",
        "secret",
        "temp-path",
      ].toSorted(),
    );
    const report = JSON.stringify(leaks);
    for (const secret of Object.values(fake)) expect(report).not.toContain(secret);
    expect(report).not.toContain("alice");
  });

  it("finds nothing once scrubbed", () => {
    const scrubbed = scrubRecording(dirtyRecording(), options);

    expect(findLeaks(scrubbed, { identities: options.identities })).toEqual([]);
  });

  it("matches identities as whole words only", () => {
    const recording: ProviderReplayRecording = {
      header: { ...dirtyRecording().header, scrubVersion: SCRUB_VERSION },
      lines: [textEvent("e1", "a banana and Anaconda", "2026-01-01T00:00:00.000Z")],
    };

    expect(findLeaks(recording, { identities: ["ana"] })).toEqual([]);
    expect(findLeaks(recording, { identities: ["banana"] })).toHaveLength(1);
  });
});
