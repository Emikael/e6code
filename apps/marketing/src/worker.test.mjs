import assert from "node:assert/strict";
import test from "node:test";
import worker from "./worker.mjs";

for (const path of ["/", "/download?channel=nightly", "/privacy-policy/"]) {
  test(`redirects www${path} to the canonical HTTPS URL`, async () => {
    const response = await worker.fetch(new Request(`https://www.e6code.com${path}`), {});
    assert.equal(response.status, 301);
    assert.equal(response.headers.get("location"), `https://e6code.com${path}`);
  });
}

test("serves the asset response for the apex domain", async () => {
  const response = await worker.fetch(new Request("https://e6code.com/missing"), {
    ASSETS: {
      fetch: async () => new Response("Page not found", { status: 404 }),
    },
  });
  assert.equal(response.status, 404);
  assert.equal(await response.text(), "Page not found");
});
