"use client";

import { useEffect, useMemo, useState } from "react";
import Sidebar from "@/components/Sidebar";
import AutonomousPanel from "@/components/AutonomousPanel";
import BotOnboarding from "@/components/BotOnboarding";
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
  const [sidebarOpen, setSidebarOpen] = useState(false);
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
      const response = await fetch("/api/workspace/pick", {
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
          <span className="w-2.5 h-2.5 rounded-full bg-blue-500 animate-bounce [animation-delay:-0.3s]" />
          <span className="w-2.5 h-2.5 rounded-full bg-blue-500 animate-bounce [animation-delay:-0.15s]" />
          <span className="w-2.5 h-2.5 rounded-full bg-blue-500 animate-bounce" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-dvh bg-white dark:bg-neutral-950">
      <Sidebar
        workspaces={workspaces}
        activeWorkspaceId={activeWorkspaceId}
        onSelectWorkspace={handleSelectWorkspace}
        onNewWorkspace={handleNewWorkspace}
        onDeleteWorkspace={handleDeleteWorkspace}
        botName={botProfile?.botName || "Assistant"}
        modelName={botProfile?.model || "Not configured"}
        workspacePath={activeWorkspacePath}
        onOpenBotSetup={() => openOnboarding(botProfile)}
        newWorkspaceLoading={workspacePickerBusy}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <main className="flex-1 min-w-0 relative">
        <button
          onClick={() => setSidebarOpen(true)}
          className="md:hidden absolute top-3 left-3 z-30 p-2 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors cursor-pointer"
          title="Open workspace list"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>

        {workspacePickerError && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 max-w-[90%] rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-300">
            {workspacePickerError}
          </div>
        )}

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
