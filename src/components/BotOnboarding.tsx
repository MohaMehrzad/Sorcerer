"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import type { BotProfile } from "@/lib/store";
import { apiFetch } from "@/lib/client/apiFetch";
import BotContextSection from "@/components/onboarding/BotContextSection";
import ConnectionSection from "@/components/onboarding/ConnectionSection";
import SkillsSection from "@/components/onboarding/SkillsSection";
import { SkillMeta } from "@/components/onboarding/types";

const DEFAULT_API_URL = "https://api.viwoapp.net/v1/chat/completions";
const DEFAULT_MODEL = "qwen3:30b-128k";

interface BotOnboardingProps {
  open: boolean;
  canClose: boolean;
  initialProfile: BotProfile | null;
  onSave: (profile: BotProfile) => void;
  onClose: () => void;
}

export default function BotOnboarding({
  open,
  canClose,
  initialProfile,
  onSave,
  onClose,
}: BotOnboardingProps) {
  const [botName, setBotName] = useState(initialProfile?.botName || "");
  const [apiKey, setApiKey] = useState(initialProfile?.apiKey || "");
  const [apiUrl, setApiUrl] = useState(initialProfile?.apiUrl || DEFAULT_API_URL);
  const [model, setModel] = useState(initialProfile?.model || DEFAULT_MODEL);
  const [botContext, setBotContext] = useState(initialProfile?.botContext || "");
  const [workspacePath, setWorkspacePath] = useState(
    initialProfile?.workspacePath || "."
  );
  const [enabledSkillFiles, setEnabledSkillFiles] = useState<string[]>(
    initialProfile?.enabledSkillFiles || []
  );
  const [skills, setSkills] = useState<SkillMeta[]>([]);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [skillsError, setSkillsError] = useState<string | null>(null);
  const [skillsRoot, setSkillsRoot] = useState<string | null>(null);
  const [skillPrompt, setSkillPrompt] = useState("");
  const [creatingSkill, setCreatingSkill] = useState(false);
  const [skillActionError, setSkillActionError] = useState<string | null>(null);
  const [skillActionSuccess, setSkillActionSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [initialSkillsLoaded, setInitialSkillsLoaded] = useState(false);
  const [workspacePickerBusy, setWorkspacePickerBusy] = useState(false);
  const [workspacePickerError, setWorkspacePickerError] = useState<string | null>(null);
  const [testingConnection, setTestingConnection] = useState(false);
  const [connectionSuccess, setConnectionSuccess] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  const firstInputRef = useRef<HTMLInputElement | null>(null);
  const lastFocusedRef = useRef<HTMLElement | null>(null);

  const loadSkills = useCallback(async (targetWorkspace: string) => {
    const normalizedWorkspace = targetWorkspace.trim();

    setSkillsLoading(true);
    setSkillsError(null);
    try {
      const response = await apiFetch("/api/skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "list",
          workspacePath: normalizedWorkspace,
        }),
      });

      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        skillsRoot?: string;
        skills?: SkillMeta[];
      };
      if (!response.ok) {
        throw new Error(data.error || `Failed to list skills (${response.status})`);
      }

      setSkillsRoot(
        typeof data.skillsRoot === "string" && data.skillsRoot.trim().length > 0
          ? data.skillsRoot.trim()
          : null
      );
      const listedSkills = Array.isArray(data.skills) ? data.skills : [];
      setSkills(listedSkills);
      setEnabledSkillFiles((previous) =>
        previous.filter((value) => listedSkills.some((skill) => skill.id === value))
      );
    } catch (err) {
      setSkills([]);
      setSkillsError(err instanceof Error ? err.message : "Failed to list skills");
    } finally {
      setSkillsLoading(false);
    }
  }, []);

  async function handleCreateSkill() {
    const normalizedWorkspace = workspacePath.trim();
    const normalizedPrompt = skillPrompt.trim();
    if (!normalizedPrompt) return;

    setCreatingSkill(true);
    setSkillActionError(null);
    setSkillActionSuccess(null);

    try {
      const response = await apiFetch("/api/skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          workspacePath: normalizedWorkspace,
          prompt: normalizedPrompt,
          modelConfig: {
            apiUrl: apiUrl.trim(),
            apiKey: apiKey.trim(),
            model: model.trim(),
          },
        }),
      });

      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        skillsRoot?: string;
        created?: SkillMeta;
        skills?: SkillMeta[];
      };
      if (!response.ok) {
        throw new Error(data.error || `Failed to create skill (${response.status})`);
      }

      setSkillsRoot(
        typeof data.skillsRoot === "string" && data.skillsRoot.trim().length > 0
          ? data.skillsRoot.trim()
          : null
      );
      const listedSkills = Array.isArray(data.skills) ? data.skills : [];
      setSkills(listedSkills);
      if (data.created?.id) {
        setEnabledSkillFiles((previous) =>
          Array.from(new Set([...previous, data.created!.id]))
        );
        setSkillActionSuccess(`Saved: ${data.created.absolutePath}`);
      }
      setSkillPrompt("");
    } catch (err) {
      setSkillActionError(err instanceof Error ? err.message : "Failed to create skill");
    } finally {
      setCreatingSkill(false);
    }
  }

  async function handlePickWorkspace() {
    setWorkspacePickerBusy(true);
    setWorkspacePickerError(null);
    setSkillActionSuccess(null);
    setConnectionSuccess(null);
    setConnectionError(null);

    try {
      const response = await apiFetch("/api/workspace/pick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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

      setWorkspacePath(pickedPath);
      await loadSkills(pickedPath);
    } catch (err) {
      setWorkspacePickerError(
        err instanceof Error ? err.message : "Failed to open workspace picker."
      );
    } finally {
      setWorkspacePickerBusy(false);
    }
  }

  async function handleTestConnection() {
    const nextApiKey = apiKey.trim();
    const nextApiUrl = apiUrl.trim();
    const nextModel = model.trim();
    if (!nextApiKey || !nextApiUrl || !nextModel) {
      setConnectionSuccess(null);
      setConnectionError("Model API key, URL, and model are required to test.");
      return;
    }

    setTestingConnection(true);
    setConnectionSuccess(null);
    setConnectionError(null);

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20000);
    try {
      const response = await apiFetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: "Reply with OK." }],
          botName: botName.trim() || "Assistant",
          botContext: botContext.trim(),
          modelConfig: {
            apiUrl: nextApiUrl,
            apiKey: nextApiKey,
            model: nextModel,
          },
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || `Connection test failed (${response.status})`);
      }

      await response.body?.cancel();
      setConnectionSuccess("Connection successful.");
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setConnectionError("Connection test timed out after 20 seconds.");
      } else {
        setConnectionError(
          err instanceof Error ? err.message : "Connection test failed."
        );
      }
    } finally {
      window.clearTimeout(timeout);
      setTestingConnection(false);
    }
  }

  function toggleSkill(skillId: string) {
    setEnabledSkillFiles((previous) =>
      previous.includes(skillId)
        ? previous.filter((value) => value !== skillId)
        : [...previous, skillId]
    );
  }

  useEffect(() => {
    if (!open || initialSkillsLoaded) {
      return;
    }

    setInitialSkillsLoaded(true);
    void loadSkills(workspacePath);
  }, [initialSkillsLoaded, loadSkills, open, workspacePath]);

  useEffect(() => {
    if (!open) return;

    lastFocusedRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const timer = window.setTimeout(() => {
      firstInputRef.current?.focus();
    }, 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && canClose) {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", onKeyDown);
      lastFocusedRef.current?.focus();
    };
  }, [canClose, onClose, open]);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const nextName = botName.trim();
    const nextApiKey = apiKey.trim();
    const nextApiUrl = apiUrl.trim();
    const nextModel = model.trim();
    const nextContext = botContext.trim();
    const nextWorkspacePath = workspacePath.trim();

    if (!nextName || !nextApiKey || !nextApiUrl || !nextModel || !nextWorkspacePath) {
      setError("Bot name, API key, API URL, model, and workspace path are required.");
      return;
    }

    onSave({
      botName: nextName,
      apiKey: nextApiKey,
      apiUrl: nextApiUrl,
      model: nextModel,
      botContext: nextContext,
      workspacePath: nextWorkspacePath,
      enabledSkillFiles: Array.from(
        new Set(
          enabledSkillFiles
            .map((value) => value.trim())
            .filter((value) => value.length > 0)
        )
      ),
      updatedAt: Date.now(),
    });
  }

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-[70] bg-black/50" aria-hidden="true" />
      <section
        className="fixed inset-0 z-[71] overflow-y-auto p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="bot-setup-title"
        aria-describedby="bot-setup-description"
      >
        <div className="min-h-full flex items-start justify-center py-4">
          <div className="w-full max-w-2xl max-h-[calc(100dvh-2rem)] flex flex-col rounded-2xl border border-black/10 dark:border-white/10 bg-white/90 dark:bg-neutral-950/90 backdrop-blur shadow-2xl">
            <div className="px-6 py-4 border-b border-black/10 dark:border-white/10 flex items-center justify-between">
              <div>
                <h2 id="bot-setup-title" className="text-base font-semibold">
                  Bot Setup
                </h2>
                <p id="bot-setup-description" className="text-sm text-neutral-500 mt-1">
                  Connect a model provider and choose the workspace to operate in.
                </p>
              </div>
              {canClose && (
                <button
                  onClick={onClose}
                  className="p-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
                  title="Close"
                  aria-label="Close bot setup"
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
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              )}
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-5 overflow-y-auto">
              <ConnectionSection
                firstInputRef={firstInputRef}
                botName={botName}
                workspacePath={workspacePath}
                apiKey={apiKey}
                apiUrl={apiUrl}
                model={model}
                workspacePickerBusy={workspacePickerBusy}
                workspacePickerError={workspacePickerError}
                testingConnection={testingConnection}
                connectionSuccess={connectionSuccess}
                connectionError={connectionError}
                onBotNameChange={(value) => {
                  setBotName(value);
                  setConnectionSuccess(null);
                  setConnectionError(null);
                }}
                onWorkspacePathChange={(value) => {
                  setWorkspacePath(value);
                  setSkillActionSuccess(null);
                  setWorkspacePickerError(null);
                }}
                onWorkspacePathBlur={(value) => {
                  void loadSkills(value);
                }}
                onPickWorkspace={() => {
                  void handlePickWorkspace();
                }}
                onApiKeyChange={(value) => {
                  setApiKey(value);
                  setConnectionSuccess(null);
                  setConnectionError(null);
                }}
                onApiUrlChange={(value) => {
                  setApiUrl(value);
                  setConnectionSuccess(null);
                  setConnectionError(null);
                }}
                onModelChange={(value) => {
                  setModel(value);
                  setConnectionSuccess(null);
                  setConnectionError(null);
                }}
                onTestConnection={() => {
                  void handleTestConnection();
                }}
                defaultApiUrl={DEFAULT_API_URL}
                defaultModel={DEFAULT_MODEL}
              />

              <SkillsSection
                workspacePath={workspacePath}
                skillsRoot={skillsRoot}
                skills={skills}
                skillsLoading={skillsLoading}
                creatingSkill={creatingSkill}
                skillPrompt={skillPrompt}
                setSkillPrompt={setSkillPrompt}
                enabledSkillFiles={enabledSkillFiles}
                skillsError={skillsError}
                skillActionError={skillActionError}
                skillActionSuccess={skillActionSuccess}
                onRefresh={loadSkills}
                onCreate={handleCreateSkill}
                onToggleSkill={toggleSkill}
              />

              <BotContextSection botContext={botContext} setBotContext={setBotContext} />

              {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

              <div className="flex items-center justify-between gap-3 sticky bottom-0 bg-white/90 dark:bg-neutral-950/90 backdrop-blur-sm pt-2">
                <p className="text-xs text-neutral-500">
                  Saved in local browser storage for reuse in future sessions.
                </p>
                <div className="flex items-center gap-2">
                  {canClose && (
                    <button
                      type="button"
                      onClick={onClose}
                      className="px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 text-sm hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
                    >
                      Cancel
                    </button>
                  )}
                  <button
                    type="submit"
                    className="px-3 py-2 rounded-lg bg-emerald-600 text-white text-sm hover:bg-emerald-700 transition-colors cursor-pointer"
                  >
                    Save Bot Configuration
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      </section>
    </>
  );
}
