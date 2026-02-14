import { AgentSettings } from "@/components/autonomous/types";
import { clamp, normalizeMaxIterations } from "@/components/autonomous/helpers";
import { SectionCard } from "@/components/autonomous/sectionPrimitives";

interface GoalSectionProps {
  workspacePath?: string;
  goal: string;
  setGoal: (goal: string) => void;
  settings: AgentSettings;
  running: boolean;
  canRun: boolean;
  showAdvanced: boolean;
  expertMode: boolean;
  setShowAdvanced: (open: boolean) => void;
  onUpdateSettings: <K extends keyof AgentSettings>(
    key: K,
    value: AgentSettings[K]
  ) => void;
  onApplyCodingDefaults: () => void;
  onRun: () => void;
  onCancel: () => void;
  statusMessage: string | null;
  error: string | null;
}

export default function GoalSection({
  workspacePath,
  goal,
  setGoal,
  settings,
  running,
  canRun,
  showAdvanced,
  expertMode,
  setShowAdvanced,
  onUpdateSettings,
  onApplyCodingDefaults,
  onRun,
  onCancel,
  statusMessage,
  error,
}: GoalSectionProps) {
  return (
    <SectionCard title="Goal">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[11px] text-neutral-400 font-mono">
          Workspace: {workspacePath?.trim() || "(default workspace)"}
        </p>
        {settings.dryRun && (
          <span className="px-2 py-1 rounded-full bg-amber-500/20 text-amber-300 text-[11px] font-medium">
            Dry run enabled
          </span>
        )}
      </div>

      <textarea
        value={goal}
        onChange={(event) => setGoal(event.target.value)}
        placeholder="Example: Implement JWT auth, migrate DB schema, add tests, run lint/typecheck/build, and resolve all failures."
        className="w-full min-h-[120px] max-h-64 resize-y rounded-2xl border border-white/15 bg-neutral-800 px-4 py-3 text-sm text-neutral-100 focus:outline-none focus:ring-2 focus:ring-emerald-400"
        disabled={running}
      />

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-xs text-neutral-400">
          <span>Execution mode</span>
          <select
            value={settings.executionMode}
            onChange={(event) =>
              onUpdateSettings(
                "executionMode",
                event.target.value === "single" ? "single" : "multi"
              )
            }
            className="rounded-xl border border-white/15 bg-neutral-800 px-2 py-1 text-sm text-neutral-100"
            disabled={running}
          >
            <option value="multi">Multi-agent async</option>
            <option value="single">Single-agent (legacy)</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs text-neutral-400">
          <span>Max iterations</span>
          <input
            type="number"
            min={0}
            max={40}
            value={settings.maxIterations}
            onChange={(event) => {
              const value = Number(event.target.value);
              if (!Number.isFinite(value)) return;
              onUpdateSettings("maxIterations", normalizeMaxIterations(value));
            }}
            className="w-20 rounded-xl border border-white/15 bg-neutral-800 px-2 py-1 text-sm text-neutral-100"
            disabled={running}
          />
        </label>
        <span className="text-[11px] text-neutral-500">0 = unbounded</span>

        <button
          onClick={onApplyCodingDefaults}
          disabled={running}
          className="text-xs px-3 py-2 rounded-xl border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/15 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          type="button"
        >
          Coding Defaults
        </button>

        <button
          onClick={onRun}
          disabled={!canRun}
          className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-2xl bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
        >
          {running ? (
            <>
              <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                <circle
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="3"
                  className="opacity-25"
                />
                <path
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  fill="currentColor"
                  className="opacity-75"
                />
              </svg>
              Running...
            </>
          ) : (
            <>
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
              Start Run
            </>
          )}
        </button>

        {running && (
          <button
            onClick={onCancel}
            className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-2xl border border-black/10 dark:border-white/10 text-sm hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
          >
            Cancel
          </button>
        )}
      </div>

      <details
        className="rounded-xl border border-black/10 dark:border-white/10 bg-white/70 dark:bg-neutral-950/70 p-3"
        open={showAdvanced || expertMode}
        onToggle={(event) => setShowAdvanced(event.currentTarget.open)}
      >
        <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wider text-neutral-500">
          Advanced settings
        </summary>
        <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="flex items-center justify-between gap-2 text-xs md:col-span-1">
            <span>Run preflight checks</span>
            <input
              type="checkbox"
              checked={settings.runPreflightChecks}
              onChange={(event) => onUpdateSettings("runPreflightChecks", event.target.checked)}
              disabled={running}
            />
          </label>
          <label className="flex items-center justify-between gap-2 text-xs md:col-span-1">
            <span>Resume from latest checkpoint</span>
            <input
              type="checkbox"
              checked={settings.resumeFromLastCheckpoint}
              onChange={(event) =>
                onUpdateSettings("resumeFromLastCheckpoint", event.target.checked)
              }
              disabled={running}
            />
          </label>
          <label className="flex items-center justify-between gap-2 text-xs md:col-span-1">
            <span>Require clarification before edits</span>
            <input
              type="checkbox"
              checked={settings.requireClarificationBeforeEdits}
              onChange={(event) =>
                onUpdateSettings("requireClarificationBeforeEdits", event.target.checked)
              }
              disabled={running}
            />
          </label>
          <label className="flex items-center justify-between gap-2 text-xs md:col-span-1">
            <span>Strict verification</span>
            <input
              type="checkbox"
              checked={settings.strictVerification}
              onChange={(event) => onUpdateSettings("strictVerification", event.target.checked)}
              disabled={running}
            />
          </label>
          <label className="flex items-center justify-between gap-2 text-xs md:col-span-1">
            <span>Auto-fix on failed gates</span>
            <input
              type="checkbox"
              checked={settings.autoFixVerification}
              onChange={(event) => onUpdateSettings("autoFixVerification", event.target.checked)}
              disabled={running}
            />
          </label>
          <label className="flex items-center justify-between gap-2 text-xs md:col-span-1">
            <span>Dry run (no writes/deletes)</span>
            <input
              type="checkbox"
              checked={settings.dryRun}
              onChange={(event) => onUpdateSettings("dryRun", event.target.checked)}
              disabled={running}
            />
          </label>
          <label className="flex items-center justify-between gap-2 text-xs md:col-span-1">
            <span>Rollback on failure</span>
            <input
              type="checkbox"
              checked={settings.rollbackOnFailure}
              onChange={(event) => onUpdateSettings("rollbackOnFailure", event.target.checked)}
              disabled={running}
            />
          </label>

          <label className="flex items-center justify-between gap-2 text-xs md:col-span-1">
            <span>Max file writes</span>
            <input
              type="number"
              min={1}
              max={120}
              value={settings.maxFileWrites}
              onChange={(event) => {
                const value = Number(event.target.value);
                if (!Number.isFinite(value)) return;
                onUpdateSettings("maxFileWrites", clamp(value, 1, 120));
              }}
              className="w-20 rounded border border-black/10 dark:border-white/10 px-2 py-1 bg-white/80 dark:bg-neutral-900"
              disabled={running}
            />
          </label>

          <label className="flex items-center justify-between gap-2 text-xs md:col-span-1">
            <span>Max command runs</span>
            <input
              type="number"
              min={1}
              max={140}
              value={settings.maxCommandRuns}
              onChange={(event) => {
                const value = Number(event.target.value);
                if (!Number.isFinite(value)) return;
                onUpdateSettings("maxCommandRuns", clamp(value, 1, 140));
              }}
              className="w-20 rounded border border-black/10 dark:border-white/10 px-2 py-1 bg-white/80 dark:bg-neutral-900"
              disabled={running}
            />
          </label>
          <label className="flex items-center justify-between gap-2 text-xs md:col-span-1">
            <span>Max parallel work units</span>
            <input
              type="number"
              min={1}
              max={8}
              value={settings.maxParallelWorkUnits}
              onChange={(event) => {
                const value = Number(event.target.value);
                if (!Number.isFinite(value)) return;
                onUpdateSettings("maxParallelWorkUnits", clamp(value, 1, 8));
              }}
              className="w-20 rounded border border-black/10 dark:border-white/10 px-2 py-1 bg-white/80 dark:bg-neutral-900"
              disabled={running || settings.executionMode !== "multi"}
            />
          </label>

          <label className="flex items-center justify-between gap-2 text-xs md:col-span-1">
            <span>Critic pass threshold</span>
            <input
              type="number"
              min={0.2}
              max={0.95}
              step={0.01}
              value={settings.criticPassThreshold}
              onChange={(event) => {
                const value = Number(event.target.value);
                if (!Number.isFinite(value)) return;
                onUpdateSettings("criticPassThreshold", Math.max(0.2, Math.min(0.95, value)));
              }}
              className="w-20 rounded border border-black/10 dark:border-white/10 px-2 py-1 bg-white/80 dark:bg-neutral-900"
              disabled={running || settings.executionMode !== "multi"}
            />
          </label>

          <label className="flex flex-col gap-1 text-xs md:col-span-2">
            <span className="text-neutral-500">Model override (optional)</span>
            <input
              type="text"
              value={settings.modelOverride}
              onChange={(event) => onUpdateSettings("modelOverride", event.target.value)}
              className="w-full rounded border border-black/10 dark:border-white/10 px-2 py-1.5 bg-white/80 dark:bg-neutral-900"
              placeholder="e.g. qwen3:30b-128k"
              disabled={running}
            />
          </label>

          <label className="flex flex-col gap-1 text-xs md:col-span-2">
            <span className="text-neutral-500">
              Custom verification commands (one per line, optional)
            </span>
            <textarea
              value={settings.customVerificationCommands}
              onChange={(event) => onUpdateSettings("customVerificationCommands", event.target.value)}
              className="w-full min-h-[96px] rounded border border-black/10 dark:border-white/10 px-2 py-1.5 bg-white/80 dark:bg-neutral-900 font-mono text-[11px]"
              placeholder={"pnpm -s lint\npnpm -s exec tsc --noEmit\npnpm -s build"}
              disabled={running}
            />
          </label>
        </div>
      </details>

      {statusMessage && <p className="text-xs text-neutral-500">{statusMessage}</p>}
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
    </SectionCard>
  );
}
