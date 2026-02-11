import { NextRequest, NextResponse } from "next/server";
import { execFile, exec } from "child_process";
import { promisify } from "util";
import { writeFile, unlink, mkdir } from "fs/promises";
import path from "path";
import crypto from "crypto";

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

const TIMEOUT = 30000;
const MAX_OUTPUT = 50000;

// --- Language configurations ---

interface InterpretedLang {
  type: "interpreted";
  cmd: string;
  ext: string;
  args?: string[];
}

interface CompiledLang {
  type: "compiled";
  ext: string;
  compile: (src: string, out: string) => string;
}

type LangConfig = InterpretedLang | CompiledLang;

const LANGUAGES: Record<string, LangConfig> = {
  // Interpreted
  python: { type: "interpreted", cmd: "python3", ext: ".py" },
  python3: { type: "interpreted", cmd: "python3", ext: ".py" },
  py: { type: "interpreted", cmd: "python3", ext: ".py" },
  javascript: { type: "interpreted", cmd: "node", ext: ".js" },
  js: { type: "interpreted", cmd: "node", ext: ".js" },
  typescript: { type: "interpreted", cmd: "npx", ext: ".ts", args: ["tsx"] },
  ts: { type: "interpreted", cmd: "npx", ext: ".ts", args: ["tsx"] },
  bash: { type: "interpreted", cmd: "bash", ext: ".sh" },
  sh: { type: "interpreted", cmd: "sh", ext: ".sh" },
  zsh: { type: "interpreted", cmd: "zsh", ext: ".sh" },
  ruby: { type: "interpreted", cmd: "ruby", ext: ".rb" },
  rb: { type: "interpreted", cmd: "ruby", ext: ".rb" },
  perl: { type: "interpreted", cmd: "perl", ext: ".pl" },
  pl: { type: "interpreted", cmd: "perl", ext: ".pl" },

  // Compiled
  c: {
    type: "compiled",
    ext: ".c",
    compile: (src, out) => `gcc -o "${out}" "${src}" -lm`,
  },
  cpp: {
    type: "compiled",
    ext: ".cpp",
    compile: (src, out) => `g++ -std=c++17 -o "${out}" "${src}"`,
  },
  "c++": {
    type: "compiled",
    ext: ".cpp",
    compile: (src, out) => `g++ -std=c++17 -o "${out}" "${src}"`,
  },
  rust: {
    type: "compiled",
    ext: ".rs",
    compile: (src, out) => `rustc -o "${out}" "${src}"`,
  },
  rs: {
    type: "compiled",
    ext: ".rs",
    compile: (src, out) => `rustc -o "${out}" "${src}"`,
  },
  swift: {
    type: "compiled",
    ext: ".swift",
    compile: (src, out) => `swiftc -o "${out}" "${src}"`,
  },
  java: {
    type: "compiled",
    ext: ".java",
    compile: () => "", // Java handled specially
  },
  go: {
    type: "compiled",
    ext: ".go",
    compile: (src, out) => `go build -o "${out}" "${src}"`,
  },
};

function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.slice(0, max) + `\n... (truncated, ${str.length} total chars)`;
}

async function runInterpreted(
  config: InterpretedLang,
  filePath: string
): Promise<{ output: string; exitCode: number }> {
  try {
    const args = [...(config.args || []), filePath];
    const { stdout, stderr } = await execFileAsync(config.cmd, args, {
      timeout: TIMEOUT,
      maxBuffer: MAX_OUTPUT,
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
    });
    const output = (stdout || "") + (stderr ? stderr : "");
    return { output: truncate(output, MAX_OUTPUT) || "(no output)", exitCode: 0 };
  } catch (err: unknown) {
    const e = err as {
      killed?: boolean;
      stdout?: string;
      stderr?: string;
      message?: string;
    };
    if (e.killed) {
      return {
        output: `Execution timed out after ${TIMEOUT / 1000}s.`,
        exitCode: 124,
      };
    }
    const output = (e.stdout || "") + (e.stderr ? e.stderr : "");
    return {
      output: truncate(output, MAX_OUTPUT) || e.message || "Execution failed",
      exitCode: 1,
    };
  }
}

