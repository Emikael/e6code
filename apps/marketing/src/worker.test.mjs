import * as NodeAssert from "node:assert/strict";
import * as NodeTest from "node:test";
import worker from "./worker.mjs";

for (const path of ["/", "/download?channel=nightly", "/privacy-policy/"]) {
  NodeTest.test(`redirects www${path} to the canonical HTTPS URL`, async () => {
    const response = await worker.fetch(new Request(`https://www.e6code.com${path}`), {});
    NodeAssert.equal(response.status, 301);
    NodeAssert.equal(response.headers.get("location"), `https://e6code.com${path}`);
  });
}

NodeTest.test("serves the asset response for the apex domain", async () => {
  const response = await worker.fetch(new Request("https://e6code.com/missing"), {
    ASSETS: {
      fetch: async () => new Response("Page not found", { status: 404 }),
    },
  });
  NodeAssert.equal(response.status, 404);
  NodeAssert.equal(await response.text(), "Page not found");
});
