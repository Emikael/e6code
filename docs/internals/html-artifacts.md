# HTML artifacts

Agents publish pages into a thread with the `html_render` tool on the `e6-code` MCP server
([`apps/server/src/mcp/toolkits/html`](../../apps/server/src/mcp/toolkits/html)). The design keeps
the page off the WebSocket and inside a sandbox across every client.

## Where the page lives

The tool stores the page as a thread attachment whose id ends in `-html`, after injecting the
theme and resize bootstrap from [`packages/shared/src/htmlRender.ts`](../../packages/shared/src/htmlRender.ts).
Clients load it through the ordinary asset URL route, which serves inline `text/html` with
`Content-Security-Policy: sandbox allow-scripts …` ([`apps/server/src/http.ts`](../../apps/server/src/http.ts)).
That header is what keeps a page on an opaque origin when it is opened outside a sandboxed
`<iframe>`, such as a new tab or the mobile WebView. Do not serve artifacts any other way.

## How clients find it

[`ActivityPayloadProjection`](../../apps/server/src/orchestration/ActivityPayloadProjection.ts)
slims MCP tool results before they reach clients, so a reference left inside the result would be
truncated. The projection lifts it to `payload.htmlRender` first, the same way preview tools keep
`toolIcon`, and strips the `html` argument from the tool-call input, which can be 512 KB. Clients
read only `payload.htmlRender`; they never parse tool results for it.

## Sizing

There is no server-side measurement. The page reports its height (a `postMessage` from the
bootstrap on web, an injected script on mobile) and the frame fits it, starting from the agent's
height hint. The web timeline is virtualized, so measured heights are cached per attachment to
avoid a jump when a row remounts.
