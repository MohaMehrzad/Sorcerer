import { mkdir, readFile, stat, writeFile } from "fs/promises";
import path from "path";

const DEFAULT_WORKSPACE = process.env.WORKSPACE_DIR || process.cwd();
const APPROVED_WORKSPACES_FILE = path.join(
  path.resolve(DEFAULT_WORKSPACE),
  ".tmp",
  "approved-workspaces.json"
);

interface ApprovedWorkspaceStore {
  version: number;
  updatedAt: string;
  workspaces: string[];
}

export class WorkspaceAccessError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "WorkspaceAccessError";
    this.status = status;
  }
}

export function statusFromWorkspaceError(err: unknown): number | null {
  if (err instanceof WorkspaceAccessError) {
    return err.status;
  }
  return null;
}

export function getDefaultWorkspacePath(): string {
  return path.resolve(DEFAULT_WORKSPACE);
}

function isPathWithinRoot(candidate: string, root: string): boolean {
  const resolvedCandidate = path.resolve(candidate);
  const resolvedRoot = path.resolve(root);
  return (
    resolvedCandidate === resolvedRoot ||
    resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`)
  );
}

function parseWorkspaceAllowedRoots(): string[] {
  const raw = process.env.WORKSPACE_ALLOWED_ROOTS;
  if (!raw) return [];
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .map((item) => path.resolve(item));
}

async function loadApprovedWorkspaceRoots(): Promise<string[]> {
  try {
    const raw = await readFile(APPROVED_WORKSPACES_FILE, "utf-8");
    const parsed = JSON.parse(raw) as Partial<ApprovedWorkspaceStore>;
    if (!Array.isArray(parsed.workspaces)) {
      return [];
    }
    return parsed.workspaces
      .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      .map((item) => path.resolve(item));
  } catch {
    return [];
  }
}

async function saveApprovedWorkspaceRoots(workspaces: string[]): Promise<void> {
  const deduped = Array.from(
    new Set(
      workspaces
        .map((item) => item.trim())
        .filter((item) => item.length > 0)
        .map((item) => path.resolve(item))
    )
  ).sort((first, second) => first.localeCompare(second));

  const payload: ApprovedWorkspaceStore = {
    version: 1,
    updatedAt: new Date().toISOString(),
    workspaces: deduped,
  };

  await mkdir(path.dirname(APPROVED_WORKSPACES_FILE), { recursive: true });
  await writeFile(APPROVED_WORKSPACES_FILE, JSON.stringify(payload, null, 2), "utf-8");
}

function isPathAllowedByRoots(candidate: string, roots: string[]): boolean {
  return roots.some((root) => isPathWithinRoot(candidate, root));
}

export function assertPathWithinWorkspace(
  absolutePath: string,
  workspace: string
): string {
  const resolvedWorkspace = path.resolve(workspace);
  const resolvedPath = path.resolve(absolutePath);
  if (!isPathWithinRoot(resolvedPath, resolvedWorkspace)) {
    throw new Error("Path must stay within the selected workspace");
  }
  return resolvedPath;
}

export async function approveWorkspacePath(input: string): Promise<string> {
  const defaultWorkspace = getDefaultWorkspacePath();
  const normalizedInput = input.trim();
  if (!normalizedInput) {
    throw new WorkspaceAccessError("Workspace path must not be empty", 400);
  }

  const resolved = path.isAbsolute(normalizedInput)
    ? path.resolve(normalizedInput)
    : path.resolve(defaultWorkspace, normalizedInput);

  let workspaceStat;
  try {
    workspaceStat = await stat(resolved);
  } catch {
    throw new WorkspaceAccessError(
      `Workspace directory does not exist: ${resolved}`,
      400
    );
  }

  if (!workspaceStat.isDirectory()) {
    throw new WorkspaceAccessError(`Workspace path must be a directory: ${resolved}`, 400);
  }

  if (isPathWithinRoot(resolved, defaultWorkspace)) {
    return resolved;
  }

  const allowedRoots = parseWorkspaceAllowedRoots();
  if (isPathAllowedByRoots(resolved, allowedRoots)) {
    return resolved;
  }

  const approved = await loadApprovedWorkspaceRoots();
  if (!approved.includes(resolved)) {
    approved.push(resolved);
    await saveApprovedWorkspaceRoots(approved);
  }

  return resolved;
}

export async function resolveWorkspacePath(input?: string): Promise<string> {
  const defaultWorkspace = getDefaultWorkspacePath();
  const raw = typeof input === "string" ? input.trim() : "";

  const candidate = raw
    ? path.isAbsolute(raw)
      ? path.resolve(raw)
      : path.resolve(defaultWorkspace, raw)
    : defaultWorkspace;

  const inDefaultWorkspace = isPathWithinRoot(candidate, defaultWorkspace);
  if (!inDefaultWorkspace) {
    const allowedRoots = parseWorkspaceAllowedRoots();
    const approvedRoots = await loadApprovedWorkspaceRoots();

    const isAllowed =
      isPathAllowedByRoots(candidate, allowedRoots) ||
      isPathAllowedByRoots(candidate, approvedRoots);
    if (!isAllowed) {
      throw new WorkspaceAccessError(
        `Workspace path is outside the allowed scope: ${candidate}. Use the workspace picker to approve it or configure WORKSPACE_ALLOWED_ROOTS.`,
        403
      );
    }
  }

  let workspaceStat;
  try {
    workspaceStat = await stat(candidate);
  } catch {
    throw new WorkspaceAccessError(
      `Workspace directory does not exist: ${candidate}`,
      400
    );
  }

  if (!workspaceStat.isDirectory()) {
    throw new WorkspaceAccessError(`Workspace path must be a directory: ${candidate}`, 400);
  }

  return candidate;
}

export function normalizePathForWorkspace(inputPath: string, workspace: string): string {
  const trimmed = inputPath.trim();
  if (!trimmed) {
    throw new Error("Path must not be empty");
  }

  const resolvedWorkspace = path.resolve(workspace);
  return assertPathWithinWorkspace(path.resolve(resolvedWorkspace, trimmed), resolvedWorkspace);
}

export function toRelativeWorkspacePath(absolutePath: string, workspace: string): string {
  return path.relative(path.resolve(workspace), absolutePath) || ".";
}
