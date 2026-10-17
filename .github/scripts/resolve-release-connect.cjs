const { appendFileSync } = require("node:fs");

function resolveReleaseConnect(env) {
  const flag = env.E6CODE_CONNECT_ENABLED?.trim() ?? "";
  if (!["", "false", "true"].includes(flag)) {
    throw new Error("E6CODE_CONNECT_ENABLED must be true or false.");
  }
  const config = {
    enabled: flag === "true" ? "true" : "false",
    clerk_publishable_key: "",
    clerk_jwt_template: "",
    clerk_cli_oauth_client_id: "",
    relay_url: "",
  };
  if (config.enabled === "false") return config;

  const domain =
    env.RELAY_DOMAIN?.trim() ||
    (env.RELAY_API_ZONE_NAME?.trim() ? `relay.${env.RELAY_API_ZONE_NAME.trim()}` : "");
  const values = {
    RELAY_DOMAIN: domain,
    CLERK_PUBLISHABLE_KEY: env.CLERK_PUBLISHABLE_KEY?.trim(),
    CLERK_JWT_TEMPLATE: env.CLERK_JWT_TEMPLATE?.trim(),
    CLERK_CLI_OAUTH_CLIENT_ID: env.CLERK_CLI_OAUTH_CLIENT_ID?.trim(),
  };
  const missing = Object.keys(values).filter((key) => !values[key]);
  if (missing.length) {
    throw new Error(`Missing required Connect deployment configuration: ${missing.join(", ")}`);
  }
  if (Object.values(values).some((value) => /[\r\n]/.test(value))) {
    throw new Error("Connect deployment configuration must contain single-line values.");
  }
  return {
    enabled: "true",
    clerk_publishable_key: values.CLERK_PUBLISHABLE_KEY,
    clerk_jwt_template: values.CLERK_JWT_TEMPLATE,
    clerk_cli_oauth_client_id: values.CLERK_CLI_OAUTH_CLIENT_ID,
    relay_url: `https://${domain}`,
  };
}

module.exports = { resolveReleaseConnect };

if (require.main === module) {
  const config = resolveReleaseConnect(process.env);
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    Object.entries(config)
      .map(([key, value]) => `${key}=${value}\n`)
      .join(""),
  );
  console.log(
    config.enabled === "true"
      ? "E6 Connect enabled."
      : "E6 Connect disabled; direct LAN and Tailscale connections remain available.",
  );
}
