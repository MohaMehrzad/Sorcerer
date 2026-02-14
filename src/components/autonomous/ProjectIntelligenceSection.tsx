import { signalBadgeClass } from "@/components/autonomous/helpers";
import { AgentRunResult } from "@/components/autonomous/types";
import { CollapsibleCard } from "@/components/autonomous/sectionPrimitives";

interface ProjectIntelligenceSectionProps {
  open: boolean;
  onToggle: (open: boolean) => void;
  result: AgentRunResult | null;
}

export default function ProjectIntelligenceSection({
  open,
  onToggle,
  result,
}: ProjectIntelligenceSectionProps) {
  return (
    <CollapsibleCard title="Project Intelligence" open={open} onToggle={onToggle}>
      {!result ? (
        <p className="text-xs text-neutral-400">
          No intelligence data yet. Start a run to inspect project digest and detected risk signals.
        </p>
      ) : (
        <>
          <div className="rounded-xl border border-black/10 dark:border-white/10 overflow-hidden">
            <div className="px-4 py-3 border-b border-black/10 dark:border-white/10 bg-white/70 dark:bg-neutral-900/40">
              <h3 className="text-sm font-semibold">Project Digest</h3>
            </div>
            <div className="p-4 space-y-2 text-xs">
              <div>
                Workspace: <span className="font-mono">{result.projectDigest.workspace}</span>
              </div>
              <div>
                Language hints:{" "}
                <span className="font-mono">
                  {result.projectDigest.languageHints.join(", ") || "(none)"}
                </span>
              </div>
              <div>
                Has tests: <span className="font-mono">{String(result.projectDigest.hasTests)}</span>
              </div>
              <div>
                Key directories:{" "}
                <span className="font-mono">
                  {result.projectDigest.keyDirectories.join(", ") || "(none)"}
                </span>
              </div>
              <details>
                <summary className="cursor-pointer text-xs text-neutral-500">Tree preview</summary>
                <pre className="mt-2 text-[11px] rounded bg-neutral-100 dark:bg-neutral-900 p-3 max-h-56 overflow-auto whitespace-pre-wrap">
                  {result.projectDigest.treePreview || "(none)"}
                </pre>
              </details>
            </div>
          </div>

          <div className="rounded-xl border border-black/10 dark:border-white/10 overflow-hidden">
            <div className="px-4 py-3 border-b border-black/10 dark:border-white/10 bg-white/70 dark:bg-neutral-900/40">
              <h3 className="text-sm font-semibold">Project Intelligence</h3>
            </div>
            <div className="p-4 space-y-3 text-xs">
              <div>
                Generated:{" "}
                <span className="font-mono">{result.projectIntelligence.generatedAt || "(unknown)"}</span>
              </div>
              <div>
                Workspace:{" "}
                <span className="font-mono">
                  {result.projectIntelligence.workspace || result.projectDigest.workspace}
                </span>
              </div>
              <div>
                Summary: <span className="font-mono">{result.projectIntelligence.summary || "(none)"}</span>
              </div>
              <div>
                Stack:{" "}
                <span className="font-mono">
                  {result.projectIntelligence.stack.join(", ") || "(none)"}
                </span>
              </div>
              <div>
                Top directories:{" "}
                <span className="font-mono">
                  {result.projectIntelligence.topDirectories.join(", ") || "(none)"}
                </span>
              </div>
              <div>
                Detected test files: <span className="font-mono">{result.projectIntelligence.testFileCount}</span>
              </div>

              <details open>
                <summary className="cursor-pointer text-xs text-neutral-500">Risk signals</summary>
                <div className="mt-2 space-y-2">
                  {result.projectIntelligence.signals.length === 0 ? (
                    <p className="text-[11px] text-neutral-500">(none)</p>
                  ) : (
                    result.projectIntelligence.signals.map((signal) => (
                      <div
                        key={signal.key}
                        className="rounded border border-black/10 dark:border-white/10 p-2 bg-white/80 dark:bg-neutral-900"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="font-medium">{signal.label}</div>
                          <span className={`px-1.5 py-0.5 rounded text-[11px] ${signalBadgeClass(signal.severity)}`}>
                            {signal.severity} • {signal.count}
                          </span>
                        </div>
                        {signal.samples.length > 0 && (
                          <details className="mt-1">
                            <summary className="cursor-pointer text-[11px] text-neutral-500">
                              samples ({signal.samples.length})
                            </summary>
                            <pre className="mt-1 text-[11px] rounded bg-neutral-100 dark:bg-neutral-900 p-2 max-h-48 overflow-auto whitespace-pre-wrap">
                              {signal.samples.join("\n")}
                            </pre>
                          </details>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </details>

              <details>
                <summary className="cursor-pointer text-xs text-neutral-500">Top hotspots</summary>
                <div className="mt-2 space-y-1">
                  {result.projectIntelligence.hotspots.length === 0 ? (
                    <p className="text-[11px] text-neutral-500">(none)</p>
                  ) : (
                    result.projectIntelligence.hotspots.slice(0, 20).map((hotspot) => (
                      <div
                        key={hotspot.path}
                        className="flex items-center justify-between gap-2 rounded border border-black/10 dark:border-white/10 px-2 py-1 bg-white/80 dark:bg-neutral-900"
                      >
                        <span className="font-mono truncate">{hotspot.path}</span>
                        <span className="font-mono">{hotspot.lines} lines</span>
                      </div>
                    ))
                  )}
                </div>
              </details>

              <details>
                <summary className="cursor-pointer text-xs text-neutral-500">
                  Module edges ({result.projectIntelligence.moduleEdges.length})
                </summary>
                <pre className="mt-2 text-[11px] rounded bg-neutral-100 dark:bg-neutral-900 p-3 max-h-56 overflow-auto whitespace-pre-wrap">
                  {result.projectIntelligence.moduleEdges.length > 0
                    ? result.projectIntelligence.moduleEdges
                        .slice(0, 80)
                        .map((edge) => `${edge.from} -> ${edge.to}`)
                        .join("\n")
                    : "(none)"}
                </pre>
              </details>
            </div>
          </div>

          {result.teamRoster.length > 0 && (
            <div className="rounded-xl border border-black/10 dark:border-white/10 overflow-hidden">
              <div className="px-4 py-3 border-b border-black/10 dark:border-white/10 bg-white/70 dark:bg-neutral-900/40">
                <h3 className="text-sm font-semibold">Virtual Team Roster ({result.teamRoster.length})</h3>
              </div>
              <div className="p-4">
                <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 text-xs">
                  {result.teamRoster.map((role, index) => (
                    <li
                      key={`${role}-${index}`}
                      className="rounded border border-black/10 dark:border-white/10 px-2 py-1.5 bg-white/80 dark:bg-neutral-900"
                    >
                      {index + 1}. {role}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </>
      )}
    </CollapsibleCard>
  );
}
