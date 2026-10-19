import { describe, expect, it } from "vite-plus/test";

import { HOSTED_APP_NIGHTLY_ORIGIN, HOSTED_APP_ORIGIN } from "@e6tools/shared/brand";

import {
  cookieCredentialRequiresTrustedOrigin,
  devAllowedCookieOrigins,
  hostedAppCookieOrigin,
  hostedAppCookieOrigins,
  isTrustedCookieOrigin,
  normalizeOrigin,
  type CookieOriginRequest,
} from "./cookieOrigin.ts";

const baseRequest = (overrides?: Partial<CookieOriginRequest>): CookieOriginRequest => ({
  originHeader: "http://127.0.0.1:13773",
  secFetchSite: "same-origin",
  hostHeader: "127.0.0.1:13773",
  originalUrl: "/ws",
  forwardedProto: undefined,
  bindHost: "127.0.0.1",
  devUrl: undefined,
  devAllowedOrigins: [],
  hostedAppOrigins: [],
  tailscaleServeEnabled: false,
  tailscaleServePort: 443,
  magicDnsNames: [],
  interfaceAddresses: ["127.0.0.1", "192.168.1.20"],
  hostname: "workstation.local",
  ...overrides,
});

describe("cookieCredentialRequiresTrustedOrigin", () => {
  it("requires an origin for upgrades and state-changing methods", () => {
    expect(cookieCredentialRequiresTrustedOrigin({ method: "GET", upgrade: "websocket" })).toBe(
      true,
    );
    expect(cookieCredentialRequiresTrustedOrigin({ method: "POST", upgrade: undefined })).toBe(
      true,
    );
    expect(cookieCredentialRequiresTrustedOrigin({ method: "GET", upgrade: undefined })).toBe(
      false,
    );
    expect(cookieCredentialRequiresTrustedOrigin({ method: "HEAD", upgrade: undefined })).toBe(
      false,
    );
    expect(cookieCredentialRequiresTrustedOrigin({ method: "OPTIONS", upgrade: undefined })).toBe(
      false,
    );
    expect(cookieCredentialRequiresTrustedOrigin({ method: undefined, upgrade: undefined })).toBe(
      false,
    );
  });
});

describe("normalizeOrigin", () => {
  it("keeps desktop renderer origins that Node would treat as opaque", () => {
    expect(normalizeOrigin("e6code://APP/")).toBe("e6code://app");
    expect(normalizeOrigin("e6code-dev://App")).toBe("e6code-dev://app");
    expect(normalizeOrigin("e6code://app/extra")).toBeNull();
    expect(normalizeOrigin("e6code://app, https://evil.example")).toBeNull();
    expect(normalizeOrigin("https://127.0.0.1:13773, https://evil.example")).toBeNull();
    expect(new URL("e6code://app").origin).toBe("null");
    expect(normalizeOrigin("null")).toBeNull();
    expect(normalizeOrigin("https://latest.app.e6code.com/pair")).toBe(
      "https://latest.app.e6code.com",
    );
  });
});

describe("hostedAppCookieOrigins", () => {
  it("trusts hosted app origins only when E6 Connect is enabled", () => {
    expect(hostedAppCookieOrigins({ connectEnabled: false, hostedAppOrigin: undefined })).toEqual(
      [],
    );
    expect(
      hostedAppCookieOrigins({
        connectEnabled: true,
        hostedAppOrigin: "https://preview.example.test",
      }),
    ).toEqual([HOSTED_APP_ORIGIN, HOSTED_APP_NIGHTLY_ORIGIN, "https://preview.example.test"]);
    expect(hostedAppCookieOrigin("https://preview.example.test/pair")).toBeUndefined();
    expect(hostedAppCookieOrigin("http://preview.example.test")).toBeUndefined();
    expect(hostedAppCookieOrigin("https://preview.example.test")).toBe(
      "https://preview.example.test",
    );
  });
});

