import * as NodeServices from "@effect/platform-node/NodeServices";
import { EnvironmentId, ProviderInstanceId, ThreadId } from "@e6tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import type { Tool } from "effect/unstable/ai";

import { resolveAttachmentPathById } from "../../../attachmentStore.ts";
import * as ServerConfig from "../../../config.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { HtmlToolkitHandlersLive } from "./handlers.ts";
import { HtmlToolkit } from "./tools.ts";

const THREAD_ID = ThreadId.make("thread-html");

const invocation = (
  capabilities: ReadonlyArray<McpInvocationContext.McpCapability>,
): McpInvocationContext.McpInvocationScope => ({
  environmentId: EnvironmentId.make("environment-1"),
  threadId: THREAD_ID,
  providerSessionId: "provider-session-1",
  providerInstanceId: ProviderInstanceId.make("claude"),
  capabilities: new Set(capabilities),
  issuedAt: 1,
});

const TestLayer = Layer.mergeAll(
  ServerConfig.layerTest(process.cwd(), { prefix: "e6-html-render-" }),
).pipe(Layer.provideMerge(NodeServices.layer));

const render = (
  params: Tool.Parameters<(typeof HtmlToolkit.tools)["html_render"]>,
  capabilities: ReadonlyArray<McpInvocationContext.McpCapability> = ["html-render"],
) =>
  Effect.gen(function* () {
    const toolkit = yield* HtmlToolkit.pipe(Effect.provide(HtmlToolkitHandlersLive));
    return yield* toolkit.handle("html_render", params).pipe(
      Stream.unwrap,
      Stream.runCollect,
      Effect.map(
        (chunk) => chunk.at(-1)!.result as Tool.Success<(typeof HtmlToolkit.tools)["html_render"]>,
      ),
      Effect.provideService(McpInvocationContext.McpInvocationContext, invocation(capabilities)),
    );
  });

describe("html_render", () => {
  it.effect("stores the page as an html thread attachment with the bootstrap", () =>
    Effect.gen(function* () {
      const result = yield* render({ html: "<p>Chart</p>", title: "  Sales  ", height: 5000 });
      expect(result.htmlRender.title).toBe("Sales");
      expect(result.htmlRender.height).toBe(2000);
      expect(result.htmlRender.attachmentId).toMatch(/^thread-html-[0-9a-f-]+-html$/);

      const config = yield* ServerConfig.ServerConfig;
      const filePath = resolveAttachmentPathById({
        attachmentsDir: config.attachmentsDir,
        attachmentId: result.htmlRender.attachmentId,
      });
      expect(filePath).toMatch(/\.html$/);
      const stored = yield* (yield* FileSystem.FileSystem).readFileString(filePath!);
      expect(stored).toContain('<style id="e6-theme">');
      expect(stored.endsWith("<p>Chart</p>")).toBe(true);
    }).pipe(Effect.provide(TestLayer), Effect.scoped),
  );

  it.effect("refuses pages sized in viewport height units", () =>
    Effect.gen(function* () {
      const error = yield* render({
        html: "<style>body{min-height:100vh}</style><p>x</p>",
        title: "Page",
        height: 200,
      }).pipe(Effect.flip);
      expect(error).toMatchObject({ _tag: "HtmlRenderViewportHeightError", found: "100vh" });
    }).pipe(Effect.provide(TestLayer), Effect.scoped),
  );

  it.effect("refuses a credential without the html-render capability", () =>
    Effect.gen(function* () {
      const error = yield* render({ html: "<p>x</p>", title: "Page", height: 200 }, [
        "pull-requests",
      ]).pipe(Effect.flip);
      expect(error).toMatchObject({
        _tag: "McpCapabilityUnavailableError",
        capability: "html-render",
      });
    }).pipe(Effect.provide(TestLayer), Effect.scoped),
  );
});
