import { readdir, readFile, stat } from "fs/promises";
import { execFile } from "child_process";
import path from "path";
import { promisify } from "util";

export interface VerificationCommand {
  program: string;
  args?: string[];
  cwd?: string;
}

type NodePackageManager = "pnpm" | "npm" | "yarn" | "bun";

const MAX_DEFAULT_VERIFICATION_COMMANDS = 12;
const execFileAsync = promisify(execFile);
const binaryAvailabilityCache = new Map<string, Promise<boolean>>();

const LANGUAGE_GUIDANCE: Record<string, string> = {
  typescript:
    "TypeScript: preserve strict typing, avoid `any`, and keep exported types/interfaces coherent.",
  javascript:
    "JavaScript: keep modules deterministic, avoid hidden side effects, and prefer explicit error handling.",
  python:
    "Python: keep functions typed where practical, handle exceptions explicitly, and keep IO boundaries clear.",
  go: "Go: keep APIs small, return explicit errors, and keep code `gofmt`/`go test` clean.",
  rust: "Rust: preserve ownership/lifetime safety, avoid `unwrap()` in runtime paths, and keep checks/tests green.",
  java: "Java: maintain null-safety discipline, keep APIs backwards-compatible, and preserve testability.",
  csharp:
    "C#: use async/await correctly, keep nullable reference semantics explicit, and preserve project build integrity.",
  kotlin:
    "Kotlin: keep nullability explicit, prefer immutable data where possible, and preserve Gradle build health.",
  swift:
    "Swift: keep value semantics predictable, guard optionals safely, and maintain package/build correctness.",
  php: "PHP: prefer strict typing (`declare(strict_types=1)` where appropriate) and keep framework conventions intact.",
  ruby: "Ruby: keep changes idiomatic, small, and covered by focused tests/specs.",
  "c/c++":
    "C/C++: preserve memory safety boundaries, avoid UB-prone changes, and keep build/test commands explicit.",
  dart: "Dart: keep null-safety soundness and run analyzer/tests for changed code paths.",
  deno: "Deno: rely on `deno task` commands from config and keep lint/check/test flows passing.",
  sql: "SQL: use parameterized queries, protect transaction boundaries, and preserve migration reversibility.",
  shell:
    "Shell: keep scripts POSIX-safe where required, quote variables, and avoid destructive defaults.",
};

function normalizeLanguageHint(raw: string): string | null {
  const value = raw.trim().toLowerCase();
  if (!value) return null;
  if (value.includes("typescript")) return "typescript";
  if (value.includes("javascript")) return "javascript";
  if (value === "js") return "javascript";
  if (value.includes("python")) return "python";
  if (value === "py") return "python";
  if (value === "go" || value.includes("golang")) return "go";
  if (value.includes("rust")) return "rust";
  if (value.includes("java") && !value.includes("javascript")) return "java";
  if (value.includes("c#") || value.includes("csharp") || value.includes("dotnet")) return "csharp";
  if (value.includes("kotlin")) return "kotlin";
  if (value.includes("swift")) return "swift";
  if (value.includes("php")) return "php";
  if (value.includes("ruby")) return "ruby";
  if (value.includes("c/c++") || value === "c++" || value === "c") return "c/c++";
  if (value.includes("dart")) return "dart";
  if (value.includes("deno")) return "deno";
  if (value.includes("sql")) return "sql";
  if (value.includes("shell") || value.includes("bash") || value.includes("zsh") || value.includes("sh")) {
    return "shell";
  }
  return null;
}

export function mergeLanguageHints(...sources: Array<string[] | undefined>): string[] {
  const merged = new Set<string>();
  for (const source of sources) {
    if (!Array.isArray(source)) continue;
    for (const item of source) {
      const normalized = normalizeLanguageHint(item);
      if (normalized) merged.add(normalized);
    }
  }
  return Array.from(merged);
}

