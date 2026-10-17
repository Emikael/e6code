const assert = require("node:assert/strict");
const { test } = require("node:test");
const { resolveReleaseConnect } = require("./resolve-release-connect.cjs");

const configured = {
  E6CODE_CONNECT_ENABLED: "true",
  RELAY_API_ZONE_NAME: "example.com",
  CLERK_PUBLISHABLE_KEY: "pk_test_example",
  CLERK_JWT_TEMPLATE: "e6-relay",
  CLERK_CLI_OAUTH_CLIENT_ID: "cli-example",
};

test("Connect is opt-in and clears stale public configuration", () => {
  for (const flag of [undefined, "", "false"]) {
    assert.deepEqual(resolveReleaseConnect({ ...configured, E6CODE_CONNECT_ENABLED: flag }), {
      enabled: "false",
      clerk_publishable_key: "",
      clerk_jwt_template: "",
      clerk_cli_oauth_client_id: "",
      relay_url: "",
    });
  }
});
test("enabled Connect resolves the production configuration", () => {
  assert.equal(resolveReleaseConnect(configured).relay_url, "https://relay.example.com");
  assert.equal(
    resolveReleaseConnect({ ...configured, RELAY_DOMAIN: "connect.example.com" }).relay_url,
    "https://connect.example.com",
  );
  assert.equal(
    resolveReleaseConnect(configured).clerk_publishable_key,
    configured.CLERK_PUBLISHABLE_KEY,
  );
});
test("enabled Connect fails before tracing when configuration is incomplete", () => {
  assert.throws(
    () => resolveReleaseConnect({ E6CODE_CONNECT_ENABLED: "true" }),
    /Missing required Connect/,
  );
  assert.throws(
    () => resolveReleaseConnect({ ...configured, CLERK_JWT_TEMPLATE: "" }),
    /CLERK_JWT_TEMPLATE/,
  );
});
test("invalid flags and multiline output values are rejected", () => {
  assert.throws(
    () => resolveReleaseConnect({ E6CODE_CONNECT_ENABLED: "yes" }),
    /must be true or false/,
  );
  assert.throws(
    () => resolveReleaseConnect({ ...configured, CLERK_JWT_TEMPLATE: "a\nenabled=false" }),
    /single-line/,
  );
});
