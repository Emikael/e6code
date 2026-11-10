import { McpCapabilityUnavailableError } from "@e6tools/contracts";
import {
  HTML_RENDER_LAYOUT_GUIDE,
  HTML_RENDER_MAX_FIT_HEIGHT,
  HTML_RENDER_MAX_HEIGHT,
  HTML_RENDER_MAX_HTML_LENGTH,
  HTML_RENDER_MAX_TITLE_LENGTH,
  HTML_RENDER_MIN_HEIGHT,
  HTML_RENDER_THEME_GUIDE,
  HTML_RENDER_TOOL_NAME,
} from "@e6tools/shared/htmlRender";
import * as Schema from "effect/Schema";
import * as Tool from "effect/unstable/ai/Tool";
import * as Toolkit from "effect/unstable/ai/Toolkit";

import * as ServerConfig from "../../../config.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

export class HtmlRenderViewportHeightError extends Schema.TaggedError<HtmlRenderViewportHeightError>()(
  "HtmlRenderViewportHeightError",
  { found: Schema.String },
) {
  override get message(): string {
    return `The page uses viewport height units (${this.found}). The frame fits the page, so vh would loop. Use fixed pixel heights.`;
  }
}

export class HtmlRenderStoreError extends Schema.TaggedError<HtmlRenderStoreError>()(
  "HtmlRenderStoreError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "Could not store the page.";
  }
}

export const HtmlRenderToolError = Schema.Union([
  McpCapabilityUnavailableError,
  HtmlRenderViewportHeightError,
  HtmlRenderStoreError,
]);

export const HtmlRenderResult = Schema.Struct({
  htmlRender: Schema.Struct({
    attachmentId: Schema.String,
    title: Schema.String,
    height: Schema.Int,
  }),
  message: Schema.String,
});

// Affects only the caller's thread, not its workspace, so read-only sandboxes and plan mode may use it.
export const HtmlRenderTool = Tool.make(HTML_RENDER_TOOL_NAME, {
  description: `Show a finished HTML page (chart, diagram, mockup, small app) inline in this thread, above your final reply. The user can open it full screen or in a side panel. Do not announce or restate the page. Self-contained: inline <style> and <script>; remote URLs load as-is; scripts run in a sandbox without access to the app. The frame fits the page's height up to ${HTML_RENDER_MAX_FIT_HEIGHT}px. ${HTML_RENDER_LAYOUT_GUIDE} ${HTML_RENDER_THEME_GUIDE}`,
  parameters: Schema.Struct({
    html: Schema.String.check(
      Schema.isMinLength(1),
      Schema.isMaxLength(HTML_RENDER_MAX_HTML_LENGTH),
    ).annotate({ description: "The page, a full document or a fragment." }),
    title: Schema.String.check(
      Schema.isMinLength(1),
      Schema.isMaxLength(HTML_RENDER_MAX_TITLE_LENGTH),
    ).annotate({ description: "Short name shown in the thread's artifact list." }),
    height: Schema.Int.annotate({
      description: `Expected height in CSS pixels, ${HTML_RENDER_MIN_HEIGHT} to ${HTML_RENDER_MAX_HEIGHT}. Used until the page reports its real height.`,
    }),
  }),
  success: HtmlRenderResult,
  failure: HtmlRenderToolError,
  dependencies: [McpInvocationContext.McpInvocationContext, ServerConfig.ServerConfig],
})
  .annotate(Tool.Title, "Render HTML")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, true);

export const HtmlToolkit = Toolkit.make(HtmlRenderTool);
