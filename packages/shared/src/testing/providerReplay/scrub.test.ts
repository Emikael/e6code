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
