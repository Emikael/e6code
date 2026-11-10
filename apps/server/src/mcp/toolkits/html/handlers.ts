import {
  clampHtmlRenderHeight,
  findHtmlRenderViewportHeightUnit,
  HTML_RENDER_MAX_TITLE_LENGTH,
  type HtmlRenderReference,
  injectHtmlRenderBootstrap,
} from "@e6tools/shared/htmlRender";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { resolveAttachmentRelativePath } from "../../../attachmentPaths.ts";
import { createAttachmentId } from "../../../attachmentStore.ts";
import * as ServerConfig from "../../../config.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { HtmlRenderStoreError, HtmlRenderViewportHeightError, HtmlToolkit } from "./tools.ts";

const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  return HtmlToolkit.of({
    html_render: (input) =>
      Effect.gen(function* () {
        const scope = yield* McpInvocationContext.requireMcpCapability("html-render");
        const found = findHtmlRenderViewportHeightUnit(input.html);
        if (found !== undefined) return yield* new HtmlRenderViewportHeightError({ found });

        const config = yield* ServerConfig.ServerConfig;
        // The `-html` id suffix makes the asset route serve it as a sandboxed text/html document.
        const attachmentId = createAttachmentId(scope.threadId, "html");
        const filePath =
          attachmentId === null
            ? null
            : resolveAttachmentRelativePath({
                attachmentsDir: config.attachmentsDir,
                relativePath: `${attachmentId}.html`,
              });
        if (attachmentId === null || filePath === null) {
          return yield* new HtmlRenderStoreError({ cause: new Error("Invalid thread id.") });
        }
        const htmlRender: HtmlRenderReference = {
          attachmentId,
          title: input.title.trim().slice(0, HTML_RENDER_MAX_TITLE_LENGTH) || "HTML",
          height: clampHtmlRenderHeight(input.height),
        };
        yield* fileSystem.makeDirectory(path.dirname(filePath), { recursive: true }).pipe(
          Effect.andThen(
            fileSystem.writeFileString(filePath, injectHtmlRenderBootstrap(input.html)),
          ),
          Effect.mapError((cause) => new HtmlRenderStoreError({ cause })),
          // An interrupted publish must not leave a half-written page behind.
          Effect.onError(() => fileSystem.remove(filePath, { force: true }).pipe(Effect.ignore)),
          Effect.uninterruptible,
        );
        return {
          htmlRender,
          message: "The page is shown in the thread. Do not restate it in your reply.",
        };
      }),
  });
});

export const HtmlToolkitHandlersLive = HtmlToolkit.toLayer(make);
