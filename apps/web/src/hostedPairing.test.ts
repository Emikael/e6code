import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  buildHostedChannelSelectionUrl,
  buildHostedPairingUrl,
  hasHostedPairingRequest,
  isHostedStaticApp,
  readHostedPairingRequest,
} from "./hostedPairing";

describe("hostedPairing", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reads hosted pairing hosts from the query for links that already shipped", () => {
    const url = new URL("https://latest.app.e6code.com/pair?host=100.64.1.2:3773&token=ABCD1234");

    expect(readHostedPairingRequest(url)).toEqual({
      host: "100.64.1.2:3773",
      token: "ABCD1234",
      label: "",
    });
    expect(hasHostedPairingRequest(url)).toBe(true);
  });

  it("prefers hash tokens so generated hosted links do not put credentials in search params", () => {
    vi.stubEnv("VITE_HOSTED_APP_URL", "https://preview.e6.codes");

    const url = new URL(
      buildHostedPairingUrl({
        host: "https://backend.example.com:3773",
        token: "pairing-token",
        label: "Workstation",
      }),
    );

    expect(url.origin).toBe("https://preview.e6.codes");
    expect(url.pathname).toBe("/pair");
    expect(url.search).toBe("");
    expect(url.searchParams.has("token")).toBe(false);
    const hashParams = new URLSearchParams(url.hash.slice(1));
    expect(hashParams.get("host")).toBe("https://backend.example.com:3773");
    expect(hashParams.get("label")).toBe("Workstation");
    expect(hashParams.get("token")).toBe("pairing-token");
  });

  it("builds hosted channel selection URLs on that channel's host", () => {
    const nightly = new URL(buildHostedChannelSelectionUrl({ channel: "nightly" }));
    const latest = new URL(buildHostedChannelSelectionUrl({ channel: "latest" }));

    expect(nightly.origin).toBe("https://nightly.app.e6code.com");
    expect(nightly.pathname).toBe("/");
    expect(nightly.search).toBe("");
    expect(latest.origin).toBe("https://latest.app.e6code.com");
    expect(latest.pathname).toBe("/");
  });

  it("ignores incomplete hosted pairing requests", () => {
    expect(
      hasHostedPairingRequest(new URL("https://app.e6.codes/pair?host=backend.example.com")),
    ).toBe(false);
    expect(hasHostedPairingRequest(new URL("https://app.e6.codes/pair?token=ABCD1234"))).toBe(
      false,
    );
  });

  it("detects the hosted static app only when no backend URL is configured", () => {
    vi.stubEnv("VITE_HOSTED_APP_URL", "https://preview.e6.codes");
    vi.stubEnv("VITE_HTTP_URL", "");
    vi.stubEnv("VITE_WS_URL", "");

    expect(isHostedStaticApp(new URL("https://preview.e6.codes/"))).toBe(true);
    expect(isHostedStaticApp(new URL("https://preview.e6.codes/pair"))).toBe(true);
    expect(isHostedStaticApp(new URL("https://backend.example.com/"))).toBe(false);

    vi.stubEnv("VITE_HTTP_URL", "https://backend.example.com");
    expect(isHostedStaticApp(new URL("https://preview.e6.codes/"))).toBe(false);
  });

  it("treats a channel build as hosted only on its baked origin", () => {
    vi.stubEnv("VITE_HOSTED_APP_URL", "https://nightly.app.e6code.com");
    vi.stubEnv("VITE_HOSTED_APP_CHANNEL", "nightly");
    vi.stubEnv("VITE_HTTP_URL", "");
    vi.stubEnv("VITE_WS_URL", "");

    expect(isHostedStaticApp(new URL("https://nightly.app.e6code.com/"))).toBe(true);
    expect(isHostedStaticApp(new URL("https://latest.app.e6code.com/"))).toBe(false);
    expect(isHostedStaticApp(new URL("https://evil.example/"))).toBe(false);

    vi.stubEnv("VITE_HTTP_URL", "https://backend.example.com");
    expect(isHostedStaticApp(new URL("https://nightly.app.e6code.com/"))).toBe(false);
  });
});
