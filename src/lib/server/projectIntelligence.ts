import { execFile } from "child_process";
import { promisify } from "util";
import { readFile } from "fs/promises";
import path from "path";

const execFileAsync = promisify(execFile);

export interface FileHotspot {
  path: string;
  lines: number;
}

export interface ModuleEdge {
  from: string;
  to: string;
}

export interface IntelligenceSignal {
  key: string;
  label: string;
  count: number;
  severity: "low" | "medium" | "high";
  samples: string[];
}

export interface ProjectIntelligence {
  generatedAt: string;
  workspace: string;
  stack: string[];
  topDirectories: string[];
  packageScripts: string[];
  testFileCount: number;
  hotspots: FileHotspot[];
  moduleEdges: ModuleEdge[];
  signals: IntelligenceSignal[];
  summary: string;
}

interface ListFilesOptions {
  workspace: string;
  globs?: string[];
  maxFiles?: number;
}

function truncateArray<T>(items: T[], maxItems: number): T[] {
  if (items.length <= maxItems) return items;
  return items.slice(0, maxItems);
}

async function listFiles(options: ListFilesOptions): Promise<string[]> {
  const args = ["--files"];

  if (options.globs) {
    for (const glob of options.globs) {
      args.push("-g", glob);
    }
  }
  args.push(options.workspace);

  try {
    const { stdout } = await execFileAsync("rg", args, {
      timeout: 20000,
      maxBuffer: 2_000_000,
    });

    const files = stdout
      .split("\n")
      .map((file) => file.trim())
      .filter(Boolean)
      .map((absolutePath) => path.relative(options.workspace, absolutePath))
      .filter(Boolean)
      .filter((file) => {
        if (file.startsWith("node_modules/")) return false;
        if (file.startsWith(".next/")) return false;
        if (file.startsWith(".git/")) return false;
        if (file.startsWith("dist/")) return false;
        if (file.startsWith("build/")) return false;
        if (file.startsWith("coverage/")) return false;
        return true;
      });

    return options.maxFiles ? truncateArray(files, options.maxFiles) : files;
  } catch {
    return [];
  }
}

function getTechLabel(ext: string): string | null {
  switch (ext) {
    case ".ts":
    case ".tsx":
      return "TypeScript";
    case ".js":
    case ".jsx":
      return "JavaScript";
    case ".py":
      return "Python";
    case ".go":
      return "Go";
    case ".rs":
      return "Rust";
    case ".java":
      return "Java";
    case ".swift":
      return "Swift";
    case ".c":
    case ".cpp":
    case ".h":
      return "C/C++";
    case ".rb":
      return "Ruby";
    case ".php":
      return "PHP";
    default:
      return null;
  }
}

async function computeHotspots(
  workspace: string,
  files: string[]
): Promise<FileHotspot[]> {
  const hotspots: FileHotspot[] = [];

  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    if (![".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs", ".java", ".md"].includes(ext)) {
      continue;
    }

    try {
      const content = await readFile(path.join(workspace, file), "utf-8");
      const lines = content.split("\n").length;
      hotspots.push({ path: file, lines });
    } catch {
      // Ignore unreadable files.
    }
  }

  hotspots.sort((a, b) => b.lines - a.lines);
  return hotspots.slice(0, 20);
}

function normalizeImportPath(importPath: string): string {
  return importPath.replace(/\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java)$/i, "");
}

async function buildModuleEdges(
  workspace: string,
  files: string[]
): Promise<ModuleEdge[]> {
  const edges: ModuleEdge[] = [];
  const edgeSet = new Set<string>();

  const codeFiles = files.filter((file) => {
    const ext = path.extname(file).toLowerCase();
    return [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py"].includes(ext);
  });

  for (const file of truncateArray(codeFiles, 260)) {
    try {
      const content = await readFile(path.join(workspace, file), "utf-8");

      const importRegex = /from\s+["']([^"']+)["']/g;
      const requireRegex = /require\(\s*["']([^"']+)["']\s*\)/g;

      const imports: string[] = [];

      let match = importRegex.exec(content);
      while (match) {
        imports.push(match[1]);
        match = importRegex.exec(content);
      }

      match = requireRegex.exec(content);
      while (match) {
        imports.push(match[1]);
        match = requireRegex.exec(content);
      }

      for (const imported of imports) {
        if (!(imported.startsWith("./") || imported.startsWith("../") || imported.startsWith("@/"))) {
          continue;
        }

        const edge: ModuleEdge = {
          from: file,
          to: normalizeImportPath(imported),
        };

        const key = `${edge.from}=>${edge.to}`;
        if (edgeSet.has(key)) continue;

        edgeSet.add(key);
        edges.push(edge);
      }
    } catch {
      // Ignore parse/read failures.
    }
  }

  return edges.slice(0, 240);
}

async function countPatternMatches(
  workspace: string,
  pattern: string,
  globs: string[]
): Promise<string[]> {
  const args = ["--line-number", "--color", "never", "--no-heading"];

  for (const glob of globs) {
    args.push("-g", glob);
  }

  args.push(pattern, workspace);

  try {
    const { stdout } = await execFileAsync("rg", args, {
      timeout: 12000,
      maxBuffer: 2_000_000,
    });

    return stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const match = line.match(/^(.*?):(\d+):(.*)$/);
        if (!match) return line;
        const [, filePath, lineNumber, rest] = match;
        return `${path.relative(workspace, filePath)}:${lineNumber}: ${rest.trim()}`;
      });
  } catch {
    return [];
  }
}

