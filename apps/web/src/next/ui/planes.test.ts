import { describe, expect, it } from "vite-plus/test";

import { createSweepLedger } from "./sweepLedger.ts";
import { createWashClaims } from "./washClaims.ts";

describe("light wash claims", () => {
  it("shows at most one key and one attention wash, however many mount", () => {
    const claims = createWashClaims();
    claims.claim("key", "header");
    claims.claim("key", "composer");
    claims.claim("attention", "approval");
    claims.claim("attention", "question");

    const shown = (["header", "composer", "approval", "question"] as const).filter(
      (id) => claims.holder("key") === id || claims.holder("attention") === id,
    );
    expect(shown).toEqual(["composer", "question"]);
  });

  it("hands the light back when the newest claimant leaves", () => {
    const claims = createWashClaims();
    claims.claim("key", "header");
    const release = claims.claim("key", "composer");

    release();
    expect(claims.holder("key")).toBe("header");
  });

  it("releases only its own claim, and only once", () => {
    const claims = createWashClaims();
    const release = claims.claim("key", "header");
    claims.claim("key", "composer");

    release();
    release();
    expect(claims.holder("key")).toBe("composer");
  });

  it("tells subscribers when the holder changes", () => {
    const claims = createWashClaims();
    let changes = 0;
    const stop = claims.subscribe(() => changes++);

    const release = claims.claim("attention", "approval");
    release();
    stop();
    claims.claim("attention", "question");

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