async function runCompiled(
  config: CompiledLang,
  filePath: string,
  tmpDir: string,
  fileId: string
): Promise<{ output: string; exitCode: number }> {
  const outPath = path.join(tmpDir, `exec_${fileId}_bin`);

  try {
    // Special handling for Java
    if (config.ext === ".java") {
      return await runJava(filePath, tmpDir);
    }

    // Compile
    const compileCmd = config.compile(filePath, outPath);
    try {
      await execAsync(compileCmd, { timeout: TIMEOUT, maxBuffer: MAX_OUTPUT });
    } catch (err: unknown) {
      const e = err as { stderr?: string; message?: string };
      return {
        output: `Compilation error:\n${e.stderr || e.message || "Unknown error"}`,
        exitCode: 1,
      };
    }

    // Run
    try {
      const { stdout, stderr } = await execFileAsync(outPath, [], {
        timeout: TIMEOUT,
        maxBuffer: MAX_OUTPUT,
      });
      const output = (stdout || "") + (stderr ? stderr : "");
      return {
        output: truncate(output, MAX_OUTPUT) || "(no output)",
        exitCode: 0,
      };
    } catch (err: unknown) {
      const e = err as {
        killed?: boolean;
        stdout?: string;
        stderr?: string;
        message?: string;
      };
      if (e.killed) {
        return {
          output: `Execution timed out after ${TIMEOUT / 1000}s.`,
          exitCode: 124,
        };
      }
      const output = (e.stdout || "") + (e.stderr ? e.stderr : "");
      return {
        output: truncate(output, MAX_OUTPUT) || e.message || "Runtime error",
        exitCode: 1,
      };
    } finally {
      unlink(outPath).catch(() => {});
    }
  } catch (err: unknown) {
    const e = err as { message?: string };
    return { output: e.message || "Failed", exitCode: 1 };
  }
}

async function runJava(
  filePath: string,
  tmpDir: string
): Promise<{ output: string; exitCode: number }> {
  // Java needs the class name to match the file name
  // Read file to find the public class name
  const { readFile } = await import("fs/promises");
  const code = await readFile(filePath, "utf-8");
  const classMatch = code.match(
    /(?:public\s+)?class\s+(\w+)/
  );
  const className = classMatch ? classMatch[1] : "Main";

  // Rename the file to match the class name
  const javaPath = path.join(tmpDir, `${className}.java`);
  await writeFile(javaPath, code, "utf-8");

  try {
    // Compile
    try {
      await execAsync(`javac "${javaPath}"`, {
        timeout: TIMEOUT,
        maxBuffer: MAX_OUTPUT,
      });
    } catch (err: unknown) {
      const e = err as { stderr?: string; message?: string };
      return {
        output: `Compilation error:\n${e.stderr || e.message || "Unknown error"}`,
        exitCode: 1,
      };
    }

    // Run
    try {
      const { stdout, stderr } = await execAsync(
        `java -cp "${tmpDir}" ${className}`,
        { timeout: TIMEOUT, maxBuffer: MAX_OUTPUT }
      );
      const output = (stdout || "") + (stderr ? stderr : "");
      return {
        output: truncate(output, MAX_OUTPUT) || "(no output)",
        exitCode: 0,
      };
    } catch (err: unknown) {
      const e = err as {
        killed?: boolean;
        stdout?: string;
        stderr?: string;
        message?: string;
      };
      if (e.killed) {
        return {
          output: `Execution timed out after ${TIMEOUT / 1000}s.`,
          exitCode: 124,
        };
      }
      const output = (e.stdout || "") + (e.stderr ? e.stderr : "");
      return {
        output: truncate(output, MAX_OUTPUT) || e.message || "Runtime error",
        exitCode: 1,
      };
    }
  } finally {
    unlink(javaPath).catch(() => {});
    unlink(path.join(tmpDir, `${className}.class`)).catch(() => {});
  }
}

export async function POST(req: NextRequest) {
  let body: { code?: string; language?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { code, language } = body;
  if (!code?.trim()) {
    return NextResponse.json({ error: "No code provided" }, { status: 400 });
  }

  const lang = (language || "python").toLowerCase();
  const config = LANGUAGES[lang];
  if (!config) {
    const supported = [
      ...new Set(Object.values(LANGUAGES).map((c) => c.ext.replace(".", ""))),
    ];
    return NextResponse.json(
      {
        error: `Unsupported language: ${lang}. Supported: ${supported.join(", ")}`,
      },
      { status: 400 }
    );
  }

  const tmpDir = path.join(process.cwd(), ".tmp");
  const fileId = crypto.randomBytes(8).toString("hex");
  const filePath = path.join(tmpDir, `exec_${fileId}${config.ext}`);

  try {
    await mkdir(tmpDir, { recursive: true });
    await writeFile(filePath, code, "utf-8");

    if (config.type === "interpreted") {
      return NextResponse.json(await runInterpreted(config, filePath));
    } else {
      return NextResponse.json(
        await runCompiled(config, filePath, tmpDir, fileId)
      );
    }
  } catch (err: unknown) {
    const e = err as { message?: string };
    return NextResponse.json(
      { output: e.message || "Execution failed", exitCode: 1 },
      { status: 500 }
    );
  } finally {
    unlink(filePath).catch(() => {});
  }
}
