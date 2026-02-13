"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import type { BotProfile } from "@/lib/store";
import { apiFetch } from "@/lib/client/apiFetch";

const DEFAULT_API_URL = "https://api.viwoapp.net/v1/chat/completions";
const DEFAULT_MODEL = "qwen3:30b-128k";

interface BotOnboardingProps {
  open: boolean;
  canClose: boolean;
  initialProfile: BotProfile | null;
  onSave: (profile: BotProfile) => void;
  onClose: () => void;
}

interface SkillMeta {
  id: string;
  name: string;
  relativePath: string;
  absolutePath: string;
  updatedAt: string;
  size: number;
  preview: string;
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
              <div className="grid gap-4 md:grid-cols-2">
                <label className="block text-sm">
                  <span className="block text-xs font-semibold uppercase tracking-wider text-neutral-500 mb-1">
                    Bot Name
                  </span>
                  <input
                    ref={firstInputRef}
                    type="text"
                    value={botName}
                    onChange={(event) => {
                      setBotName(event.target.value);
                      setConnectionSuccess(null);
                      setConnectionError(null);
                    }}
                    placeholder="e.g. Merlin, Athena, Forge"
                    className="w-full rounded-xl border border-black/10 dark:border-white/10 bg-white/80 dark:bg-neutral-900 px-3 py-2"
                  />
                </label>

                <label className="block text-sm">
                  <span className="block text-xs font-semibold uppercase tracking-wider text-neutral-500 mb-1">
                    Workspace Folder
                  </span>
                  <input
                    type="text"
                    value={workspacePath}
                    onChange={(event) => {
                      setWorkspacePath(event.target.value);
                      setSkillActionSuccess(null);
                      setWorkspacePickerError(null);
                    }}
                    onBlur={(event) => {
                      loadSkills(event.target.value);
                    }}
                    placeholder="/Users/you/Projects/my-repo or ."
                    className="w-full rounded-xl border border-black/10 dark:border-white/10 bg-white/80 dark:bg-neutral-900 px-3 py-2 font-mono"
                  />
                  <span className="mt-2 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handlePickWorkspace}
                      disabled={workspacePickerBusy}
                      className="px-2.5 py-1.5 rounded-lg border border-black/10 dark:border-white/10 text-xs hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-60 disabled:cursor-not-allowed transition-colors cursor-pointer"
                    >
                      {workspacePickerBusy ? "Opening..." : "Pick Workspace"}
                    </button>
                  </span>
                  {workspacePickerError && (
                    <span className="mt-1 block text-xs text-red-600 dark:text-red-400">
                      {workspacePickerError}
                    </span>
                  )}
                </label>

