import { describe, expect, it } from "vite-plus/test";

import { redactLogLine } from "./serverProcess.ts";

describe("redactLogLine", () => {
  it("hides credential and token values in JSON output, one line at a time", () => {
    expect(redactLogLine('  "credential": "pc_9f3a2b",')).toBe('  "credential": "[redacted]",');
    expect(redactLogLine('{"token":"abc.def","accessToken": "xyz","clientSecret" : "s3"}')).toBe(
      '{"token":"[redacted]","accessToken": "[redacted]","clientSecret" : "[redacted]"}',
    );
    expect(redactLogLine('  "password": "hunter2"')).toBe('  "password": "[redacted]"');
  });

  it("keeps fields that are not secrets", () => {
    for (const line of [
      '  "id": "6a1f0c2e-1111-4222-8333-944455556666",',
      '  "scopes": [',
      '    "orchestration:read",',
      '  "expiresAt": "2026-11-23T02:25:19.332Z"',
      "E6 Code server is ready.",
    ]) {
      expect(redactLogLine(line)).toBe(line);
    }
  });

  it("hides the banner's token, pairing URL token, bearer header and QR code", () => {
    expect(redactLogLine("Token: pc_9f3a2b")).toBe("Token: [redacted]");
    expect(redactLogLine("Pair: http://127.0.0.1:5/pair#token=pc_9f3a2b&x=1")).toBe(
      "Pair: http://127.0.0.1:5/pair#token=[redacted]&x=1",
    );
    expect(redactLogLine("authorization: Bearer e6s_abc.def-ghi")).toBe(
      "authorization: Bearer [redacted]",
    );
    expect(redactLogLine("  █▀▀▀▀▀█ ▄▄▀ █▀▀▀▀▀█")).toBe("[qr code redacted]");
  });
});
