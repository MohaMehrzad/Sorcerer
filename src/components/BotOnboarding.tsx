"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
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
      <div className="fixed inset-0 z-[70] bg-black/50" />
      <section className="fixed inset-0 z-[71] overflow-y-auto p-4">
        <div className="min-h-full flex items-start justify-center py-2">
          <div className="w-full max-w-2xl max-h-[calc(100dvh-2rem)] flex flex-col rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 shadow-2xl">
          <div className="px-5 py-4 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between shrink-0">
            <div>
              <h2 className="text-base font-semibold">Bot Onboarding</h2>
              <p className="text-xs text-neutral-500 mt-1">
                Configure bot identity and model credentials.
              </p>
            </div>
            {canClose && (
              <button
                onClick={onClose}
                className="p-2 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors cursor-pointer"
                title="Close"
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

            <form onSubmit={handleSubmit} className="p-5 space-y-4 overflow-y-auto">
            <label className="block text-sm">
              <span className="block text-xs font-medium text-neutral-500 mb-1">
                Bot Name
              </span>
              <input
                type="text"
                value={botName}
                onChange={(event) => setBotName(event.target.value)}
                placeholder="e.g. Merlin, Athena, Forge"
                className="w-full rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2"
              />
            </label>

            <label className="block text-sm">
              <span className="block text-xs font-medium text-neutral-500 mb-1">
                Model API Key
              </span>
              <input
                type="password"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder="sk-..."
                className="w-full rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2 font-mono"
              />
              <span className="mt-1 block text-[11px] text-neutral-500">
                Stored only for this browser session (clears on close).
              </span>
            </label>

            <label className="block text-sm">
              <span className="block text-xs font-medium text-neutral-500 mb-1">
                Model API URL
              </span>
              <input
                type="text"
                value={apiUrl}
                onChange={(event) => setApiUrl(event.target.value)}
                placeholder={DEFAULT_API_URL}
                className="w-full rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2 font-mono"
              />
            </label>

            <label className="block text-sm">
              <span className="block text-xs font-medium text-neutral-500 mb-1">
                Model Name
              </span>
              <input
                type="text"
                value={model}
                onChange={(event) => setModel(event.target.value)}
                placeholder={DEFAULT_MODEL}
                className="w-full rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2 font-mono"
              />
            </label>

            <label className="block text-sm">
              <span className="block text-xs font-medium text-neutral-500 mb-1">
                Workspace Folder
              </span>
              <input
                type="text"
                value={workspacePath}
                onChange={(event) => {
                  setWorkspacePath(event.target.value);
                  setSkillActionSuccess(null);
                }}
                onBlur={(event) => {
                  loadSkills(event.target.value);
                }}
                placeholder="/Users/you/Projects/my-repo or ."
                className="w-full rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2 font-mono"
              />
            </label>

            <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 p-3 space-y-3 bg-neutral-50 dark:bg-neutral-900/40">
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
                  className="px-2.5 py-1.5 rounded-lg border border-neutral-300 dark:border-neutral-700 text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors cursor-pointer"
                  disabled={skillsLoading || creatingSkill}
                >
                  {skillsLoading ? "Refreshing..." : "Refresh"}
                </button>
              </div>

              <label className="block text-sm">
                <span className="block text-xs font-medium text-neutral-500 mb-1">
                  Skill Prompt
                </span>
                <textarea
                  value={skillPrompt}
                  onChange={(event) => setSkillPrompt(event.target.value)}
                  placeholder="Example: Create a full NestJS backend skill with architecture, testing, and deployment checklists."
                  className="w-full min-h-[90px] rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2"
                />
              </label>

              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-neutral-500">
                  Creates markdown files under{" "}
                  <span className="font-mono">
                    {skillsRoot || ".sorcerer/skills"}
                  </span>{" "}
                  globally for Sorcerer.
                </p>
                <button
                  type="button"
                  onClick={handleCreateSkill}
                  disabled={
                    creatingSkill ||
                    !skillPrompt.trim()
                  }
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
                  <p className="text-xs text-neutral-500">
                    (no global skills found yet)
                  </p>
                ) : (
                  skills.map((skill) => (
                    <label
                      key={skill.id}
                      className="flex items-start gap-2 rounded-lg border border-neutral-200 dark:border-neutral-800 p-2 bg-white dark:bg-neutral-950"
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
                        <span className="block text-[11px] text-neutral-500 font-mono truncate">
                          {skill.relativePath}
                        </span>
                        <span className="block text-[11px] text-neutral-500 mt-1 line-clamp-2 whitespace-pre-wrap">
                          {skill.preview}
                        </span>
                      </span>
                    </label>
                  ))
                )}
              </div>
            </div>

            <label className="block text-sm">
              <span className="block text-xs font-medium text-neutral-500 mb-1">
                Related Bot Information (optional)
              </span>
              <textarea
                value={botContext}
                onChange={(event) => setBotContext(event.target.value)}
                placeholder="Tone, constraints, domain rules, preferred style..."
                className="w-full min-h-[96px] rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2"
              />
            </label>

            {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

              <div className="flex items-center justify-between gap-3 sticky bottom-0 bg-white/95 dark:bg-neutral-950/95 backdrop-blur-sm pt-2">
              <p className="text-xs text-neutral-500">
                Saved in local browser storage for reuse in future sessions.
              </p>
              <div className="flex items-center gap-2">
                {canClose && (
                  <button
                    type="button"
                    onClick={onClose}
                    className="px-3 py-2 rounded-lg border border-neutral-300 dark:border-neutral-700 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                )}
                <button
                  type="submit"
                  className="px-3 py-2 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700 transition-colors cursor-pointer"
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
