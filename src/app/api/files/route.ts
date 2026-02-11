import { NextRequest, NextResponse } from "next/server";
import { readdir, readFile, writeFile, mkdir, stat } from "fs/promises";
import path from "path";
import {
  normalizePathForWorkspace,
  resolveWorkspacePath,
} from "@/lib/server/workspace";

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

  const entries = await readdir(dirPath, { withFileTypes: true });
  const nodes: TreeNode[] = [];

  const sorted = entries.sort((a, b) => {
    // Directories first, then files
    if (a.isDirectory() && !b.isDirectory()) return -1;
    if (!a.isDirectory() && b.isDirectory()) return 1;
    return a.name.localeCompare(b.name);
  });

  for (const entry of sorted) {
    if (IGNORE.has(entry.name) || entry.name.startsWith(".")) continue;

    const fullPath = path.join(dirPath, entry.name);
    const relPath = path.relative(relativeTo, fullPath);

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

export async function POST(req: NextRequest) {
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
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { action } = body;

  try {
    const workspace = await resolveWorkspacePath(body.workspacePath);

    switch (action) {
      case "tree": {
        const depth = body.maxDepth || 4;
        const tree = await buildTree(workspace, workspace, 0, depth);
        const text = treeToString(tree);
        return NextResponse.json({ tree, text, workspace });
      }

      case "read": {
        if (!body.path) {
          return NextResponse.json({ error: "Path required" }, { status: 400 });
        }

        const filePath = normalizePathForWorkspace(body.path, workspace);

        const ext = path.extname(filePath).toLowerCase();
        if (BINARY_EXTENSIONS.has(ext)) {
          return NextResponse.json({
            content: `[Binary file: ${body.path}]`,
            binary: true,
          });
        }

        const content = await readFile(filePath, "utf-8");
        const fileStat = await stat(filePath);
        return NextResponse.json({
          content,
          size: fileStat.size,
          path: body.path,
          workspace,
        });
      }

      case "write": {
        if (!body.path || body.content === undefined) {
          return NextResponse.json(
            { error: "Path and content required" },
            { status: 400 }
          );
        }

        const filePath = normalizePathForWorkspace(body.path, workspace);

        // Create parent directories if needed
        await mkdir(path.dirname(filePath), { recursive: true });
        await writeFile(filePath, body.content, "utf-8");

        return NextResponse.json({
          success: true,
          path: body.path,
          workspace,
        });
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
        const configs: Record<string, string> = {};
        for (const f of configFiles) {
          try {
            const content = await readFile(path.join(workspace, f), "utf-8");
            configs[f] = content.slice(0, 2000); // Cap at 2KB each
          } catch {
            // File doesn't exist, skip
          }
        }

        return NextResponse.json({
          workspace,
          tree: treeText,
          configs,
        });
      }

      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}` },
          { status: 400 }
        );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "File operation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
