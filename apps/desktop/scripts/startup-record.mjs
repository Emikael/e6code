// Checks the desktop startup record a launch writes to `<logDir>/desktop-startup.ndjson`.
// The record's shape is defined in `src/app/DesktopStartupRecord.ts`; this plain-JS copy of
// the parts the smoke test relies on lets the script run under bare Node.

export const STARTUP_RECORD_FILE_NAME = "desktop-startup.ndjson";

/** Must match `REQUIRED_STARTUP_PHASES` in `src/app/DesktopStartupClock.ts`. */
export const REQUIRED_STARTUP_PHASES = [
  "mainEntry",
  "electronReady",
  "shellEnvironmentImport",
  "settingsLoad",
  "protocolRegistered",
  "mainWindowCreated",
  "mainWindowReadyToShow",
  "rendererFirstPaint",
  "shellInteractive",
  "backendReady",
];

const PHASE_STATUSES = new Set(["reached", "not-applicable", "not-reached"]);
const MEMORY_PROCESS_KEYS = [
  "main",
  "rendererMain",
  "rendererOther",
  "gpu",
  "utility",
  "other",
  "serverChild",
];

/**
 * Returns the problems with one launch's log: exactly one version 1 startup record listing
 * every required phase, and a memory sample with the given label for the same run that
 * covers every process type. An empty list means the log is valid.
 */
export function validateStartupRecordLog(text, { memoryLabel = "10s" } = {}) {
  const entries = [];
  const errors = [];
  for (const [index, line] of text.split("\n").entries()) {
    if (line.trim() === "") continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      errors.push(`line ${index + 1} is not JSON`);
    }
  }

  const records = entries.filter((entry) => entry?.type === "desktop-startup");
  if (records.length !== 1) {
    return [...errors, `expected one desktop-startup record, found ${records.length}`];
  }
  const [record] = records;
  if (record.version !== 1) errors.push(`unsupported record version ${record.version}`);
  for (const phase of REQUIRED_STARTUP_PHASES) {
    const state = record.phases?.[phase];
    if (!PHASE_STATUSES.has(state?.status)) {
      errors.push(`phase ${phase} is missing or has no valid status`);
    } else if (state.status === "reached" && !Number.isFinite(state.atMs)) {
      errors.push(`phase ${phase} is reached without a time`);
    }
  }

  const memory = entries.find(
    (entry) =>
      entry?.type === "desktop-startup-memory" &&
      entry.runId === record.runId &&
      entry.label === memoryLabel,
  );
  if (memory === undefined) {
    errors.push(`no ${memoryLabel} memory sample for run ${record.runId}`);
    return errors;
  }
  for (const key of MEMORY_PROCESS_KEYS) {
    if (memory.processes?.[key] === undefined) errors.push(`memory sample has no ${key} entry`);
  }
  if (!(memory.processes?.main?.workingSetBytes > 0)) {
    errors.push("memory sample has no main process working set");
  }
  return errors;
}
