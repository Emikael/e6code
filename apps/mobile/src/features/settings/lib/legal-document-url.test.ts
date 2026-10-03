import { describe, expect, it } from "vite-plus/test";

import { isLegalDocumentUrl } from "./legal-document-url";

describe("isLegalDocumentUrl", () => {
  it.each([
    "https://e6code.com/legal",
    "https://e6code.com/legal/",
    "https://e6code.com/privacy-policy?source=app",
    "https://e6code.com/terms-of-service#updates",
    "https://e6code.com/security-policy",
  ])("allows a configured legal document: %s", (url) => {
    expect(isLegalDocumentUrl(url)).toBe(true);
  });

  it.each([
    "https://e6code.com/download",
    "https://example.com/legal",
    "javascript:alert(1)",
    "not-a-url",
  ])("rejects a URL outside the legal-document allowlist: %s", (url) => {
    expect(isLegalDocumentUrl(url)).toBe(false);
  });
});
