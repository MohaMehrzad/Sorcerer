import { mkdir, readFile, readdir, stat, writeFile } from "fs/promises";
import { createHash } from "crypto";
import path from "path";
import { completeModel, ModelConfig } from "@/lib/server/model";
import {
  getDefaultWorkspacePath,
  normalizePathForWorkspace,
  toRelativeWorkspacePath,
} from "@/lib/server/workspace";

const GLOBAL_SKILLS_DIR = path.join(".sorcerer", "skills");
const LEGACY_WORKSPACE_SKILLS_DIR = "skills";
const LEGACY_WORKSPACE_HIDDEN_SKILLS_DIR = path.join(".sorcerer", "skills");
const MAX_PREVIEW_CHARS = 450;
const MAX_SKILL_CONTENT_CHARS = 22000;
const MAX_SKILL_PROMPT_CHARS = 4000;

export interface SkillMeta {
  id: string;
  name: string;
  relativePath: string;
  absolutePath: string;
  updatedAt: string;
  size: number;
  preview: string;
}

export interface SkillDocument {
  id: string;
  name: string;
  relativePath: string;
  content: string;
}

interface PathMatch {
  relativePath: string;
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n... (truncated ${text.length - maxChars} chars)`;
}

function sanitizeSlug(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  const normalized = trimmed.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized || "skill";
}

function parseTitleFromMarkdown(content: string): string {
  const heading = content.match(/^#\s+(.+)$/m);
  if (heading?.[1]) {
    return heading[1].trim();
  }

  const line = content
    .split("\n")
    .map((value) => value.trim())
    .find((value) => value.length > 0);

  return line || "Untitled Skill";
}

function normalizeSkillReference(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.replace(/\\/g, "/");
}

function getGlobalWorkspaceRoot(): string {
  return getDefaultWorkspacePath();
}

function getGlobalSkillsRoot(): string {
  return normalizePathForWorkspace(GLOBAL_SKILLS_DIR, getGlobalWorkspaceRoot());
}

export function getGlobalSkillsDirectory(): string {
  return getGlobalSkillsRoot();
}

async function ensureGlobalSkillsRoot(): Promise<string> {
  const root = getGlobalSkillsRoot();
  await mkdir(root, { recursive: true });
  return root;
}

function ensureInsideRoot(root: string, candidatePath: string): string | null {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidatePath);
  if (
    resolvedCandidate === resolvedRoot ||
    resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`)
  ) {
    return resolvedCandidate;
  }
  return null;
}

function normalizeRelativePath(relativePath: string): string {
  return relativePath.replace(/\\/g, "/");
}

function toGlobalRelativeSkillPath(absolutePath: string): string {
  return normalizeRelativePath(
    toRelativeWorkspacePath(absolutePath, getGlobalWorkspaceRoot())
  );
}

function buildSkillMeta(
  absolutePath: string,
  content: string,
  updatedAt: string,
  size: number
): SkillMeta {
  const relativePath = toGlobalRelativeSkillPath(absolutePath);
  const title = parseTitleFromMarkdown(content);
  return {
    id: relativePath,
    name: title,
    relativePath,
    absolutePath: path.resolve(absolutePath),
    updatedAt,
    size,
    preview: truncate(content, MAX_PREVIEW_CHARS),
  };
}

async function enumerateMarkdownFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      const nested = await enumerateMarkdownFiles(fullPath);
      files.push(...nested);
      continue;
    }

    if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      files.push(fullPath);
    }
  }

  return files;
}

function buildPathMatch(absolutePath: string, workspace: string): PathMatch {
  const globalWorkspace = path.resolve(getGlobalWorkspaceRoot());
  const resolvedPath = path.resolve(absolutePath);

  if (
    resolvedPath === globalWorkspace ||
    resolvedPath.startsWith(`${globalWorkspace}${path.sep}`)
  ) {
    return {
      relativePath: normalizeRelativePath(
        toRelativeWorkspacePath(resolvedPath, globalWorkspace)
      ),
    };
  }

  const resolvedWorkspace = path.resolve(workspace);
  if (
    resolvedPath === resolvedWorkspace ||
    resolvedPath.startsWith(`${resolvedWorkspace}${path.sep}`)
  ) {
    return {
      relativePath: normalizeRelativePath(
        toRelativeWorkspacePath(resolvedPath, resolvedWorkspace)
      ),
    };
  }

  return {
    relativePath: normalizeRelativePath(resolvedPath),
  };
}

function contentDigest(content: string): string {
  return createHash("sha1").update(content).digest("hex");
}

