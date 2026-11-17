import { describe, expect, it } from "vite-plus/test";

import { createSweepLedger } from "./sweepLedger.ts";
import { createWashClaims } from "./washClaims.ts";

describe("light wash claims", () => {
  it("shows at most one key and one attention wash, however many mount", () => {
    const claims = createWashClaims();
    claims.claim("key", "header", true);
    claims.claim("key", "composer", true);
    claims.claim("attention", "approval", true);
    claims.claim("attention", "question", true);

    const shown = (["header", "composer", "approval", "question"] as const).filter(
      (id) => claims.holder("key") === id || claims.holder("attention") === id,
    );
    expect(shown).toEqual(["composer", "question"]);
  });

  it("hands the light back when the newest claimant leaves", () => {
    const claims = createWashClaims();
    claims.claim("key", "header", true);
    const release = claims.claim("key", "composer", true);

    release();
    expect(claims.holder("key")).toBe("header");
  });

  it("releases only its own claim, and only once", () => {
    const claims = createWashClaims();
    const release = claims.claim("key", "header", true);
    claims.claim("key", "composer", true);

    release();
    release();
    expect(claims.holder("key")).toBe("composer");
  });

  it("leaves the light with a wash that is on when a newer one is off", () => {
    const claims = createWashClaims();
    claims.claim("key", "header", true);
    claims.claim("key", "composer", false);

    expect(claims.holder("key")).toBe("header");
  });

  it("gives the light to the newest wash that is on", () => {
    const claims = createWashClaims();
    claims.claim("key", "header", true);
    const release = claims.claim("key", "composer", true);
    claims.claim("key", "footer", false);
    expect(claims.holder("key")).toBe("composer");

    release();
    expect(claims.holder("key")).toBe("header");
  });

  // An off wash with no lit rival keeps its place, so it is still there to fade back in.
  it("keeps the place of the newest wash when none is on", () => {
    const claims = createWashClaims();
    claims.claim("key", "header", false);
    claims.claim("key", "composer", false);

    expect(claims.holder("key")).toBe("composer");
  });

  it("tells subscribers when the holder changes", () => {
    const claims = createWashClaims();
    let changes = 0;
    const stop = claims.subscribe(() => changes++);

    const release = claims.claim("attention", "approval", true);
    release();
    stop();
    claims.claim("attention", "question", true);

    expect(changes).toBe(2);
  });
});

describe("sweep ledger", () => {
  it("lets a request sweep once, even after its surface remounts", () => {
    const ledger = createSweepLedger();
    expect(ledger.isNew("request-1")).toBe(true);

    ledger.record("request-1");
    expect(ledger.isNew("request-1")).toBe(false);
    expect(ledger.isNew("request-2")).toBe(true);
  });
});
