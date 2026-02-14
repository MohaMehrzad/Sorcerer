import { NextRequest, NextResponse } from "next/server";
import { readdir, readFile, writeFile, mkdir, stat } from "fs/promises";
import path from "path";
import {
  normalizePathForWorkspace,
  resolveWorkspacePath,
  statusFromWorkspaceError,
  toRelativeWorkspacePath,
} from "@/lib/server/workspace";
import { buildCorsHeaders, enforceApiAccess } from "@/lib/server/accessGuard";

// Files/dirs to ignore when scanning
const IGNORE = new Set([
  "node_modules",
  ".next",
  ".git",
  ".tmp",
  ".DS_Store",
  "dist",
  "build",
  ".cache",
  ".turbo",
  "coverage",
  ".pnp",
  ".yarn",
  "pnpm-lock.yaml",
  "package-lock.json",
  "yarn.lock",
]);

const BINARY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".svg",
  ".woff", ".woff2", ".ttf", ".eot",
  ".pdf", ".zip", ".tar", ".gz",
  ".mp3", ".mp4", ".avi", ".mov",
  ".exe", ".dll", ".so", ".dylib",
  ".pyc", ".class", ".o",
]);

const PROTECTED_WORKSPACE_PATH_PATTERNS: RegExp[] = [
  /^\.tmp\/approved-workspaces\.json$/,
  /^\.tmp\/agent-runs(?:\/|$)/,
  /^\.tmp\/agent-memory(?:\/|$)/,
];

class FileRouteError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "FileRouteError";
    this.status = status;
  }
}

interface TreeNode {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: TreeNode[];
}

async function buildTree(
  dirPath: string,
  relativeTo: string,
  depth: number = 0,
  maxDepth: number = 4
): Promise<TreeNode[]> {
  if (depth >= maxDepth) return [];

  const resolvedRoot = path.resolve(relativeTo);
  const safeDirPath = path.resolve(dirPath);
  if (safeDirPath !== resolvedRoot && !safeDirPath.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new FileRouteError(
      `Path is outside workspace: ${toWorkspaceRelativePath(safeDirPath, resolvedRoot)}`,
      403
    );
  }
  const entries = await readdir(safeDirPath, { withFileTypes: true });
  const nodes: TreeNode[] = [];

  const sorted = entries.sort((a, b) => {
    // Directories first, then files
    if (a.isDirectory() && !b.isDirectory()) return -1;
    if (!a.isDirectory() && b.isDirectory()) return 1;
    return a.name.localeCompare(b.name);
  });

  for (const entry of sorted) {
    if (IGNORE.has(entry.name) || entry.name.startsWith(".")) continue;

    const fullPath = path.resolve(safeDirPath, entry.name);
    if (fullPath !== resolvedRoot && !fullPath.startsWith(`${resolvedRoot}${path.sep}`)) {
      continue;
    }
    const relPath = toWorkspaceRelativePath(fullPath, relativeTo);

    if (entry.isDirectory()) {
      const children = await buildTree(fullPath, relativeTo, depth + 1, maxDepth);
      nodes.push({
        name: entry.name,
        path: relPath,
        type: "directory",
        children,
      });
    } else {
      nodes.push({
        name: entry.name,
        path: relPath,
        type: "file",
      });
    }
  }

  return nodes;
}

function corsHeaders(req: NextRequest): Record<string, string> {
  return buildCorsHeaders(req, "POST, OPTIONS");
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(req),
  });
}

function treeToString(nodes: TreeNode[], prefix: string = ""): string {
  let result = "";
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const isLast = i === nodes.length - 1;
    const connector = isLast ? "└── " : "├── ";
    const childPrefix = isLast ? "    " : "│   ";

    result += `${prefix}${connector}${node.name}${node.type === "directory" ? "/" : ""}\n`;

    if (node.children && node.children.length > 0) {
      result += treeToString(node.children, prefix + childPrefix);
    }
  }
  return result;
}

function toWorkspaceRelativePath(filePath: string, workspace: string): string {
  return toRelativeWorkspacePath(filePath, workspace).replace(/\\/g, "/");
}

function assertAllowedFileRoutePath(filePath: string, workspace: string, action: string): void {
  const relativePath = toWorkspaceRelativePath(filePath, workspace);
  const isProtected = PROTECTED_WORKSPACE_PATH_PATTERNS.some((pattern) =>
    pattern.test(relativePath)
  );
  if (isProtected) {
    throw new FileRouteError(
      `Path is protected and cannot be used with /api/files ${action}: ${relativePath}`,
      403
    );
  }
}

