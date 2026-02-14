import path from "path";
import { toRelativeWorkspacePath } from "@/lib/server/workspace";

const SAFE_DENYLIST_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /^\.git(?:\/|$)/, reason: "Git internals are read-only." },
  { pattern: /^\.ssh(?:\/|$)/, reason: "SSH material is protected." },
  { pattern: /(^|\/)\.env(\.|$)/, reason: "Environment secrets are protected." },
  { pattern: /(^|\/)id_rsa(\.pub)?$/, reason: "Private key material is protected." },
  { pattern: /(^|\/).*\.pem$/, reason: "Certificate/private key material is protected." },
  { pattern: /(^|\/).*\.key$/, reason: "Private key material is protected." },
  { pattern: /(^|\/)secrets?(?:\/|$)/, reason: "Secret directories are protected." },
  { pattern: /^\.tmp\/approved-workspaces\.json$/, reason: "Internal workspace ACL is protected." },
  { pattern: /^\.tmp\/agent-runs(?:\/|$)/, reason: "Internal runtime state is protected." },
  { pattern: /^\.tmp\/agent-memory(?:\/|$)/, reason: "Internal memory store is protected." },
];

const DANGEROUS_SEGMENTS = new Set(["..", ".git", ".ssh", ".aws", ".gnupg"]);

export interface PathPolicyCheckResult {
  ok: boolean;
  reason?: string;
}

export function normalizeWorkspaceRelativePath(input: string): string {
  return input.replace(/\\/g, "/").replace(/^\/+/, "").trim();
}

export function validateWorkspaceMutationPath(relativePath: string): PathPolicyCheckResult {
  const normalizedPath = normalizeWorkspaceRelativePath(relativePath);
  if (!normalizedPath || normalizedPath.length > 260) {
    return { ok: false, reason: "Path is empty or too long." };
  }

  if (/[\u0000-\u001F]/.test(normalizedPath)) {
    return { ok: false, reason: "Path contains control characters." };
  }

  const segments = normalizedPath.split("/").filter(Boolean);
  for (const segment of segments) {
    if (DANGEROUS_SEGMENTS.has(segment)) {
      return { ok: false, reason: `Denied unsafe path segment '${segment}'.` };
    }
    if (segment.startsWith(".") && segment !== ".github") {
      return { ok: false, reason: `Denied hidden path segment '${segment}'.` };
    }
  }

  for (const rule of SAFE_DENYLIST_PATTERNS) {
    if (rule.pattern.test(normalizedPath)) {
      return { ok: false, reason: `Denied by safety policy: ${rule.reason}` };
    }
  }

  return { ok: true };
}

export function validateWorkspaceMutationAbsolutePath(
  absolutePath: string,
  workspace: string
): PathPolicyCheckResult {
  const relativePath = normalizeWorkspaceRelativePath(
    toRelativeWorkspacePath(path.resolve(absolutePath), path.resolve(workspace))
  );
  return validateWorkspaceMutationPath(relativePath);
}
