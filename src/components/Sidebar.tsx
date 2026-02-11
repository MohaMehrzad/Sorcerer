"use client";

import { WorkspaceEntry } from "@/lib/store";

interface SidebarProps {
  workspaces: WorkspaceEntry[];
  activeWorkspaceId: string | null;
  onSelectWorkspace: (id: string) => void;
  onNewWorkspace: () => void | Promise<void>;
  onDeleteWorkspace: (id: string) => void;
  botName: string;
  modelName: string;
  workspacePath: string;
  onOpenBotSetup: () => void;
  newWorkspaceLoading?: boolean;
  open: boolean;
  onClose: () => void;
}

function formatDate(ts: number): string {
  const date = new Date(ts);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const days = Math.floor(diff / 86400000);

  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function Sidebar({
  workspaces,
  activeWorkspaceId,
  onSelectWorkspace,
  onNewWorkspace,
  onDeleteWorkspace,
  botName,
  modelName,
  workspacePath,
  onOpenBotSetup,
  newWorkspaceLoading = false,
  open,
  onClose,
}: SidebarProps) {
  const sorted = [...workspaces].sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <>
      {open && (
        <div className="fixed inset-0 bg-black/40 z-30 md:hidden" onClick={onClose} />
      )}

      <aside
        className={`fixed md:relative z-40 top-0 left-0 h-dvh w-80 bg-neutral-50 dark:bg-neutral-900 border-r border-neutral-200 dark:border-neutral-800 flex flex-col transition-transform duration-200 ${
          open ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        }`}
      >
        <div className="p-3 border-b border-neutral-200 dark:border-neutral-800">
          <button
            onClick={() => {
              onNewWorkspace();
              onClose();
            }}
            disabled={newWorkspaceLoading}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors cursor-pointer"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            {newWorkspaceLoading ? "Opening Picker..." : "New Workspace"}
          </button>
        </div>

        <div className="px-4 py-2 text-[11px] font-semibold text-neutral-400 uppercase tracking-wider border-b border-neutral-200 dark:border-neutral-800">
          Workspaces
        </div>

        <div className="flex-1 overflow-y-auto">
          {sorted.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-neutral-400">
              No workspaces yet
            </div>
          ) : (
            <div className="p-2 space-y-2">
              {sorted.map((workspace) => {
                const isActive = workspace.id === activeWorkspaceId;
                return (
                  <div
                    key={workspace.id}
                    className={`group rounded-lg border ${
                      isActive
                        ? "border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/20"
                        : "border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 hover:bg-neutral-100 dark:hover:bg-neutral-800/50"
                    }`}
                  >
                    <div className="flex items-start gap-2 p-3">
                      <button
                        onClick={() => {
                          onSelectWorkspace(workspace.id);
                          onClose();
                        }}
                        className="flex-1 text-left min-w-0 cursor-pointer"
                      >
                        <div className="text-sm font-medium truncate text-neutral-800 dark:text-neutral-200">
                          {workspace.name}
                        </div>
                        <div
                          className="text-[11px] text-neutral-500 mt-1 truncate font-mono"
                          title={workspace.path}
                        >
                          {workspace.path}
                        </div>
                        <div className="text-[11px] text-neutral-400 mt-1">
                          Updated {formatDate(workspace.updatedAt)}
                        </div>
                      </button>
                      <button
                        onClick={(event) => {
                          event.stopPropagation();
                          onDeleteWorkspace(workspace.id);
                        }}
                        className="p-1.5 rounded-md opacity-0 group-hover:opacity-100 hover:bg-red-100 dark:hover:bg-red-900/30 text-neutral-400 hover:text-red-500 transition-all cursor-pointer"
                        title="Remove workspace"
                      >
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
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        </svg>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="p-3 border-t border-neutral-200 dark:border-neutral-800">
          <div className="flex items-center justify-between gap-2 px-2 text-[11px] text-neutral-400">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-green-500" />
                <span className="truncate">{botName}</span>
              </div>
              <div className="font-mono truncate mt-1">{modelName}</div>
              <div className="font-mono truncate mt-1" title={workspacePath}>
                {workspacePath}
              </div>
            </div>
            <button
              onClick={onOpenBotSetup}
              className="px-2 py-1 rounded border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-[11px] transition-colors cursor-pointer"
              title="Configure bot"
            >
              Setup
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