function buildSummary(intel: Omit<ProjectIntelligence, "summary">): string {
  const highestSignal = [...intel.signals].sort((a, b) => b.count - a.count)[0];
  const hotspot = intel.hotspots[0];

  const parts = [
    `Stack: ${intel.stack.join(", ") || "Unknown"}`,
    `Tests detected: ${intel.testFileCount}`,
    `Top hotspot: ${hotspot ? `${hotspot.path} (${hotspot.lines} lines)` : "none"}`,
    `Primary risk: ${highestSignal ? `${highestSignal.label} (${highestSignal.count})` : "none"}`,
  ];

  return parts.join(" | ");
}

function signalSeverityScore(severity: IntelligenceSignal["severity"]): number {
  if (severity === "high") return 3;
  if (severity === "medium") return 2;
  return 1;
}

export async function collectProjectIntelligence(
  workspace: string
): Promise<ProjectIntelligence> {
  const files = await listFiles({ workspace, maxFiles: 1400 });

  const stackSet = new Set<string>();
  const topDirectories = new Set<string>();
  let testFileCount = 0;

  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    const tech = getTechLabel(ext);
    if (tech) stackSet.add(tech);

    const parts = file.split("/");
    if (parts.length > 1) {
      topDirectories.add(parts[0]);
    }

    if (/(^|\/)(test|tests|__tests__)\b|\.(test|spec)\./i.test(file)) {
      testFileCount += 1;
    }
  }

  let packageScripts: string[] = [];
  try {
    const raw = await readFile(path.join(workspace, "package.json"), "utf-8");
    const parsed = JSON.parse(raw) as { scripts?: Record<string, string> };
    packageScripts = Object.keys(parsed.scripts || {}).sort();
  } catch {
    packageScripts = [];
  }

  const hotspots = await computeHotspots(workspace, files);
  const moduleEdges = await buildModuleEdges(workspace, files);

  const signalDefinitions: Array<{
    key: string;
    label: string;
    severity: "low" | "medium" | "high";
    pattern: string;
    globs: string[];
  }> = [
    {
      key: "todo_fixme",
      label: "TODO/FIXME/HACK markers",
      severity: "medium",
      pattern: "TODO|FIXME|HACK|XXX",
      globs: ["*.ts", "*.tsx", "*.js", "*.jsx", "*.py", "*.go", "*.rs"],
    },
    {
      key: "console_log",
      label: "console.log usage",
      severity: "low",
      pattern: "console\\.log\\(",
      globs: ["*.ts", "*.tsx", "*.js", "*.jsx"],
    },
    {
      key: "ts_any",
      label: "TypeScript any usage",
      severity: "medium",
      pattern: "\\bany\\b",
      globs: ["*.ts", "*.tsx"],
    },
    {
      key: "possible_secret",
      label: "Potential hardcoded secret",
      severity: "high",
      pattern: "sk-[A-Za-z0-9_-]{20,}|api[_-]?key|secret[_-]?key|token\\s*[:=]",
      globs: ["*.ts", "*.tsx", "*.js", "*.jsx", "*.py", "*.env*", "*.json", "*.md"],
    },
  ];

  const signals: IntelligenceSignal[] = [];
  for (const def of signalDefinitions) {
    const matches = await countPatternMatches(workspace, def.pattern, def.globs);
    signals.push({
      key: def.key,
      label: def.label,
      severity: def.severity,
      count: matches.length,
      samples: matches.slice(0, 8),
    });
  }
  signals.sort((a, b) => {
    const severityDelta = signalSeverityScore(b.severity) - signalSeverityScore(a.severity);
    if (severityDelta !== 0) return severityDelta;
    return b.count - a.count;
  });

  const resultWithoutSummary: Omit<ProjectIntelligence, "summary"> = {
    generatedAt: new Date().toISOString(),
    workspace,
    stack: Array.from(stackSet).sort(),
    topDirectories: Array.from(topDirectories).sort().slice(0, 24),
    packageScripts,
    testFileCount,
    hotspots,
    moduleEdges,
    signals,
  };

  return {
    ...resultWithoutSummary,
    summary: buildSummary(resultWithoutSummary),
  };
}
