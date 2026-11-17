import type {
  EnvironmentId,
  ServerPerformanceMetricsResult,
  ServerPerformanceRpcMethod,
  ServerPerformanceSqliteStatement,
} from "@e6tools/contracts";
import * as Option from "effect/Option";
import { AlertTriangleIcon } from "lucide-react";

import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  DiagnosticsLastChecked,
  DiagnosticsRefreshButton,
  DiagnosticsTable,
  EmptyRows,
  StatBlock,
  StatsGrid,
  formatBytes,
  formatCount,
} from "./diagnosticsPrimitives";
import { SettingsSection } from "./settingsLayout";

// Budgets from the remodel's performance programme.
const EVENT_LOOP_P99_BUDGET_MS = 20;
const TABLE_ROWS = 10;

function formatMs(value: number): string {
  if (value === 0) return "0 ms";
  if (value < 1) return `${value.toFixed(2)} ms`;
  if (value < 10) return `${value.toFixed(1)} ms`;
  if (value < 10_000) return `${Math.round(value)} ms`;
  return `${(value / 1_000).toFixed(1)} s`;
}

function formatWindow(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  return minutes >= 1 ? `${minutes} min` : `${Math.max(1, Math.round(ms / 1_000))} s`;
}

function BudgetNotice({ children }: { children: string }) {
  return (
    <div className="flex items-start gap-2 text-warning-foreground">
      <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
      <span>{children}</span>
    </div>
  );
}

function budgetNotices(data: ServerPerformanceMetricsResult): Array<string> {
  const notices: Array<string> = [];
  const eventLoop = Option.getOrNull(data.eventLoop);
  if (eventLoop && eventLoop.worstP99Ms > EVENT_LOOP_P99_BUDGET_MS) {
    notices.push(
      `Over budget: event-loop delay p99 reached ${formatMs(eventLoop.worstP99Ms)} (budget ${EVENT_LOOP_P99_BUDGET_MS} ms).`,
    );
  }
  if (data.rpcTotals.framesOver256KiB > 0) {
    notices.push(
      `Over budget: ${formatCount(data.rpcTotals.framesOver256KiB)} WebSocket frames were larger than 256 KB.`,
    );
  }
  return notices;
}

function RpcPayloadRow({ row }: { row: ServerPerformanceRpcMethod }) {
  return (
    <tr>
      <td className="max-w-[260px] truncate px-4 py-2 font-mono text-[11px] sm:pl-5">
        {row.method}
      </td>
      <td className="px-4 py-2 text-right font-mono tabular-nums">
        {formatCount(row.chunkFrames)}
      </td>
      <td className="px-4 py-2 text-right font-mono tabular-nums">{formatBytes(row.chunkBytes)}</td>
      <td className="px-4 py-2 text-right font-mono tabular-nums">{formatCount(row.exitFrames)}</td>
      <td className="px-4 py-2 text-right font-mono tabular-nums">{formatBytes(row.exitBytes)}</td>
      <td className="px-4 py-2 text-right font-mono tabular-nums">
        {formatBytes(row.p95FrameBytesAtMost)}
      </td>
      <td className="px-4 py-2 text-right font-mono tabular-nums sm:pr-5">
        {formatBytes(row.maxFrameBytes)}
      </td>
    </tr>
  );
}

function SqliteStatementRow({ row }: { row: ServerPerformanceSqliteStatement }) {
  return (
    <tr>
      <td className="max-w-[320px] px-4 py-2 sm:pl-5">
        <Tooltip>
          <TooltipTrigger
            render={
              <span className="block cursor-default truncate font-mono text-[11px]">
                {row.name}
              </span>
            }
          />
          <TooltipPopup
            side="top"
            className="max-w-[min(420px,calc(100vw-2rem))] whitespace-normal break-words font-mono text-[11px]"
          >
            {row.sample || row.name}
          </TooltipPopup>
        </Tooltip>
      </td>
      <td className="px-4 py-2 text-right font-mono tabular-nums">{formatCount(row.count)}</td>
      <td className="px-4 py-2 text-right font-mono tabular-nums">{formatMs(row.totalMs)}</td>
      <td className="px-4 py-2 text-right font-mono tabular-nums">{formatMs(row.p95MsAtMost)}</td>
      <td className="px-4 py-2 text-right font-mono tabular-nums">{formatMs(row.maxMs)}</td>
      <td className="px-4 py-2 text-right font-mono tabular-nums sm:pr-5">
        {row.failures > 0 ? `${formatCount(row.failures)} failed` : "None"}
      </td>
    </tr>
  );
}