function statusFromFileRouteError(err: unknown): number {
  if (err instanceof FileRouteError) {
    return err.status;
  }
  const workspaceStatus = statusFromWorkspaceError(err);
  if (workspaceStatus !== null) {
    return workspaceStatus;
  }
  if (err instanceof Error) {
    if (err.message.includes("Path must stay within")) {
      return 403;
    }
    if (err.message.includes("Path must not be empty")) {
      return 400;
    }
  }
  return 500;
}

export async function POST(req: NextRequest) {
  const denied = enforceApiAccess(req, {
    includeCorsHeaders: true,
    methods: "POST, OPTIONS",
  });
  if (denied) return denied;

  let body: {
    action: string;
    path?: string;
    content?: string;
    maxDepth?: number;
    workspacePath?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON" },
      { status: 400, headers: corsHeaders(req) }
    );
  }

  const { action } = body;

  try {
    const workspace = await resolveWorkspacePath(body.workspacePath);

    switch (action) {
      case "tree": {
        const depth = body.maxDepth || 4;
        const tree = await buildTree(workspace, workspace, 0, depth);
        const text = treeToString(tree);
        return NextResponse.json(
          { tree, text, workspace },
          { headers: corsHeaders(req) }
        );
      }

      case "read": {
        if (!body.path) {
          return NextResponse.json(
            { error: "Path required" },
            { status: 400, headers: corsHeaders(req) }
          );
        }

        const filePath = normalizePathForWorkspace(body.path, workspace);
        assertAllowedFileRoutePath(filePath, workspace, "read");
        const resolvedWorkspace = path.resolve(workspace);
        const safePath = path.resolve(filePath);
        if (
          safePath !== resolvedWorkspace &&
          !safePath.startsWith(`${resolvedWorkspace}${path.sep}`)
        ) {
          throw new FileRouteError(
            `Path is outside workspace: ${toWorkspaceRelativePath(safePath, resolvedWorkspace)}`,
            403
          );
        }

        const ext = path.extname(safePath).toLowerCase();
        if (BINARY_EXTENSIONS.has(ext)) {
          return NextResponse.json(
            {
              content: `[Binary file: ${body.path}]`,
              binary: true,
            },
            { headers: corsHeaders(req) }
          );
        }

        const content = await readFile(safePath, "utf-8");
        const fileStat = await stat(safePath);
        return NextResponse.json(
          {
            content,
            size: fileStat.size,
            path: body.path,
            workspace,
          },
          { headers: corsHeaders(req) }
        );
      }

      case "write": {
        if (!body.path || body.content === undefined) {
          return NextResponse.json(
            { error: "Path and content required" },
            { status: 400, headers: corsHeaders(req) }
          );
        }

        const filePath = normalizePathForWorkspace(body.path, workspace);
        assertAllowedFileRoutePath(filePath, workspace, "write");
        const resolvedWorkspace = path.resolve(workspace);
        const safePath = path.resolve(filePath);
        if (
          safePath !== resolvedWorkspace &&
          !safePath.startsWith(`${resolvedWorkspace}${path.sep}`)
        ) {
          throw new FileRouteError(
            `Path is outside workspace: ${toWorkspaceRelativePath(safePath, resolvedWorkspace)}`,
            403
          );
        }

        // Create parent directories if needed
        await mkdir(path.dirname(safePath), { recursive: true });
        await writeFile(safePath, body.content, "utf-8");

        return NextResponse.json(
          {
            success: true,
            path: body.path,
            workspace,
          },
          { headers: corsHeaders(req) }
        );
      }

      case "summary": {
        // Build a compact codebase summary for injection into system prompt
        const tree = await buildTree(workspace, workspace, 0, 3);
        const treeText = treeToString(tree);

        // Read key config files for extra context
        const configFiles = [
          "package.json",
          "tsconfig.json",
          "README.md",
          "CLAUDE.md",
        ];
        const resolvedWorkspace = path.resolve(workspace);
        const configs: Record<string, string> = {};
        for (const f of configFiles) {
          try {
            const configPath = path.resolve(resolvedWorkspace, f);
            if (
              configPath !== resolvedWorkspace &&
              !configPath.startsWith(`${resolvedWorkspace}${path.sep}`)
            ) {
              continue;
            }
            const content = await readFile(configPath, "utf-8");
            configs[f] = content.slice(0, 2000); // Cap at 2KB each
          } catch {
            // File doesn't exist, skip
          }
        }

        return NextResponse.json(
          {
            workspace,
            tree: treeText,
            configs,
          },
          { headers: corsHeaders(req) }
        );
      }

      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}` },
          { status: 400, headers: corsHeaders(req) }
        );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "File operation failed";
    const status = statusFromFileRouteError(err);
    return NextResponse.json(
      { error: message },
      { status, headers: corsHeaders(req) }
    );
  }
}