function ensureMarkdownExtension(fileName: string): string {
  if (fileName.toLowerCase().endsWith(".md")) return fileName;
  return `${fileName}.md`;
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function isDirectory(targetPath: string): Promise<boolean> {
  try {
    const targetStat = await stat(targetPath);
    return targetStat.isDirectory();
  } catch {
    return false;
  }
}

function resolveSkillPathCandidates(reference: string, workspace: string): string[] {
  const normalized = normalizeSkillReference(reference);
  if (!normalized) return [];

  const globalWorkspace = getGlobalWorkspaceRoot();
  const globalSkillsRoot = getGlobalSkillsRoot();
  const candidates = new Set<string>();

  const addCandidate = (candidatePath: string) => {
    candidates.add(path.resolve(candidatePath));
  };

  if (path.isAbsolute(normalized)) {
    addCandidate(normalized);
  } else {
    try {
      addCandidate(normalizePathForWorkspace(normalized, globalWorkspace));
    } catch {
      // Ignore invalid global-workspace-relative path.
    }

    const asGlobalRelative = normalized
      .replace(/^\.sorcerer\/skills\//, "")
      .replace(/^skills\//, "");
    const insideGlobalRoot = ensureInsideRoot(
      globalSkillsRoot,
      path.join(globalSkillsRoot, asGlobalRelative)
    );
    if (insideGlobalRoot) {
      addCandidate(insideGlobalRoot);
    }

    try {
      addCandidate(normalizePathForWorkspace(normalized, workspace));
    } catch {
      // Ignore invalid workspace-relative path.
    }

    try {
      const legacyWorkspaceSkillsRoot = normalizePathForWorkspace(
        LEGACY_WORKSPACE_SKILLS_DIR,
        workspace
      );
      const insideLegacyRoot = ensureInsideRoot(
        legacyWorkspaceSkillsRoot,
        path.join(legacyWorkspaceSkillsRoot, normalized)
      );
      if (insideLegacyRoot) {
        addCandidate(insideLegacyRoot);
      }
    } catch {
      // Ignore invalid legacy workspace skills path.
    }

    try {
      const legacyWorkspaceHiddenSkillsRoot = normalizePathForWorkspace(
        LEGACY_WORKSPACE_HIDDEN_SKILLS_DIR,
        workspace
      );
      const insideLegacyRoot = ensureInsideRoot(
        legacyWorkspaceHiddenSkillsRoot,
        path.join(legacyWorkspaceHiddenSkillsRoot, normalized)
      );
      if (insideLegacyRoot) {
        addCandidate(insideLegacyRoot);
      }
    } catch {
      // Ignore invalid hidden legacy workspace skills path.
    }
  }

  return Array.from(candidates);
}

export async function listSkillMetas(): Promise<SkillMeta[]> {
  const root = await ensureGlobalSkillsRoot();
  const files = await enumerateMarkdownFiles(root);
  const metas: SkillMeta[] = [];

  for (const filePath of files) {
    try {
      const [content, fileStat] = await Promise.all([
        readFile(filePath, "utf-8"),
        stat(filePath),
      ]);
      metas.push(
        buildSkillMeta(
          filePath,
          content,
          fileStat.mtime.toISOString(),
          fileStat.size
        )
      );
    } catch {
      // Ignore invalid skill files.
    }
  }

  return metas.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

export async function migrateWorkspaceSkillsToGlobal(
  workspace: string
): Promise<number> {
  const globalRoot = await ensureGlobalSkillsRoot();
  const resolvedGlobalRoot = path.resolve(globalRoot);
  const resolvedWorkspace = path.resolve(workspace);

  const legacyRoots = new Set<string>();
  try {
    const workspaceSkillsRoot = normalizePathForWorkspace(
      LEGACY_WORKSPACE_SKILLS_DIR,
      resolvedWorkspace
    );
    if (path.resolve(workspaceSkillsRoot) !== resolvedGlobalRoot) {
      legacyRoots.add(workspaceSkillsRoot);
    }
  } catch {
    // Ignore invalid workspace skills root.
  }

  try {
    const workspaceHiddenSkillsRoot = normalizePathForWorkspace(
      LEGACY_WORKSPACE_HIDDEN_SKILLS_DIR,
      resolvedWorkspace
    );
    if (path.resolve(workspaceHiddenSkillsRoot) !== resolvedGlobalRoot) {
      legacyRoots.add(workspaceHiddenSkillsRoot);
    }
  } catch {
    // Ignore invalid hidden workspace skills root.
  }

  if (legacyRoots.size === 0) return 0;

  const existingGlobalFiles = await enumerateMarkdownFiles(globalRoot);
  const knownDigests = new Set<string>();

  for (const filePath of existingGlobalFiles) {
    try {
      const content = await readFile(filePath, "utf-8");
      knownDigests.add(contentDigest(content));
    } catch {
      // Ignore unreadable global skill files.
    }
  }

  let migratedCount = 0;

  for (const root of legacyRoots) {
    if (!(await isDirectory(root))) continue;
    const sourceFiles = await enumerateMarkdownFiles(root);

    for (const sourcePath of sourceFiles) {
      let sourceContent: string;
      try {
        sourceContent = await readFile(sourcePath, "utf-8");
      } catch {
        continue;
      }

      const digest = contentDigest(sourceContent);
      if (knownDigests.has(digest)) {
        continue;
      }

      const parsedName = path.parse(path.basename(sourcePath));
      const targetBase = sanitizeSlug(parsedName.name || "skill");
      const targetFileName = ensureMarkdownExtension(
        `${targetBase}-${digest.slice(0, 8)}`
      );
      const targetPath = path.join(globalRoot, targetFileName);

      if (await pathExists(targetPath)) {
        // If collision happens, digest-based name should still be stable; skip rewriting.
        knownDigests.add(digest);
        continue;
      }

      await writeFile(targetPath, `${sourceContent.trimEnd()}\n`, "utf-8");
      knownDigests.add(digest);
      migratedCount += 1;
    }
  }

  return migratedCount;
}

async function generateSkillMarkdown(
  prompt: string,
  modelConfig: Partial<ModelConfig> | undefined
): Promise<string> {
  const normalizedPrompt = truncate(prompt.trim(), MAX_SKILL_PROMPT_CHARS);
  const systemPrompt = [
    "You are an expert engineering workflow designer.",
    "Generate one production-ready SKILL markdown document.",
    "Output markdown only, no code fences around full document.",
    "The document must include sections:",
    "- # Skill Name",
    "- ## Purpose",
    "- ## Use When",
    "- ## Inputs",
    "- ## Workflow",
    "- ## Guardrails",
    "- ## Verification Checklist",
    "- ## Output Contract",
    "Make it actionable, deterministic, and tool-oriented.",
    "Prefer concrete commands, file patterns, and quality checks.",
  ].join("\n");

  const { content } = await completeModel(
    [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: `Create a skill based on this request:\n${normalizedPrompt}`,
      },
    ],
    {
      modelConfig,
      temperature: 0.2,
      maxTokens: 2200,
    }
  );

  return truncate(content.trim(), MAX_SKILL_CONTENT_CHARS);
}

function buildFallbackSkillMarkdown(prompt: string): string {
  const normalizedPrompt = truncate(prompt.trim(), MAX_SKILL_PROMPT_CHARS);
  const titleSeed = normalizedPrompt.split("\n")[0] || "Custom Skill";
  return [
    `# ${titleSeed}`,
    "",
    "## Purpose",
    "Provide deterministic execution guidance for this requested engineering domain.",
    "",
    "## Use When",
    `- Request matches: ${normalizedPrompt}`,
    "",
    "## Inputs",
    "- Workspace path",
    "- User goal",
    "- Existing repository state",
    "",
    "## Workflow",
    "1. Analyze repository structure and existing architecture before editing.",
    "2. Define acceptance criteria and constraints from user goal.",
    "3. Plan minimal safe edits with explicit verification steps.",
    "4. Implement with defensive error handling and type-safe boundaries.",
    "5. Run validation commands and resolve every failure.",
    "",
    "## Guardrails",
    "- Do not modify unrelated files.",
    "- Preserve existing conventions and project patterns.",
    "- Prefer incremental, reversible changes.",
    "",
    "## Verification Checklist",
    "- Lint passes",
    "- Type checks pass",
    "- Build/tests pass",
    "- No known regressions introduced",
    "",
    "## Output Contract",
    "- Summarize changed files",
    "- Summarize validation results",
    "- Report residual risks explicitly",
  ].join("\n");
}

export async function createSkillFromPrompt(params: {
  prompt: string;
  modelConfig?: Partial<ModelConfig>;
}): Promise<SkillMeta> {
  const root = await ensureGlobalSkillsRoot();
  const prompt = params.prompt.trim();
  if (!prompt) {
    throw new Error("Skill prompt is required.");
  }

  let content: string;
  try {
    content = await generateSkillMarkdown(prompt, params.modelConfig);
  } catch {
    content = buildFallbackSkillMarkdown(prompt);
  }

  const title = parseTitleFromMarkdown(content);
  const slug = sanitizeSlug(title);
  const fileName = `${slug}-${Date.now()}.md`;
  const absolutePath = path.join(root, fileName);
  await writeFile(absolutePath, `${content}\n`, "utf-8");

  const fileStat = await stat(absolutePath);
  return buildSkillMeta(
    absolutePath,
    content,
    fileStat.mtime.toISOString(),
    fileStat.size
  );
}

export async function loadSkillDocuments(
  workspace: string,
  requestedSkillFiles: string[],
  maxSkills: number = 10
): Promise<SkillDocument[]> {
  const normalized = requestedSkillFiles
    .map((value) => normalizeSkillReference(value))
    .filter(Boolean)
    .slice(0, maxSkills);

  if (normalized.length === 0) return [];

  const documents: SkillDocument[] = [];
  for (const requestedPath of normalized) {
    const candidates = resolveSkillPathCandidates(requestedPath, workspace);
    if (candidates.length === 0) continue;

    for (const candidate of candidates) {
      try {
        const content = await readFile(candidate, "utf-8");
        const trimmed = truncate(content.trim(), MAX_SKILL_CONTENT_CHARS);
        const pathMatch = buildPathMatch(candidate, workspace);
        documents.push({
          id: requestedPath,
          name: parseTitleFromMarkdown(trimmed),
          relativePath: pathMatch.relativePath,
          content: trimmed,
        });
        break;
      } catch {
        // Try next candidate path.
      }
    }
  }

  return documents;
}
