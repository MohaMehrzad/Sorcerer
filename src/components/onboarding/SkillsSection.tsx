import { SkillMeta } from "@/components/onboarding/types";

interface SkillsSectionProps {
  workspacePath: string;
  skillsRoot: string | null;
  skills: SkillMeta[];
  skillsLoading: boolean;
  creatingSkill: boolean;
  skillPrompt: string;
  setSkillPrompt: (value: string) => void;
  enabledSkillFiles: string[];
  skillsError: string | null;
  skillActionError: string | null;
  skillActionSuccess: string | null;
  onRefresh: (workspacePath: string) => Promise<void>;
  onCreate: () => Promise<void>;
  onToggleSkill: (skillId: string) => void;
}

export default function SkillsSection({
  workspacePath,
  skillsRoot,
  skills,
  skillsLoading,
  creatingSkill,
  skillPrompt,
  setSkillPrompt,
  enabledSkillFiles,
  skillsError,
  skillActionError,
  skillActionSuccess,
  onRefresh,
  onCreate,
  onToggleSkill,
}: SkillsSectionProps) {
  return (
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
            onClick={() => void onRefresh(workspacePath)}
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
            Creates markdown files under <span className="font-mono">{skillsRoot || ".sorcerer/skills"}</span>{" "}
            globally for Sorcerer.
          </p>
          <button
            type="button"
            onClick={() => void onCreate()}
            disabled={creatingSkill || !skillPrompt.trim()}
            className="px-3 py-2 rounded-lg bg-emerald-600 text-white text-xs hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors cursor-pointer"
          >
            {creatingSkill ? "Generating Skill..." : "Generate Skill"}
          </button>
        </div>

        {skillsError && <p className="text-xs text-red-600 dark:text-red-400">{skillsError}</p>}
        {skillActionError && <p className="text-xs text-red-600 dark:text-red-400">{skillActionError}</p>}
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
                  onChange={() => onToggleSkill(skill.id)}
                  className="mt-1"
                />
                <span className="min-w-0">
                  <span className="block text-xs font-medium truncate">{skill.name}</span>
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
  );
}
