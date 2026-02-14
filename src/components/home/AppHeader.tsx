import { BotProfile, WorkspaceEntry } from "@/lib/store";

interface AppHeaderProps {
  botProfile: BotProfile | null;
  workspaces: WorkspaceEntry[];
  activeWorkspaceId: string | null;
  activeWorkspacePath: string;
  workspacePickerBusy: boolean;
  workspacePickerError: string | null;
  onSelectWorkspace: (id: string) => void;
  onNewWorkspace: () => void;
  onOpenSetup: () => void;
  onRemoveWorkspace: () => void;
}

export default function AppHeader({
  botProfile,
  workspaces,
  activeWorkspaceId,
  activeWorkspacePath,
  workspacePickerBusy,
  workspacePickerError,
  onSelectWorkspace,
  onNewWorkspace,
  onOpenSetup,
  onRemoveWorkspace,
}: AppHeaderProps) {
  return (
    <header className="sticky top-0 z-30 border-b border-white/10 bg-neutral-900/95 backdrop-blur">
      <div className="px-4 sm:px-6 py-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-neutral-400">Sorcerer</p>
          <h1 className="text-xl font-semibold text-neutral-100">Autonomous Coding Studio</h1>
          <p className="text-sm text-neutral-400">
            Configure a workspace, set a goal, and let the agent run.
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="w-full sm:w-auto sm:min-w-[260px]">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
                Workspace
              </div>
              <span className="text-[11px] text-neutral-500">{workspaces.length} saved</span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <select
                value={activeWorkspaceId || ""}
                onChange={(event) => onSelectWorkspace(event.target.value)}
                disabled={workspaces.length === 0}
                className="w-full sm:w-auto sm:min-w-[220px] rounded-xl border border-white/15 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:ring-2 focus:ring-emerald-400"
              >
                <option value="" disabled>
                  {workspaces.length === 0 ? "No workspaces yet" : "Select workspace"}
                </option>
                {workspaces.map((workspace) => (
                  <option key={workspace.id} value={workspace.id}>
                    {workspace.name}
                  </option>
                ))}
              </select>
              <button
                onClick={onNewWorkspace}
                disabled={workspacePickerBusy}
                className="px-3 py-2 rounded-xl bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors cursor-pointer"
              >
                {workspacePickerBusy ? "Opening..." : "New"}
              </button>
              <button
                onClick={onOpenSetup}
                className="px-3 py-2 rounded-xl border border-white/15 bg-neutral-800 text-sm hover:bg-neutral-700 transition-colors cursor-pointer"
              >
                Setup
              </button>
              <button
                onClick={onRemoveWorkspace}
                disabled={!activeWorkspaceId}
                className="px-3 py-2 rounded-xl border border-red-500/50 text-red-300 text-sm hover:bg-red-900/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
              >
                Remove
              </button>
            </div>
            <div className="mt-1 text-xs text-neutral-400 font-mono truncate" title={activeWorkspacePath}>
              {activeWorkspacePath}
            </div>
          </div>

          <div className="w-full sm:w-auto flex flex-col gap-1">
            <span className="text-xs uppercase tracking-wider text-neutral-400">Active Bot</span>
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-300 text-xs font-medium">
                {botProfile?.botName || "Assistant"}
              </span>
              <span className="px-2.5 py-1 rounded-full bg-neutral-800 text-xs font-mono text-neutral-300">
                {botProfile?.model || "Not configured"}
              </span>
            </div>
          </div>
        </div>
      </div>

      {workspacePickerError && (
        <div className="px-6 pb-4">
          <div className="rounded-xl border border-red-500/40 bg-red-900/20 px-3 py-2 text-xs text-red-300">
            {workspacePickerError}
          </div>
        </div>
      )}
    </header>
  );
}