export function buildLanguageGuidanceBlock(...sources: Array<string[] | undefined>): string {
  const hints = mergeLanguageHints(...sources);
  if (hints.length === 0) {
    return "- Keep edits minimal, deterministic, and production-safe.";
  }
  const lines: string[] = [];
  for (const hint of hints) {
    const row = LANGUAGE_GUIDANCE[hint];
    if (row) lines.push(`- ${row}`);
  }
  if (lines.length === 0) {
    lines.push("- Keep edits minimal, deterministic, and production-safe.");
  }
  return lines.join("\n");
}

function hasScript(scripts: Record<string, string>, name: string): boolean {
  return typeof scripts[name] === "string" && scripts[name].trim().length > 0;
}

async function fileExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function readTextIfExists(targetPath: string): Promise<string | null> {
  try {
    return await readFile(targetPath, "utf-8");
  } catch {
    return null;
  }
}

async function detectNodePackageManager(workspace: string): Promise<NodePackageManager> {
  if (
    (await fileExists(path.join(workspace, "pnpm-lock.yaml"))) &&
    (await isBinaryAvailable("pnpm"))
  ) {
    return "pnpm";
  }
  if (
    (await fileExists(path.join(workspace, "yarn.lock"))) &&
    (await isBinaryAvailable("yarn"))
  ) {
    return "yarn";
  }
  if (
    (await fileExists(path.join(workspace, "bun.lockb"))) ||
    (await fileExists(path.join(workspace, "bun.lock")))
  ) {
    if (await isBinaryAvailable("bun")) {
      return "bun";
    }
  }
  return "npm";
}

async function isBinaryAvailable(program: string): Promise<boolean> {
  const cached = binaryAvailabilityCache.get(program);
  if (cached) {
    return cached;
  }

  const probe = execFileAsync("which", [program], {
    timeout: 2000,
    maxBuffer: 20000,
  })
    .then(() => true)
    .catch(() => false);
  binaryAvailabilityCache.set(program, probe);
  return probe;
}

function nodeScriptCommand(packageManager: NodePackageManager, script: string): VerificationCommand {
  if (packageManager === "pnpm") {
    return { program: "pnpm", args: ["-s", script] };
  }
  if (packageManager === "yarn") {
    return { program: "yarn", args: ["-s", script] };
  }
  if (packageManager === "bun") {
    return { program: "bun", args: ["run", script] };
  }
  return { program: "npm", args: ["run", "--silent", script] };
}

function nodeTypecheckCommand(packageManager: NodePackageManager): VerificationCommand {
  if (packageManager === "pnpm") {
    return { program: "pnpm", args: ["-s", "exec", "tsc", "--noEmit"] };
  }
  if (packageManager === "yarn") {
    return { program: "yarn", args: ["-s", "tsc", "--noEmit"] };
  }
  if (packageManager === "bun") {
    return { program: "bun", args: ["x", "tsc", "--noEmit"] };
  }
  return { program: "npx", args: ["tsc", "--noEmit"] };
}

