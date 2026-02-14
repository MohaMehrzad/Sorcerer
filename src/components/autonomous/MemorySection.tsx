import { RefObject } from "react";
import {
  ContinuationPacket,
  LongTermMemoryEntry,
  MemoryRetrievalDiagnostics,
} from "@/components/autonomous/types";
import { CollapsibleCard } from "@/components/autonomous/sectionPrimitives";

interface MemorySectionProps {
  open: boolean;
  onToggle: (open: boolean) => void;
  memoryLoading: boolean;
  memoryRetrieveLoading: boolean;
  memoryQuery: string;
  setMemoryQuery: (value: string) => void;
  memoryImportMode: "merge" | "replace";
  setMemoryImportMode: (value: "merge" | "replace") => void;
  memoryImportInputRef: RefObject<HTMLInputElement | null>;
  memoryError: string | null;
  latestContinuation: ContinuationPacket | null;
  memoryContextBlock: string;
  memoryDiagnostics: MemoryRetrievalDiagnostics | null;
  memoryEntries: LongTermMemoryEntry[];
  onRefresh: () => Promise<void>;
  onRetrieve: () => Promise<void>;
  onExport: () => Promise<void>;
  onImport: (file: File, mode: "merge" | "replace") => Promise<void>;
  onTogglePin: (entry: LongTermMemoryEntry) => Promise<void>;
  onForget: (entry: LongTermMemoryEntry) => Promise<void>;
}

export default function MemorySection({
  open,
  onToggle,
  memoryLoading,
  memoryRetrieveLoading,
  memoryQuery,
  setMemoryQuery,
  memoryImportMode,
  setMemoryImportMode,
  memoryImportInputRef,
  memoryError,
  latestContinuation,
  memoryContextBlock,
  memoryDiagnostics,
  memoryEntries,
  onRefresh,
  onRetrieve,
  onExport,
  onImport,
  onTogglePin,
  onForget,
}: MemorySectionProps) {
  return (
    <CollapsibleCard title="Long-term Memory" open={open} onToggle={onToggle}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Memory Vault</h3>
        <button
          onClick={() => void onRefresh()}
          className="text-xs px-2 py-1 rounded border border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
          disabled={memoryLoading}
        >
          {memoryLoading ? "Loading..." : "Refresh"}
        </button>
      </div>

      <div className="flex items-center gap-2">
        <input
          type="text"
          value={memoryQuery}
          onChange={(event) => setMemoryQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void onRetrieve();
            }
          }}
          placeholder="Retrieve memory by query..."
          className="min-w-0 flex-1 rounded border border-black/10 dark:border-white/10 px-2 py-1 text-xs bg-white/80 dark:bg-neutral-950"
        />
        <button
          onClick={() => void onRetrieve()}
          className="text-xs px-2 py-1 rounded border border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
          disabled={memoryRetrieveLoading || memoryQuery.trim().length === 0}
        >
          {memoryRetrieveLoading ? "..." : "Retrieve"}
        </button>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => void onExport()}
          className="text-xs px-2 py-1 rounded border border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
        >
          Export
        </button>
        <select
          value={memoryImportMode}
          onChange={(event) =>
            setMemoryImportMode(event.target.value === "replace" ? "replace" : "merge")
          }
          className="min-w-0 flex-1 rounded border border-black/10 dark:border-white/10 px-2 py-1 text-xs bg-white/80 dark:bg-neutral-950"
        >
          <option value="merge">Import merge</option>
          <option value="replace">Import replace</option>
        </select>
        <button
          onClick={() => memoryImportInputRef.current?.click()}
          className="text-xs px-2 py-1 rounded border border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
        >
          Import
        </button>
        <input
          ref={memoryImportInputRef}
          type="file"
          accept="application/json"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            void onImport(file, memoryImportMode);
          }}
        />
      </div>

      {memoryError && <p className="text-xs text-red-600 dark:text-red-400">{memoryError}</p>}

      {latestContinuation && (
        <details className="rounded border border-black/10 dark:border-white/10 px-2 py-1">
          <summary className="cursor-pointer text-xs text-neutral-500">
            Latest continuation ({latestContinuation.executionMode})
          </summary>
          <div className="mt-1 space-y-1 text-[11px]">
            <div>
              Run: <span className="font-mono">{latestContinuation.runId}</span>
            </div>
            <div>
              Goal: <span className="font-mono">{latestContinuation.goal}</span>
            </div>
            <div>
              Summary: <span className="font-mono">{latestContinuation.summary}</span>
            </div>
          </div>
        </details>
      )}

      {memoryContextBlock && (
        <details className="rounded border border-black/10 dark:border-white/10 px-2 py-1">
          <summary className="cursor-pointer text-xs text-neutral-500">Retrieved context preview</summary>
          <pre className="mt-1 text-[11px] rounded bg-neutral-100 dark:bg-neutral-950 p-2 max-h-44 overflow-auto whitespace-pre-wrap">
            {memoryContextBlock}
          </pre>
        </details>
      )}

      {memoryDiagnostics && (
        <div className="rounded border border-black/10 dark:border-white/10 px-2 py-1 text-[11px] space-y-1">
          <div>
            conflicts: <span className="font-mono">{memoryDiagnostics.conflictCount}</span>
          </div>
          <div>
            evidence gate:{" "}
            <span className="font-mono">
              {String(memoryDiagnostics.requiresVerificationBeforeMutation)}
            </span>
          </div>
          {memoryDiagnostics.guidance.length > 0 && (
            <ul className="list-disc list-inside text-neutral-500">
              {memoryDiagnostics.guidance.slice(0, 2).map((item, index) => (
                <li key={`memory-guidance-${index}`}>{item}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {memoryEntries.length === 0 ? (
        <p className="text-xs text-neutral-400">
          {memoryLoading ? "Loading memory..." : "No memory entries yet."}
        </p>
      ) : (
        <div className="space-y-2 max-h-80 overflow-auto pr-1">
          {memoryEntries.slice(0, 24).map((entry) => (
            <div
              key={entry.id}
              className="rounded border border-black/10 dark:border-white/10 p-2 bg-white/80 dark:bg-neutral-950"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-medium truncate">{entry.title}</span>
                <span className="text-[10px] text-neutral-500">{entry.type}</span>
              </div>
              <p className="mt-1 text-[11px] text-neutral-600 dark:text-neutral-300 line-clamp-3">
                {entry.content}
              </p>
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="text-[10px] text-neutral-500">
                  confidence=
                  {(typeof entry.confidenceScore === "number" ? entry.confidenceScore : entry.successScore).toFixed(
                    2
                  )}{" "}
                  uses={entry.useCount}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => void onTogglePin(entry)}
                    className="text-[10px] px-1.5 py-1 rounded border border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer"
                  >
                    {entry.pinned ? "Unpin" : "Pin"}
                  </button>
                  <button
                    onClick={() => void onForget(entry)}
                    className="text-[10px] px-1.5 py-1 rounded border border-red-300 text-red-600 dark:border-red-800 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 cursor-pointer"
                  >
                    Forget
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </CollapsibleCard>
  );
}
