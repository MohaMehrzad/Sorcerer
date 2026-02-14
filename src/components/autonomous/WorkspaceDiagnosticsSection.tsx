import { commandToString } from "@/components/autonomous/helpers";
import { AgentRunResult } from "@/components/autonomous/types";
import { CollapsibleCard } from "@/components/autonomous/sectionPrimitives";

interface WorkspaceDiagnosticsSectionProps {
  open: boolean;
  onToggle: (open: boolean) => void;
  workspaceLoading: boolean;
  workspaceError: string | null;
  visibleWorkspaceFiles: string[];
  workspaceFiles: string[];
  filesAccessed: string[];
  filesEdited: string[];
  result: AgentRunResult | null;
}

export default function WorkspaceDiagnosticsSection({
  open,
  onToggle,
  workspaceLoading,
  workspaceError,
  visibleWorkspaceFiles,
  workspaceFiles,
  filesAccessed,
  filesEdited,
  result,
}: WorkspaceDiagnosticsSectionProps) {
  return (
    <CollapsibleCard title="Workspace & Diagnostics" open={open} onToggle={onToggle}>
      <div className="rounded-xl border border-black/10 dark:border-white/10 overflow-hidden">
        <div className="px-4 py-3 border-b border-black/10 dark:border-white/10 bg-white/70 dark:bg-neutral-900/40">
          <h3 className="text-sm font-semibold">Workspace Access Scope</h3>
        </div>
        <div className="p-4 space-y-2">
          <div className="text-xs text-neutral-500">Files visible to the agent before execution.</div>
          {workspaceLoading ? (
            <p className="text-xs text-neutral-500">Loading workspace files...</p>
          ) : workspaceError ? (
            <p className="text-xs text-red-600 dark:text-red-400">{workspaceError}</p>
          ) : visibleWorkspaceFiles.length === 0 ? (
            <p className="text-xs text-neutral-500">(no files discovered)</p>
          ) : (
            <>
              <ul className="space-y-1 max-h-60 overflow-auto pr-1">
                {visibleWorkspaceFiles.map((filePath) => (
                  <li
                    key={`scope-${filePath}`}
                    className="text-xs font-mono rounded border border-black/10 dark:border-white/10 px-2 py-1 bg-white/80 dark:bg-neutral-900"
                  >
                    {filePath}
                  </li>
                ))}
              </ul>
              {workspaceFiles.length > visibleWorkspaceFiles.length && (
                <p className="text-[11px] text-neutral-500">
                  Showing first {visibleWorkspaceFiles.length} of {workspaceFiles.length} files.
                </p>
              )}
            </>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-black/10 dark:border-white/10 overflow-hidden">
        <div className="px-4 py-3 border-b border-black/10 dark:border-white/10 bg-white/70 dark:bg-neutral-900/40">
          <h3 className="text-sm font-semibold">File Activity</h3>
        </div>
        <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-neutral-500 mb-2">
              Files Accessed ({filesAccessed.length})
            </div>
            {filesAccessed.length === 0 ? (
              <p className="text-xs text-neutral-500">(none yet)</p>
            ) : (
              <ul className="space-y-1 max-h-60 overflow-auto pr-1">
                {filesAccessed.map((filePath) => (
                  <li
                    key={`access-${filePath}`}
                    className="text-xs font-mono rounded border border-black/10 dark:border-white/10 px-2 py-1 bg-white/80 dark:bg-neutral-900"
                  >
                    {filePath}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-neutral-500 mb-2">
              Files Edited ({filesEdited.length})
            </div>
            {filesEdited.length === 0 ? (
              <p className="text-xs text-neutral-500">(none yet)</p>
            ) : (
              <ul className="space-y-1 max-h-60 overflow-auto pr-1">
                {filesEdited.map((filePath) => (
                  <li
                    key={`edited-${filePath}`}
                    className="text-xs font-mono rounded border border-black/10 dark:border-white/10 px-2 py-1 bg-white/80 dark:bg-neutral-900"
                  >
                    {filePath}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {result && result.preflightChecks.length > 0 && (
        <div className="rounded-xl border border-black/10 dark:border-white/10 overflow-hidden">
          <div className="px-4 py-3 border-b border-black/10 dark:border-white/10 bg-white/70 dark:bg-neutral-900/40">
            <h3 className="text-sm font-semibold">Preflight Checks</h3>
          </div>
          <div className="divide-y divide-black/10 dark:divide-white/10">
            {result.preflightChecks.map((check, index) => (
              <details key={`${check.attempt}-preflight-${index}`}>
                <summary className="list-none cursor-pointer px-4 py-3 hover:bg-black/5 dark:hover:bg-white/10 transition-colors">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-xs text-neutral-500">Preflight</div>
                      <div className="text-sm font-mono truncate">{commandToString(check.command)}</div>
                    </div>
                    <span
                      className={`shrink-0 px-2 py-1 rounded text-xs font-medium ${
                        check.ok
                          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                          : "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
                      }`}
                    >
                      {check.ok ? "pass" : "fail"}
                    </span>
                  </div>
                </summary>
                <div className="px-4 pb-4">
                  <pre className="text-xs rounded-lg bg-neutral-100 dark:bg-neutral-900 p-3 overflow-auto max-h-56 whitespace-pre-wrap">
                    {check.output || "(no output)"}
                  </pre>
                </div>
              </details>
            ))}
          </div>
        </div>
      )}

      {result && result.rollbackSummary.length > 0 && (
        <div className="rounded-xl border border-black/10 dark:border-white/10 overflow-hidden">
          <div className="px-4 py-3 border-b border-black/10 dark:border-white/10 bg-white/70 dark:bg-neutral-900/40">
            <h3 className="text-sm font-semibold">Rollback Summary</h3>
          </div>
          <ul className="p-4 text-xs space-y-1">
            {result.rollbackSummary.map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ul>
        </div>
      )}

      {result && result.changeJournal.length > 0 && (
        <div className="rounded-xl border border-black/10 dark:border-white/10 overflow-hidden">
          <div className="px-4 py-3 border-b border-black/10 dark:border-white/10 bg-white/70 dark:bg-neutral-900/40">
            <h3 className="text-sm font-semibold">Change Journal</h3>
          </div>
          <div className="divide-y divide-black/10 dark:divide-white/10">
            {result.changeJournal.map((entry, index) => (
              <div key={`${entry.timestamp}-${entry.path}-${index}`} className="px-4 py-3">
                <div className="text-xs text-neutral-500">{entry.timestamp}</div>
                <div className="text-sm font-mono">
                  [{entry.op}] {entry.path}
                </div>
                <div className="text-xs mt-1 whitespace-pre-wrap">{entry.details}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </CollapsibleCard>
  );
}
