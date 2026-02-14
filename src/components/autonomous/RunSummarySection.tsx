import {
  commandToString,
  formatDuration,
  formatIterationProgress,
  formatRunReport,
} from "@/components/autonomous/helpers";
import { AgentRunResult } from "@/components/autonomous/types";
import { SectionCard } from "@/components/autonomous/sectionPrimitives";

interface UnitTimelineMetric {
  unitId: string;
  status: "pending" | "running" | "completed" | "failed" | "blocked";
  attempts: number;
  durationMs: number;
  widthPercent: number;
}

interface RunSummarySectionProps {
  result: AgentRunResult | null;
  running: boolean;
  liveStepCount: number;
  maxIterations: number;
  verificationChecksCount: number;
  runDetailsOpen: boolean;
  setRunDetailsOpen: (open: boolean) => void;
  expertMode: boolean;
  unitTimelineMetrics: UnitTimelineMetric[];
  onPublishReport?: (report: string) => void;
  onDownloadTelemetry: (run: AgentRunResult) => void;
}

export default function RunSummarySection({
  result,
  running,
  liveStepCount,
  maxIterations,
  verificationChecksCount,
  runDetailsOpen,
  setRunDetailsOpen,
  expertMode,
  unitTimelineMetrics,
  onPublishReport,
  onDownloadTelemetry,
}: RunSummarySectionProps) {
  return (
    <SectionCard title="Run Summary">
      <p className="text-sm text-neutral-700 dark:text-neutral-300 whitespace-pre-wrap">
        {result
          ? result.summary || result.error || "No summary returned."
          : running
            ? "Autonomous run in progress..."
            : "No run yet. Set a goal and start an autonomous run."}
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs text-neutral-500">
        <div>
          Iterations:{" "}
          <span className="font-mono">
            {result
              ? formatIterationProgress(result.iterationsUsed, result.maxIterations)
              : formatIterationProgress(liveStepCount, maxIterations)}
          </span>
        </div>
        <div>
          Files changed: <span className="font-mono">{result ? result.filesChanged.length : "..."}</span>
        </div>
        <div>
          Verification checks: <span className="font-mono">{verificationChecksCount}</span>
        </div>
      </div>

      {result && (
        <details
          className="rounded-xl border border-black/10 dark:border-white/10 bg-white/70 dark:bg-neutral-950/70 p-3"
          open={runDetailsOpen}
          onToggle={(event) => setRunDetailsOpen(event.currentTarget.open)}
        >
          <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wider text-neutral-500">
            Run details
          </summary>
          <div className="mt-2 text-xs text-neutral-500 space-y-1">
            <div>
              Run ID: <span className="font-mono">{result.runId || "(unknown)"}</span>
            </div>
            <div>
              Resumed from: <span className="font-mono">{result.resumedFromRunId || "(fresh run)"}</span>
            </div>
            <div>
              Execution mode: <span className="font-mono">{result.executionMode}</span>
            </div>
            <div>
              Team size: <span className="font-mono">{result.teamSize}</span>
            </div>
            <div>
              Run preflight checks: <span className="font-mono">{String(result.runPreflightChecks)}</span>
            </div>
            <div>
              Preflight passed: <span className="font-mono">{String(result.preflightPassed)}</span>
            </div>
            <div>
              Zero known issues: <span className="font-mono">{String(result.zeroKnownIssues)}</span>
            </div>
            <div>
              Intelligence summary:{" "}
              <span className="font-mono">{result.projectIntelligence.summary || "(none)"}</span>
            </div>
            <div>
              File writes: <span className="font-mono">{result.fileWriteCount}</span>
            </div>
            <div>
              Command runs: <span className="font-mono">{result.commandRunCount}</span>
            </div>
            <div>
              Verification attempts: <span className="font-mono">{result.verificationAttempts}</span>
            </div>
            <div>
              Verification passed: <span className="font-mono">{String(result.verificationPassed)}</span>
            </div>
            <div>
              Rollback on failure: <span className="font-mono">{String(result.rollbackOnFailure)}</span>
            </div>
            <div>
              Rollback applied: <span className="font-mono">{String(result.rollbackApplied)}</span>
            </div>
            {result.multiAgentReport && (
              <div>
                Work units: <span className="font-mono">{result.multiAgentReport.workUnits.length}</span>
              </div>
            )}
          </div>

          {result.verificationCommands.length > 0 && (
            <div className="mt-3">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500 mb-1">
                Quality Gates
              </div>
              <ul className="space-y-1 text-xs font-mono">
                {result.verificationCommands.map((command, index) => (
                  <li key={`${commandToString(command)}-${index}`}>{commandToString(command)}</li>
                ))}
              </ul>
            </div>
          )}

          {expertMode && result.multiAgentReport?.observability && (
            <div className="mt-3">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500 mb-1">
                Multi-Agent Observability
              </div>
              <div className="text-xs text-neutral-500 space-y-1">
                <div>
                  Total runtime:{" "}
                  <span className="font-mono">
                    {Math.round(result.multiAgentReport.observability.totalDurationMs / 1000)}s
                  </span>
                </div>
                <div>
                  Flaky quarantined commands:{" "}
                  <span className="font-mono">
                    {result.multiAgentReport.flakyQuarantinedCommands.join(", ") || "(none)"}
                  </span>
                </div>
              </div>

              {result.multiAgentReport.observability.modelUsage.length > 0 && (
                <ul className="mt-2 space-y-1 text-xs font-mono">
                  {result.multiAgentReport.observability.modelUsage.map((metric) => (
                    <li key={`${metric.role}-${metric.tier}`}>
                      {metric.role}/{metric.tier} calls={metric.calls} retries={metric.retries} cache=
                      {metric.cacheHits} escalations={metric.escalations} cost=
                      {metric.estimatedCostUnits.toFixed(0)}
                    </li>
                  ))}
                </ul>
              )}

              {result.multiAgentReport.observability.failureHeatmap.length > 0 && (
                <ul className="mt-2 space-y-1 text-xs font-mono">
                  {result.multiAgentReport.observability.failureHeatmap.slice(0, 6).map((entry) => (
                    <li key={entry.label}>
                      {entry.label}: {entry.count}
                    </li>
                  ))}
                </ul>
              )}

              {unitTimelineMetrics.length > 0 && (
                <div className="mt-3 space-y-1.5">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
                    Unit Timeline
                  </div>
                  {unitTimelineMetrics.map((metric) => (
                    <div
                      key={`${metric.unitId}-${metric.attempts}`}
                      className="rounded border border-black/10 dark:border-white/10 p-2"
                    >
                      <div className="flex items-center justify-between gap-2 text-[11px] font-mono">
                        <span className="truncate">
                          {metric.unitId} [{metric.status}]
                        </span>
                        <span>
                          {formatDuration(metric.durationMs)} | tries={metric.attempts}
                        </span>
                      </div>
                      <div className="mt-1 h-1.5 rounded bg-neutral-200 dark:bg-neutral-800 overflow-hidden">
                        <div
                          className={`h-full ${
                            metric.status === "completed"
                              ? "bg-emerald-500"
                              : metric.status === "failed" || metric.status === "blocked"
                                ? "bg-red-500"
                                : "bg-amber-500"
                          }`}
                          style={{ width: `${metric.widthPercent}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </details>
      )}

      {result && (
        <div className="flex flex-wrap items-center gap-2">
          {onPublishReport && (
            <button
              onClick={() => onPublishReport(formatRunReport(result))}
              className="px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/10 text-sm transition-colors cursor-pointer"
            >
              Publish Report To Chat
            </button>
          )}
          <button
            onClick={() => onDownloadTelemetry(result)}
            className="px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/10 text-sm transition-colors cursor-pointer"
          >
            Export Telemetry JSON
          </button>
        </div>
      )}
    </SectionCard>
  );
}