async function discoverNodeCommands(workspace: string): Promise<VerificationCommand[]> {
  const packageJsonRaw = await readTextIfExists(path.join(workspace, "package.json"));
  if (!packageJsonRaw) return [];

  let parsed: {
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  try {
    parsed = JSON.parse(packageJsonRaw) as {
      scripts?: Record<string, string>;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
  } catch {
    return [];
  }

  const packageManager = await detectNodePackageManager(workspace);
  const scripts = parsed.scripts || {};
  const commands: VerificationCommand[] = [];

  if (hasScript(scripts, "lint")) {
    commands.push(nodeScriptCommand(packageManager, "lint"));
  }

  if (hasScript(scripts, "typecheck")) {
    commands.push(nodeScriptCommand(packageManager, "typecheck"));
  } else {
    const hasTypeScript =
      Boolean(parsed.devDependencies?.typescript) ||
      Boolean(parsed.dependencies?.typescript) ||
      (await fileExists(path.join(workspace, "tsconfig.json")));
    if (hasTypeScript) {
      commands.push(nodeTypecheckCommand(packageManager));
    }
  }

  if (hasScript(scripts, "test")) {
    commands.push(nodeScriptCommand(packageManager, "test"));
  }

  if (hasScript(scripts, "build")) {
    commands.push(nodeScriptCommand(packageManager, "build"));
  }

  return commands;
}

function maybePush(commands: VerificationCommand[], condition: boolean, command: VerificationCommand) {
  if (condition) commands.push(command);
}

async function discoverPythonCommands(workspace: string): Promise<VerificationCommand[]> {
  const pyproject = await readTextIfExists(path.join(workspace, "pyproject.toml"));
  const requirements = await readTextIfExists(path.join(workspace, "requirements.txt"));
  const setupPyExists = await fileExists(path.join(workspace, "setup.py"));
  const pipfileExists = await fileExists(path.join(workspace, "Pipfile"));
  const toxIniExists = await fileExists(path.join(workspace, "tox.ini"));
  const hasPythonProject = Boolean(pyproject || requirements || setupPyExists || pipfileExists || toxIniExists);

  if (!hasPythonProject) return [];

  const pythonBinary = (await isBinaryAvailable("python3"))
    ? "python3"
    : (await isBinaryAvailable("python"))
      ? "python"
      : null;
  if (!pythonBinary) return [];

  const corpus = `${pyproject || ""}\n${requirements || ""}`.toLowerCase();
  const hasPytest =
    corpus.includes("pytest") ||
    (await fileExists(path.join(workspace, "pytest.ini"))) ||
    (await fileExists(path.join(workspace, "tests"))) ||
    (await fileExists(path.join(workspace, "test")));
  const hasRuff = corpus.includes("ruff");
  const hasMypy = corpus.includes("mypy");

  const commands: VerificationCommand[] = [];
  maybePush(commands, hasRuff, { program: pythonBinary, args: ["-m", "ruff", "check", "."] });
  maybePush(commands, hasMypy, { program: pythonBinary, args: ["-m", "mypy", "."] });
  maybePush(commands, hasPytest, { program: pythonBinary, args: ["-m", "pytest", "-q"] });
  return commands;
}

async function discoverGoCommands(workspace: string): Promise<VerificationCommand[]> {
  if (!(await fileExists(path.join(workspace, "go.mod")))) return [];
  if (!(await isBinaryAvailable("go"))) return [];
  return [
    { program: "go", args: ["test", "./..."] },
  ];
}

async function discoverRustCommands(workspace: string): Promise<VerificationCommand[]> {
  if (!(await fileExists(path.join(workspace, "Cargo.toml")))) return [];
  if (!(await isBinaryAvailable("cargo"))) return [];
  return [
    { program: "cargo", args: ["check", "--workspace"] },
    { program: "cargo", args: ["test", "--workspace", "--all-targets"] },
  ];
}

async function discoverJavaCommands(workspace: string): Promise<VerificationCommand[]> {
  if (await fileExists(path.join(workspace, "pom.xml"))) {
    if (await isBinaryAvailable("mvn")) {
      return [{ program: "mvn", args: ["-q", "-DskipTests=false", "test"] }];
    }
    return [];
  }
  if (
    (await fileExists(path.join(workspace, "build.gradle"))) ||
    (await fileExists(path.join(workspace, "build.gradle.kts")))
  ) {
    if (await isBinaryAvailable("gradle")) {
      return [{ program: "gradle", args: ["test"] }];
    }
    return [];
  }
  return [];
}

async function discoverDotnetCommands(workspace: string): Promise<VerificationCommand[]> {
  let entries: string[] = [];
  try {
    entries = await readdir(workspace);
  } catch {
    return [];
  }
  const hasDotnet = entries.some(
    (entry) => entry.endsWith(".sln") || entry.endsWith(".csproj")
  );
  if (!hasDotnet) return [];
  if (!(await isBinaryAvailable("dotnet"))) return [];
  return [{ program: "dotnet", args: ["test"] }];
}

async function discoverSwiftCommands(workspace: string): Promise<VerificationCommand[]> {
  if (!(await fileExists(path.join(workspace, "Package.swift")))) return [];
  if (!(await isBinaryAvailable("swift"))) return [];
  return [{ program: "swift", args: ["test"] }];
}

async function discoverPhpCommands(workspace: string): Promise<VerificationCommand[]> {
  const composerRaw = await readTextIfExists(path.join(workspace, "composer.json"));
  if (!composerRaw) return [];
  try {
    const parsed = JSON.parse(composerRaw) as {
      scripts?: Record<string, unknown>;
      require?: Record<string, string>;
      "require-dev"?: Record<string, string>;
    };
    const scripts = parsed.scripts || {};
    const commands: VerificationCommand[] = [];
    maybePush(commands, typeof scripts.lint === "string" && (await isBinaryAvailable("composer")), {
      program: "composer",
      args: ["run-script", "--quiet", "lint"],
    });
    if (typeof scripts.test === "string" && (await isBinaryAvailable("composer"))) {
      commands.push({
        program: "composer",
        args: ["run-script", "--quiet", "test"],
      });
    } else {
      const hasPhpUnit = Boolean(
        parsed.require?.phpunit ||
          parsed["require-dev"]?.phpunit ||
          parsed["require-dev"]?.["phpunit/phpunit"]
      );
      maybePush(commands, hasPhpUnit && (await isBinaryAvailable("php")), {
        program: "php",
        args: ["vendor/bin/phpunit", "--colors=never"],
      });
    }
    return commands;
  } catch {
    return [];
  }
}

async function discoverRubyCommands(workspace: string): Promise<VerificationCommand[]> {
  if (!(await fileExists(path.join(workspace, "Gemfile")))) return [];
  const hasRake = await fileExists(path.join(workspace, "Rakefile"));
  if (!hasRake) return [];
  if (!(await isBinaryAvailable("bundle"))) return [];
  return [{ program: "bundle", args: ["exec", "rake", "test"] }];
}

async function discoverDenoCommands(workspace: string): Promise<VerificationCommand[]> {
  const configRaw =
    (await readTextIfExists(path.join(workspace, "deno.json"))) ||
    (await readTextIfExists(path.join(workspace, "deno.jsonc")));
  if (!configRaw) return [];
  if (!(await isBinaryAvailable("deno"))) return [];
  const rawLower = configRaw.toLowerCase();
  const commands: VerificationCommand[] = [];
  maybePush(commands, rawLower.includes('"lint"'), { program: "deno", args: ["task", "lint"] });
  maybePush(commands, rawLower.includes('"check"'), { program: "deno", args: ["task", "check"] });
  maybePush(commands, rawLower.includes('"test"'), { program: "deno", args: ["task", "test"] });
  if (commands.length === 0) {
    commands.push({ program: "deno", args: ["test"] });
  }
  return commands;
}

function commandKey(command: VerificationCommand): string {
  const args = Array.isArray(command.args) ? command.args : [];
  const cwd = command.cwd || "";
  return `${command.program}\u0000${args.join("\u0000")}\u0000${cwd}`;
}

function dedupeCommands(commands: VerificationCommand[]): VerificationCommand[] {
  const seen = new Set<string>();
  const unique: VerificationCommand[] = [];
  for (const command of commands) {
    const key = commandKey(command);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(command);
  }
  return unique;
}

export async function resolveDefaultVerificationCommands(
  workspace: string,
  overrideCommands: VerificationCommand[]
): Promise<VerificationCommand[]> {
  if (overrideCommands.length > 0) {
    return dedupeCommands(overrideCommands).slice(0, MAX_DEFAULT_VERIFICATION_COMMANDS);
  }

  const discovered = await Promise.all([
    discoverNodeCommands(workspace),
    discoverPythonCommands(workspace),
    discoverGoCommands(workspace),
    discoverRustCommands(workspace),
    discoverJavaCommands(workspace),
    discoverDotnetCommands(workspace),
    discoverSwiftCommands(workspace),
    discoverPhpCommands(workspace),
    discoverRubyCommands(workspace),
    discoverDenoCommands(workspace),
  ]);

  return dedupeCommands(discovered.flat()).slice(0, MAX_DEFAULT_VERIFICATION_COMMANDS);
}
