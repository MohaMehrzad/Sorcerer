"use client";

import { useEffect, useMemo, useState } from "react";
import AutonomousPanel from "@/components/AutonomousPanel";
import BotOnboarding from "@/components/BotOnboarding";
import AppHeader from "@/components/home/AppHeader";
import HydrationSplash from "@/components/home/HydrationSplash";
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
    const target = workspaces.find((workspace) => workspace.id === id) || null;
    if (!target) return;

    if (typeof window !== "undefined") {
      const confirmed = window.confirm(
        `Remove workspace "${target.name}"?\n\nThis removes it from Sorcerer workspace history only.`
      );
      if (!confirmed) return;
    }

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
    return <HydrationSplash />;
  }

  return (
    <div className="flex min-h-dvh flex-col bg-neutral-950 text-neutral-100">
      <AppHeader
        botProfile={botProfile}
        workspaces={workspaces}
        activeWorkspaceId={activeWorkspaceId}
        activeWorkspacePath={activeWorkspacePath}
        workspacePickerBusy={workspacePickerBusy}
        workspacePickerError={workspacePickerError}
        onSelectWorkspace={handleSelectWorkspace}
        onNewWorkspace={handleNewWorkspace}
        onOpenSetup={() => openOnboarding(botProfile)}
        onRemoveWorkspace={() => {
          if (activeWorkspaceId) {
            handleDeleteWorkspace(activeWorkspaceId);
          }
        }}
      />

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