describe("isTrustedCookieOrigin", () => {
  it("rejects a different localhost port and a same-site fetch on the server origin", () => {
    expect(
      isTrustedCookieOrigin(
        baseRequest({
          originHeader: "http://127.0.0.1:9999",
          secFetchSite: "same-site",
        }),
      ),
    ).toBe(false);
    expect(isTrustedCookieOrigin(baseRequest({ secFetchSite: "same-site" }))).toBe(false);
    expect(isTrustedCookieOrigin(baseRequest({ secFetchSite: "none" }))).toBe(false);
  });

  it("accepts the serving endpoint when the fetch site is same-origin or absent", () => {
    expect(isTrustedCookieOrigin(baseRequest())).toBe(true);
    expect(isTrustedCookieOrigin(baseRequest({ secFetchSite: undefined }))).toBe(true);
    expect(isTrustedCookieOrigin(baseRequest({ originHeader: undefined }))).toBe(false);
    expect(isTrustedCookieOrigin(baseRequest({ originHeader: "null" }))).toBe(false);
  });

  it("accepts desktop, dev, hosted, and explicitly configured origins", () => {
    expect(
      isTrustedCookieOrigin(
        baseRequest({ originHeader: "e6code://app", secFetchSite: "cross-site" }),
      ),
    ).toBe(true);
    expect(
      isTrustedCookieOrigin(
        baseRequest({ originHeader: "e6code-dev://app", secFetchSite: "cross-site" }),
      ),
    ).toBe(true);
    expect(
      isTrustedCookieOrigin(
        baseRequest({
          originHeader: "http://127.0.0.1:5173",
          secFetchSite: "same-site",
          devUrl: new URL("http://127.0.0.1:5173"),
        }),
      ),
    ).toBe(true);
    expect(
      isTrustedCookieOrigin(
        baseRequest({
          originHeader: HOSTED_APP_ORIGIN,
          secFetchSite: "cross-site",
          hostedAppOrigins: [HOSTED_APP_ORIGIN],
        }),
      ),
    ).toBe(true);
    expect(
      isTrustedCookieOrigin(
        baseRequest({
          originHeader: "http://192.168.1.40:5733",
          secFetchSite: "cross-site",
          devAllowedOrigins: ["http://192.168.1.40:5733"],
        }),
      ),
    ).toBe(false);
    expect(
      isTrustedCookieOrigin(
        baseRequest({
          originHeader: "http://192.168.1.40:5733",
          hostHeader: "192.168.1.40:5733",
          secFetchSite: "same-origin",
          devAllowedOrigins: ["http://192.168.1.40:5733"],
        }),
      ),
    ).toBe(true);
    expect(
      isTrustedCookieOrigin(
        baseRequest({
          originHeader: "http://127.0.0.1:5733",
          secFetchSite: "same-origin",
          devAllowedOrigins: ["http://127.0.0.1:5733"],
        }),
      ),
    ).toBe(false);
    expect(
      isTrustedCookieOrigin(
        baseRequest({
          originHeader: "http://127.0.0.1:5733",
          secFetchSite: "same-origin",
          devAllowedOrigins: ["http://127.0.0.1:5733"],
          devUrl: new URL("http://127.0.0.1:5173"),
        }),
      ),
    ).toBe(true);
    expect(
      devAllowedCookieOrigins({
        origins: ["http://127.0.0.1:5733", "https://host.example.ts.net"],
        devUrl: undefined,
      }).ignoredLoopback,
    ).toEqual(["http://127.0.0.1:5733"]);
    expect(
      isTrustedCookieOrigin(baseRequest({ originHeader: "e6code://app", secFetchSite: "none" })),
    ).toBe(false);
  });

  it("does not trust an origin merely because it echoes the Host header", () => {
    expect(
      isTrustedCookieOrigin(
        baseRequest({
          originHeader: "http://evil.example:13773",
          hostHeader: "evil.example:13773",
          secFetchSite: "same-origin",
        }),
      ),
    ).toBe(false);
  });

  it("accepts a LAN address the server can actually be reached on", () => {
    expect(
      isTrustedCookieOrigin(
        baseRequest({
          originHeader: "http://192.168.1.20:13773",
          hostHeader: "192.168.1.20:13773",
          secFetchSite: "same-origin",
        }),
      ),
    ).toBe(true);
    expect(
      isTrustedCookieOrigin(
        baseRequest({
          originHeader: "http://workstation.local:13773",
          hostHeader: "workstation.local:13773",
          bindHost: "127.0.0.1",
        }),
      ),
    ).toBe(false);
    expect(
      isTrustedCookieOrigin(
        baseRequest({
          originHeader: "http://workstation.local:13773",
          hostHeader: "workstation.local:13773",
          bindHost: "0.0.0.0",
        }),
      ),
    ).toBe(true);
  });

  it("accepts a Tailscale MagicDNS origin while serve rewrites Host to loopback", () => {
    expect(
      isTrustedCookieOrigin(
        baseRequest({
          originHeader: "https://machine.tailnet.ts.net",
          secFetchSite: "same-origin",
          hostHeader: "127.0.0.1:13773",
          forwardedProto: "https",
          tailscaleServeEnabled: true,
          magicDnsNames: ["machine.tailnet.ts.net"],
        }),
      ),
    ).toBe(true);
    expect(
      isTrustedCookieOrigin(
        baseRequest({
          originHeader: "https://evil.ts.net",
          secFetchSite: "same-origin",
          hostHeader: "127.0.0.1:13773",
          tailscaleServeEnabled: true,
          magicDnsNames: ["machine.tailnet.ts.net"],
        }),
      ),
    ).toBe(false);
    expect(
      isTrustedCookieOrigin(
        baseRequest({
          originHeader: "http://evil.ts.net:13773",
          hostHeader: "evil.ts.net:13773",
          secFetchSite: "same-origin",
          interfaceAddresses: ["100.64.0.1"],
          magicDnsNames: ["machine.tailnet.ts.net"],
        }),
      ),
    ).toBe(false);
    expect(
      isTrustedCookieOrigin(
        baseRequest({
          originHeader: "http://machine.tailnet.ts.net:13773",
          hostHeader: "machine.tailnet.ts.net:13773",
          secFetchSite: "same-origin",
          interfaceAddresses: ["100.64.0.1"],
          magicDnsNames: ["machine.tailnet.ts.net"],
        }),
      ),
    ).toBe(true);
    expect(
      isTrustedCookieOrigin(
        baseRequest({
          originHeader: "http://evil.ts.net:13773",
          hostHeader: "evil.ts.net:13773",
          secFetchSite: "same-origin",
          interfaceAddresses: [],
        }),
      ),
    ).toBe(false);
  });

  it("uses the request URL when the Host header is absent", () => {
    expect(
      isTrustedCookieOrigin(
        baseRequest({
          hostHeader: undefined,
          originalUrl: "http://127.0.0.1/api/auth/pairing-token",
          originHeader: "http://127.0.0.1",
          secFetchSite: undefined,
        }),
      ),
    ).toBe(true);
  });
});
