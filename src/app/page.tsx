"use client";

import { useEffect, useMemo, useState } from "react";
import AutonomousPanel from "@/components/AutonomousPanel";
import BotOnboarding from "@/components/BotOnboarding";
import { apiFetch } from "@/lib/client/apiFetch";
import {
  BotProfile,
  WorkspaceEntry,
  loadBotProfile,
  loadWorkspaces,
  saveBotProfile,
  saveWorkspaces,
  upsertWorkspaceEntry,
} from "@/lib/store";

export default function Home() {
  const [botProfile, setBotProfile] = useState<BotProfile | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceEntry[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const [workspacePickerBusy, setWorkspacePickerBusy] = useState(false);
  const [workspacePickerError, setWorkspacePickerError] = useState<string | null>(null);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [onboardingSeed, setOnboardingSeed] = useState<BotProfile | null>(null);
  const [onboardingKey, setOnboardingKey] = useState(0);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const savedProfile = loadBotProfile();
      const savedWorkspaces = loadWorkspaces();

      if (savedProfile) {
        setBotProfile(savedProfile);
        setOnboardingSeed(savedProfile);

        const seeded = upsertWorkspaceEntry(savedWorkspaces, savedProfile.workspacePath);
        setWorkspaces(seeded.workspaces);
        setActiveWorkspaceId(seeded.entry.id);

        const hadWorkspace = savedWorkspaces.some(
          (workspace) => workspace.path === seeded.entry.path
        );
        if (!hadWorkspace) {
          saveWorkspaces(seeded.workspaces);
        }
      } else {
        setWorkspaces(savedWorkspaces);
        setActiveWorkspaceId(savedWorkspaces[0]?.id || null);
        setOnboardingSeed(null);
        setOnboardingOpen(true);
      }

      setHydrated(true);
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    saveWorkspaces(workspaces);
  }, [hydrated, workspaces]);

  const activeWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === activeWorkspaceId) || null,
    [workspaces, activeWorkspaceId]
  );

  const activeWorkspacePath = activeWorkspace?.path || botProfile?.workspacePath || ".";

  useEffect(() => {
    if (!hydrated || !activeWorkspacePath) return;

    apiFetch("/api/workspace/pick", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ workspacePath: activeWorkspacePath }),
    }).catch(() => {
      // Workspace registration is best-effort.
    });
  }, [activeWorkspacePath, hydrated]);

  function openOnboarding(initial: BotProfile | null) {
    setOnboardingSeed(initial);
    setOnboardingKey((value) => value + 1);
    setOnboardingOpen(true);
  }

  function handleSaveBotProfile(profile: BotProfile) {
    setBotProfile(profile);
    saveBotProfile(profile);

    setWorkspaces((prev) => {
      const seeded = upsertWorkspaceEntry(prev, profile.workspacePath);
      setActiveWorkspaceId(seeded.entry.id);
      return seeded.workspaces;
    });

    setOnboardingSeed(profile);
    setOnboardingOpen(false);
  }

  async function handleNewWorkspace() {
    if (!botProfile) {
      openOnboarding(null);
      return;
    }

    setWorkspacePickerBusy(true);
    setWorkspacePickerError(null);

    try {
      const response = await apiFetch("/api/workspace/pick", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });

      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        canceled?: boolean;
        workspacePath?: string;
      };

      if (!response.ok) {
        throw new Error(data.error || `Workspace picker failed (${response.status})`);
      }

      if (data.canceled) {
        return;
      }

      const pickedPath = typeof data.workspacePath === "string" ? data.workspacePath.trim() : "";
      if (!pickedPath) {
        throw new Error("Workspace picker returned an empty path.");
      }

      setWorkspaces((prev) => {
        const seeded = upsertWorkspaceEntry(prev, pickedPath);
        setActiveWorkspaceId(seeded.entry.id);

        const nextProfile: BotProfile = {
          ...botProfile,
          workspacePath: seeded.entry.path,
          updatedAt: Date.now(),
        };
        setBotProfile(nextProfile);
        saveBotProfile(nextProfile);

        return seeded.workspaces;
      });
    } catch (err) {
      setWorkspacePickerError(
        err instanceof Error ? err.message : "Failed to open workspace picker."
      );
    } finally {
      setWorkspacePickerBusy(false);
    }
  }

  function handleSelectWorkspace(id: string) {
    const selected = workspaces.find((workspace) => workspace.id === id) || null;
    if (selected && botProfile) {
      const nextProfile: BotProfile = {
        ...botProfile,
        workspacePath: selected.path,
        updatedAt: Date.now(),
      };
      setBotProfile(nextProfile);
      saveBotProfile(nextProfile);
    }

    setActiveWorkspaceId(id);
    setWorkspaces((prev) =>
      prev
        .map((workspace) =>
          workspace.id === id
            ? {
                ...workspace,
                updatedAt: Date.now(),
              }
            : workspace
        )
        .sort((a, b) => b.updatedAt - a.updatedAt)
    );
  }

  function handleDeleteWorkspace(id: string) {
    const next = workspaces.filter((workspace) => workspace.id !== id);
    setWorkspaces(next);

    if (activeWorkspaceId !== id) {
      return;
    }

    const fallback = next[0] || null;
    setActiveWorkspaceId(fallback?.id || null);

    if (fallback && botProfile) {
      const nextProfile: BotProfile = {
        ...botProfile,
        workspacePath: fallback.path,
        updatedAt: Date.now(),
      };
      setBotProfile(nextProfile);
      saveBotProfile(nextProfile);
    }
  }

  if (!hydrated) {
    return (
      <div className="flex items-center justify-center h-dvh">
        <div className="flex gap-1">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-bounce [animation-delay:-0.3s]" />
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-bounce [animation-delay:-0.15s]" />
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-bounce" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col bg-neutral-950 text-neutral-100">
      <header className="border-b border-white/10 bg-neutral-900/95 backdrop-blur">
        <div className="px-6 py-4 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.3em] text-neutral-400">
              Sorcerer
            </p>
            <h1 className="text-xl font-semibold text-neutral-100">
              Autonomous Coding Studio
            </h1>
            <p className="text-sm text-neutral-400">
              Configure a workspace, set a goal, and let the agent run.
            </p>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[260px]">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
                Workspace
              </div>
              <div className="mt-1 flex items-center gap-2">
                <select
                  value={activeWorkspaceId || ""}
                  onChange={(event) => handleSelectWorkspace(event.target.value)}
                  disabled={workspaces.length === 0}
                  className="min-w-[200px] rounded-xl border border-white/15 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:ring-2 focus:ring-emerald-400"
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
                  onClick={handleNewWorkspace}
                  disabled={workspacePickerBusy}
                  className="px-3 py-2 rounded-xl bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors cursor-pointer"
                >
                  {workspacePickerBusy ? "Opening..." : "New"}
                </button>
                <button
                  onClick={() => openOnboarding(botProfile)}
                  className="px-3 py-2 rounded-xl border border-white/15 bg-neutral-800 text-sm hover:bg-neutral-700 transition-colors cursor-pointer"
                >
                  Setup
                </button>
                <button
                  onClick={() => activeWorkspaceId && handleDeleteWorkspace(activeWorkspaceId)}
                  disabled={!activeWorkspaceId}
                  className="px-3 py-2 rounded-xl border border-red-500/50 text-red-300 text-sm hover:bg-red-900/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
                >
                  Remove
                </button>
              </div>
              <div
                className="mt-1 text-[11px] text-neutral-400 font-mono truncate"
                title={activeWorkspacePath}
              >
                {activeWorkspacePath}
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-[11px] uppercase tracking-wider text-neutral-400">
                Active Bot
              </span>
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

      <main className="flex-1 min-h-0 overflow-hidden">
        <AutonomousPanel
          embedded
          botName={botProfile?.botName || "Assistant"}
          workspacePath={activeWorkspacePath}
          enabledSkillFiles={botProfile?.enabledSkillFiles || []}
          modelConfig={
            botProfile
              ? {
                  apiUrl: botProfile.apiUrl,
                  apiKey: botProfile.apiKey,
                  model: botProfile.model,
                }
              : undefined
          }
        />
      </main>

      <BotOnboarding
        key={onboardingKey}
        open={onboardingOpen}
        canClose={Boolean(botProfile)}
        initialProfile={onboardingSeed}
        onSave={handleSaveBotProfile}
        onClose={() => setOnboardingOpen(false)}
      />
    </div>
  );
}