                <label className="block text-sm md:col-span-2">
                  <span className="block text-xs font-semibold uppercase tracking-wider text-neutral-500 mb-1">
                    Model API Key
                  </span>
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(event) => {
                      setApiKey(event.target.value);
                      setConnectionSuccess(null);
                      setConnectionError(null);
                    }}
                    placeholder="sk-..."
                    className="w-full rounded-xl border border-black/10 dark:border-white/10 bg-white/80 dark:bg-neutral-900 px-3 py-2 font-mono"
                  />
                  <span className="mt-1 block text-xs text-neutral-500">
                    Stored only in browser session storage (clears on close).
                  </span>
                </label>

                <label className="block text-sm">
                  <span className="block text-xs font-semibold uppercase tracking-wider text-neutral-500 mb-1">
                    Model API URL
                  </span>
                  <input
                    type="text"
                    value={apiUrl}
                    onChange={(event) => {
                      setApiUrl(event.target.value);
                      setConnectionSuccess(null);
                      setConnectionError(null);
                    }}
                    placeholder={DEFAULT_API_URL}
                    className="w-full rounded-xl border border-black/10 dark:border-white/10 bg-white/80 dark:bg-neutral-900 px-3 py-2 font-mono"
                  />
                </label>

                <label className="block text-sm">
                  <span className="block text-xs font-semibold uppercase tracking-wider text-neutral-500 mb-1">
                    Model Name
                  </span>
                  <input
                    type="text"
                    value={model}
                    onChange={(event) => {
                      setModel(event.target.value);
                      setConnectionSuccess(null);
                      setConnectionError(null);
                    }}
                    placeholder={DEFAULT_MODEL}
                    className="w-full rounded-xl border border-black/10 dark:border-white/10 bg-white/80 dark:bg-neutral-900 px-3 py-2 font-mono"
                  />
                </label>

                <div className="md:col-span-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={handleTestConnection}
                      disabled={
                        testingConnection ||
                        !apiKey.trim() ||
                        !apiUrl.trim() ||
                        !model.trim()
                      }
                      className="px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 text-sm hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-60 disabled:cursor-not-allowed transition-colors cursor-pointer"
                    >
                      {testingConnection ? "Testing..." : "Test Connection"}
                    </button>
                    {connectionSuccess && (
                      <span className="text-sm text-emerald-600 dark:text-emerald-400">
                        {connectionSuccess}
                      </span>
                    )}
                  </div>
                  {connectionError && (
                    <p className="mt-1 text-sm text-red-600 dark:text-red-400">
                      {connectionError}
                    </p>
                  )}
                </div>
              </div>

              <details className="rounded-2xl border border-black/10 dark:border-white/10 bg-white/70 dark:bg-neutral-950/70 p-4">
                <summary className="cursor-pointer text-sm font-semibold text-neutral-700 dark:text-neutral-200">
                  Skills & Playbooks
                </summary>
                <div className="mt-4 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium">Skills</p>
                      <p className="text-xs text-neutral-500 mt-0.5">
                        Generate markdown skills from simple prompts and enable them for autonomous runs.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => loadSkills(workspacePath)}
                      className="px-2.5 py-1.5 rounded-lg border border-black/10 dark:border-white/10 text-xs hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
                      disabled={skillsLoading || creatingSkill}
                    >
                      {skillsLoading ? "Refreshing..." : "Refresh"}
                    </button>
                  </div>

                  <label className="block text-sm">
                    <span className="block text-xs font-semibold uppercase tracking-wider text-neutral-500 mb-1">
                      Skill Prompt
                    </span>
                    <textarea
                      value={skillPrompt}
                      onChange={(event) => setSkillPrompt(event.target.value)}
                      placeholder="Example: Create a full NestJS backend skill with architecture, testing, and deployment checklists."
                      className="w-full min-h-[90px] rounded-xl border border-black/10 dark:border-white/10 bg-white/80 dark:bg-neutral-900 px-3 py-2"
                    />
                  </label>

                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs text-neutral-500">
                      Creates markdown files under{" "}
                      <span className="font-mono">{skillsRoot || ".sorcerer/skills"}</span> globally for Sorcerer.
                    </p>
                    <button
                      type="button"
                      onClick={handleCreateSkill}
                      disabled={creatingSkill || !skillPrompt.trim()}
                      className="px-3 py-2 rounded-lg bg-emerald-600 text-white text-xs hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors cursor-pointer"
                    >
                      {creatingSkill ? "Generating Skill..." : "Generate Skill"}
                    </button>
                  </div>

                  {skillsError && (
                    <p className="text-xs text-red-600 dark:text-red-400">{skillsError}</p>
                  )}
                  {skillActionError && (
                    <p className="text-xs text-red-600 dark:text-red-400">{skillActionError}</p>
                  )}
                  {skillActionSuccess && (
                    <p className="text-xs text-emerald-600 dark:text-emerald-400 font-mono break-all">
                      {skillActionSuccess}
                    </p>
                  )}

                  <div className="space-y-2 max-h-52 overflow-auto pr-1">
                    {skills.length === 0 ? (
                      <p className="text-xs text-neutral-500">(no global skills found yet)</p>
                    ) : (
                      skills.map((skill) => (
                        <label
                          key={skill.id}
                          className="flex items-start gap-2 rounded-lg border border-black/10 dark:border-white/10 p-2 bg-white/80 dark:bg-neutral-950"
                        >
                          <input
                            type="checkbox"
                            checked={enabledSkillFiles.includes(skill.id)}
                            onChange={() => toggleSkill(skill.id)}
                            className="mt-1"
                          />
                          <span className="min-w-0">
                            <span className="block text-xs font-medium truncate">
                              {skill.name}
                            </span>
                            <span className="block text-xs text-neutral-500 font-mono truncate">
                              {skill.relativePath}
                            </span>
                            <span className="block text-xs text-neutral-500 mt-1 line-clamp-2 whitespace-pre-wrap">
                              {skill.preview}
                            </span>
                          </span>
                        </label>
                      ))
                    )}
                  </div>
                </div>
              </details>

              <details className="rounded-2xl border border-black/10 dark:border-white/10 bg-white/70 dark:bg-neutral-950/70 p-4">
                <summary className="cursor-pointer text-sm font-semibold text-neutral-700 dark:text-neutral-200">
                  Bot Context (Optional)
                </summary>
                <div className="mt-3">
                  <textarea
                    value={botContext}
                    onChange={(event) => setBotContext(event.target.value)}
                    placeholder="Tone, constraints, domain rules, preferred style..."
                    className="w-full min-h-[96px] rounded-xl border border-black/10 dark:border-white/10 bg-white/80 dark:bg-neutral-900 px-3 py-2"
                  />
                </div>
              </details>

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
