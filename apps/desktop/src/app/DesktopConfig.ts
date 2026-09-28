import { withLegacyBrandEnv } from "@e6tools/shared/brand";
import { OtlpHeadersFromString, OtlpProtocol } from "@e6tools/shared/observability";
import * as Config from "effect/Config";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Option from "effect/Option";

const trimNonEmptyOption = (value: string): Option.Option<string> => {
  const trimmed = value.trim();
  return trimmed.length > 0 ? Option.some(trimmed) : Option.none();
};

const trimmedString = (name: string) =>
  Config.String(name).pipe(Config.option, Config.map(Option.flatMap(trimNonEmptyOption)));

const compactEnv = (env: Readonly<Record<string, string | undefined>>): Record<string, string> =>
  Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );

export const DesktopConfig = Config.all({
  appDataDirectory: trimmedString("APPDATA"),
  xdgConfigHome: trimmedString("XDG_CONFIG_HOME"),
  xdgDataHome: trimmedString("XDG_DATA_HOME"),
  e6Home: withLegacyBrandEnv("HOME", Config.String).pipe(
    Config.option,
    Config.map(Option.flatMap(trimNonEmptyOption)),
  ),
  devServerUrl: Config.URL("VITE_DEV_SERVER_URL").pipe(Config.option),
  appUserModelIdOverride: withLegacyBrandEnv("DESKTOP_APP_USER_MODEL_ID", Config.String).pipe(
    Config.option,
    Config.map(Option.flatMap(trimNonEmptyOption)),
  ),
  devRemoteE6ServerEntryPath: withLegacyBrandEnv(
    "DEV_REMOTE_E6_SERVER_ENTRY_PATH",
    Config.String,
  ).pipe(Config.option, Config.map(Option.flatMap(trimNonEmptyOption))),
  configuredBackendPort: withLegacyBrandEnv("PORT", Config.Port).pipe(Config.option),
  commitHashOverride: withLegacyBrandEnv("COMMIT_HASH", Config.String).pipe(
    Config.option,
    Config.map(Option.flatMap(trimNonEmptyOption)),
  ),
  desktopLanHostOverride: withLegacyBrandEnv("DESKTOP_LAN_HOST", Config.String).pipe(
    Config.option,
    Config.map(Option.flatMap(trimNonEmptyOption)),
  ),
  desktopHttpsEndpointUrls: withLegacyBrandEnv("DESKTOP_HTTPS_ENDPOINTS", Config.String).pipe(
    Config.option,
    Config.map(Option.flatMap(trimNonEmptyOption)),
    Config.map(
      Option.match({
        onNone: () => [] as Array<string>,
        onSome: (value) =>
          value
            .split(",")
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0),
      }),
    ),
  ),
  otlpTracesUrl: withLegacyBrandEnv("OTLP_TRACES_URL", Config.String).pipe(
    Config.option,
    Config.map(Option.flatMap(trimNonEmptyOption)),
  ),
  otlpMetricsUrl: withLegacyBrandEnv("OTLP_METRICS_URL", Config.String).pipe(
    Config.option,
    Config.map(Option.flatMap(trimNonEmptyOption)),
  ),
  otlpLogsUrl: withLegacyBrandEnv("OTLP_LOGS_URL", Config.String).pipe(
    Config.option,
    Config.map(Option.flatMap(trimNonEmptyOption)),
  ),
  otlpExportIntervalMs: withLegacyBrandEnv("OTLP_EXPORT_INTERVAL_MS", Config.Int).pipe(
    Config.withDefault(10_000),
  ),
  otlpHeaders: withLegacyBrandEnv("OTLP_HEADERS", (name) =>
    Config.schema(OtlpHeadersFromString, name),
  ).pipe(Config.option),
  otlpProtocol: withLegacyBrandEnv("OTLP_PROTOCOL", (name) =>
    Config.schema(OtlpProtocol, name),
  ).pipe(Config.withDefault("http/json")),
  appImagePath: trimmedString("APPIMAGE"),
  disableAutoUpdate: withLegacyBrandEnv("DISABLE_AUTO_UPDATE", Config.Boolean).pipe(
    Config.option,
    Config.map(Option.getOrElse(() => false)),
  ),
  mockUpdates: withLegacyBrandEnv("DESKTOP_MOCK_UPDATES", Config.Boolean).pipe(
    Config.option,
    Config.map(Option.getOrElse(() => false)),
  ),
  mockUpdateServerPort: withLegacyBrandEnv("DESKTOP_MOCK_UPDATE_SERVER_PORT", Config.Port).pipe(
    Config.withDefault(3000),
  ),
});

export const layerTest = (env: Readonly<Record<string, string | undefined>>) =>
  ConfigProvider.layer(ConfigProvider.fromEnv({ env: compactEnv(env) }));
