import { describe, expect, it } from "vite-plus/test";

import { LandingError, landedOnAuth } from "./landing.ts";

describe("landedOnAuth", () => {
  it("is true only for a load that landed on the pairing or sign-in surface", () => {
    expect(landedOnAuth(new LandingError("pair"))).toBe(true);
    expect(landedOnAuth(new LandingError("requires-auth"))).toBe(true);
  });

  it("is false for any other failure, which pairing again would only hide", () => {
    for (const error of [
      new LandingError("welcome"),
      new LandingError("starting"),
      new LandingError("none"),
      new Error("the shell never became interactive"),
      new Error("page.goto: net::ERR_CONNECTION_REFUSED at http://127.0.0.1:5/"),
      "pair",
      null,
    ]) {
      expect(landedOnAuth(error), String(error)).toBe(false);
    }
  });

  it("names the surface in its message", () => {
    expect(new LandingError("welcome").message).toContain("'welcome'");
  });
});