/**
 * Settings > Diagnostics section for the server's in-memory performance
 * metrics. Older servers, and servers running with E6CODE_PERF_METRICS=false,
 * do not advertise the capability; the section then explains that instead of
 * calling the RPC or showing zeros that would read as "no traffic".
 */
export function ServerPerformanceDiagnostics({
  environmentId,
  supported,
}: {
  environmentId: EnvironmentId | null;
  supported: boolean;
}) {
  const { data, error, isPending, refresh } = useEnvironmentQuery(
    environmentId === null || !supported
      ? null
      : serverEnvironment.performanceMetrics({ environmentId, input: {} }),
  );

  if (!supported) {
    return (
      <SettingsSection id="server-performance" title="Server Performance">
        <EmptyRows label="This server does not report performance metrics. Servers from before this feature, and servers started with E6CODE_PERF_METRICS=false, leave this section empty." />
      </SettingsSection>
    );
  }

  const eventLoop = data ? Option.getOrNull(data.eventLoop) : null;
  const loopValue = (pick: (value: NonNullable<typeof eventLoop>) => string) =>
    data === null ? "..." : eventLoop === null ? "Collecting" : pick(eventLoop);
  const notices = data ? budgetNotices(data) : [];
  const windowLabel = data ? formatWindow(data.coveredMs) : "the last few minutes";
  const rpcRows = data?.rpc.slice(0, TABLE_ROWS) ?? [];
  const sqliteRows = data?.sqlite.slice(0, TABLE_ROWS) ?? [];

  return (
    <SettingsSection
      id="server-performance"
      title="Server Performance"
      headerAction={
        <div className="flex items-center gap-1.5">
          <DiagnosticsLastChecked checkedAt={data?.readAt ?? null} />
          <DiagnosticsRefreshButton
            isPending={isPending}
            label="Refresh server performance"
            onClick={refresh}
          />
        </div>
      }
    >
      <StatsGrid>
        <StatBlock
          label="Loop delay p50"
          value={loopValue((value) => formatMs(value.latest.p50Ms))}
          tooltip="How late the server's event loop ran its timers during the last 10 seconds. 0 ms means no delay; the monitor's own resolution is already subtracted."
        />
        <StatBlock
          label="Loop delay p99"
          value={loopValue((value) => formatMs(value.latest.p99Ms))}
          tone={
            eventLoop && eventLoop.latest.p99Ms > EVENT_LOOP_P99_BUDGET_MS ? "warning" : "default"
          }
          tooltip={`p99 over the last 10 seconds. The budget is ${EVENT_LOOP_P99_BUDGET_MS} ms. Worst interval in ${windowLabel}: ${eventLoop ? formatMs(eventLoop.worstP99Ms) : "not measured yet"}.`}
        />
        <StatBlock
          label="Loop delay max"
          value={loopValue((value) => formatMs(value.maxMs))}
          tooltip={`Longest single stall in ${windowLabel}.`}
        />
        <StatBlock
          label="Loop busy"
          value={loopValue((value) => `${(value.latest.utilization * 100).toFixed(1)}%`)}
          tooltip="Share of the last 10 seconds the event loop spent running code rather than waiting."
        />
      </StatsGrid>
      {notices.length > 0 || error ? (
        <div className="space-y-2 border-t border-border/60 px-4 py-3 text-xs sm:px-5">
          {notices.map((notice) => (
            <BudgetNotice key={notice}>{notice}</BudgetNotice>
          ))}
          {error ? (
            <div className="flex items-start gap-2 text-destructive">
              <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
              <span>{error}</span>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="border-t border-border/60 px-4 pt-3 pb-1 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground/70 sm:px-5">
        WebSocket payloads · {windowLabel}
      </div>
      <StatsGrid>
        <StatBlock
          label="Frames"
          value={data ? formatCount(data.rpcTotals.frames) : "..."}
          tooltip="Encoded WebSocket frames sent by this server to every client, before compression. Resets when the server restarts."
        />
        <StatBlock label="Bytes" value={data ? formatBytes(data.rpcTotals.bytes) : "..."} />
        <StatBlock
          label="p95 frame"
          value={data ? `≤ ${formatBytes(data.rpcTotals.p95FrameBytesAtMost)}` : "..."}
          tooltip="95% of frames were at most this size."
        />
        <StatBlock
          label="Largest frame"
          value={data ? formatBytes(data.rpcTotals.maxFrameBytes) : "..."}
          tone={data && data.rpcTotals.framesOver256KiB > 0 ? "warning" : "default"}
        />
      </StatsGrid>
      {rpcRows.length > 0 ? (
        <DiagnosticsTable
          headers={[
            "Method",
            "Stream frames",
            "Stream bytes",
            "Results",
            "Result bytes",
            "p95 frame ≤",
            "Largest",
          ]}
          minTableWidth="min-w-[760px]"
        >
          {rpcRows.map((row) => (
            <RpcPayloadRow key={row.method} row={row} />
          ))}
        </DiagnosticsTable>
      ) : (
        <EmptyRows label={data ? "No WebSocket frames sent yet." : "Loading payload counters..."} />
      )}

      <div className="border-t border-border/60 px-4 pt-3 pb-1 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground/70 sm:px-5">
        SQLite statements · {windowLabel}
      </div>
      <StatsGrid>
        <StatBlock label="Executions" value={data ? formatCount(data.sqliteTotals.count) : "..."} />
        <StatBlock
          label="Time in SQLite"
          value={data ? formatMs(data.sqliteTotals.totalMs) : "..."}
          tooltip="Time the event loop spent blocked inside SQLite. Every client waits while a statement runs."
        />
        <StatBlock label="Slowest" value={data ? formatMs(data.sqliteTotals.maxMs) : "..."} />
        <StatBlock
          label="Failures"
          value={data ? formatCount(data.sqliteTotals.failures) : "..."}
        />
      </StatsGrid>
      {sqliteRows.length > 0 ? (
        <DiagnosticsTable
          headers={["Statement", "Runs", "Total", "p95 ≤", "Max", "Failures"]}
          minTableWidth="min-w-[700px]"
        >
          {sqliteRows.map((row) => (
            <SqliteStatementRow key={row.name} row={row} />
          ))}
        </DiagnosticsTable>
      ) : (
        <EmptyRows label={data ? "No SQLite statements run yet." : "Loading SQLite timings..."} />
      )}

      <div className="border-t border-border/60 px-4 pt-3 pb-1 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground/70 sm:px-5">
        Sidebar refetches · {windowLabel}
      </div>
      <StatsGrid>
        <StatBlock
          label="Subscribers"
          value={data ? formatCount(data.shell.subscribers) : "..."}
          tooltip="Clients subscribed to the sidebar's project and thread list right now. Each one re-reads changed threads on its own."
        />
        <StatBlock
          label="Windows"
          value={data ? formatCount(data.shell.windows) : "..."}
          tooltip="50 ms windows in which sidebar updates were batched, across all subscribers."
        />
        <StatBlock
          label="Refetches"
          value={data ? formatCount(data.shell.liveRefetches + data.shell.catchUpRefetches) : "..."}
          tooltip={
            data
              ? `${formatCount(data.shell.liveRefetches)} live, ${formatCount(data.shell.catchUpRefetches)} while catching up, ${formatCount(data.shell.failures)} failed.`
              : undefined
          }
        />
        <StatBlock
          label="Most in a window"
          value={data ? formatCount(data.shell.maxRefetchesPerWindow) : "..."}
        />
      </StatsGrid>
    </SettingsSection>
  );
}
