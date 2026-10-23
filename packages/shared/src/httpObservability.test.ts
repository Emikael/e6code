import { describe, expect, it } from "vite-plus/test";

import { redactSensitiveUrl } from "./httpObservability.ts";

describe("redactSensitiveUrl", () => {
  it("redacts websocket tickets and other token-like query parameters", () => {
    const ticket = "ws-ticket-secret-value";
    const redacted = redactSensitiveUrl(
      `https://e6.local/ws?wsTicket=${ticket}&keep=visible&access_token=abc&code=oauth-code#token=pairing`,
    );

    expect(redacted).toBe(
      "https://e6.local/ws?wsTicket=[redacted]&keep=visible&access_token=[redacted]&code=[redacted]#token=pairing",
    );
    expect(redacted).not.toContain(ticket);
    expect(redacted).not.toContain("oauth-code");
    expect(redacted).toContain("#token=pairing");
  });

  it("leaves urls without a sensitive query parameter unchanged", () => {
    const url = "https://e6.local/pair#token=pairing";
    expect(redactSensitiveUrl(url)).toBe(url);
    expect(redactSensitiveUrl("/ws?keep=visible")).toBe("/ws?keep=visible");
  });
});
