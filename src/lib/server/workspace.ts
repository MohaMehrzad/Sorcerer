import { stat } from "fs/promises";
import path from "path";

const DEFAULT_WORKSPACE = process.env.WORKSPACE_DIR || process.cwd();

export function getDefaultWorkspacePath(): string {
  return path.resolve(DEFAULT_WORKSPACE);
}

export async function resolveWorkspacePath(input?: string): Promise<string> {
  const defaultWorkspace = getDefaultWorkspacePath();
  const raw = typeof input === "string" ? input.trim() : "";

  const candidate = raw
    ? path.isAbsolute(raw)
      ? path.resolve(raw)
      : path.resolve(defaultWorkspace, raw)
    : defaultWorkspace;

  let workspaceStat;
  try {
    workspaceStat = await stat(candidate);
  } catch {
    throw new Error(`Workspace directory does not exist: ${candidate}`);
  }

  if (!workspaceStat.isDirectory()) {
    throw new Error(`Workspace path must be a directory: ${candidate}`);
  }

  return candidate;
}

export function normalizePathForWorkspace(inputPath: string, workspace: string): string {
  const trimmed = inputPath.trim();
  if (!trimmed) {
    throw new Error("Path must not be empty");
  }

  const resolvedWorkspace = path.resolve(workspace);
  const resolved = path.resolve(resolvedWorkspace, trimmed);
  if (resolved !== resolvedWorkspace && !resolved.startsWith(`${resolvedWorkspace}${path.sep}`)) {
    throw new Error("Path must stay within the selected workspace");
  }

  return resolved;
}

export function toRelativeWorkspacePath(absolutePath: string, workspace: string): string {
  return path.relative(path.resolve(workspace), absolutePath) || ".";
}
