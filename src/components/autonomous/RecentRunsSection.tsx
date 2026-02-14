import { formatRunReport, statusBadgeClass } from "@/components/autonomous/helpers";
import { AgentRunResult } from "@/components/autonomous/types";
import { CollapsibleCard } from "@/components/autonomous/sectionPrimitives";

interface RecentRunsSectionProps {
  open: boolean;
  onToggle: (open: boolean) => void;
  history: AgentRunResult[];
  onClear: () => void;
  onLoad: (run: AgentRunResult) => void;
  onDownloadTelemetry: (run: AgentRunResult) => void;
  onPublishReport?: (report: string) => void;
}

export default function RecentRunsSection({
  open,
  onToggle,
  history,
  onClear,
  onLoad,
  onDownloadTelemetry,
  onPublishReport,
}: RecentRunsSectionProps) {
  return (
    <CollapsibleCard title="Recent Runs" open={open} onToggle={onToggle}>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Run History</h3>
        {history.length > 0 && (
          <button
            onClick={onClear}
            className="text-xs text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300 cursor-pointer"
          >
            Clear
          </button>
        )}
      </div>

      {history.length === 0 ? (
        <p className="text-xs text-neutral-400">No run history yet.</p>
      ) : (
        <div className="space-y-2">
          {history.map((item, index) => (
            <div
              key={`${item.finishedAt}-${index}`}
              className="rounded-lg border border-black/10 dark:border-white/10 bg-white/80 dark:bg-neutral-900 p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <span className={`px-2 py-0.5 rounded text-[11px] font-medium ${statusBadgeClass(item.status)}`}>
                  {item.status.replace("_", " ")}
                </span>
                <span className="text-[11px] text-neutral-500">{new Date(item.finishedAt).toLocaleString()}</span>
              </div>

              <p className="mt-2 text-xs text-neutral-700 dark:text-neutral-300 line-clamp-3">{item.goal}</p>

              <div className="mt-2 flex items-center gap-2">
                <button
                  onClick={() => onLoad(item)}
                  className="text-xs px-2 py-1 rounded border border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
                >
                  Load
                </button>
                {onPublishReport && (
                  <button
                    onClick={() => onPublishReport(formatRunReport(item))}
                    className="text-xs px-2 py-1 rounded border border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
                  >
                    Publish
                  </button>
                )}
                <button
                  onClick={() => onDownloadTelemetry(item)}
                  className="text-xs px-2 py-1 rounded border border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
                >
                  Export JSON
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </CollapsibleCard>
  );
}
