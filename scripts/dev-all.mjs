import { spawn } from "child_process";
import process from "process";
import readline from "readline";

const PNPM_BIN = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

function color(code, text) {
  return `\u001b[${code}m${text}\u001b[0m`;
}

function prefixStream(stream, label, tone) {
  const rl = readline.createInterface({ input: stream });
  rl.on("line", (line) => {
    process.stdout.write(`${color(tone, `[${label}]`)} ${line}\n`);
  });
  return rl;
}

function startTask(label, args, tone) {
  const child = spawn(PNPM_BIN, args, {
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });

  const stdout = prefixStream(child.stdout, label, tone);
  const stderr = prefixStream(child.stderr, label, tone);

  return {
    label,
    child,
    stdout,
    stderr,
  };
}

const tasks = [
  startTask("backend", ["dev:backend"], "36"),
  startTask("frontend", ["dev:frontend"], "35"),
];

let shuttingDown = false;

function closeReaders() {
  for (const task of tasks) {
    task.stdout.close();
    task.stderr.close();
  }
}

function terminateChild(child, signal) {
  if (child.killed) return;
  try {
    child.kill(signal);
  } catch {
    // no-op
  }
}

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const task of tasks) {
    terminateChild(task.child, "SIGTERM");
  }

  const forceTimer = setTimeout(() => {
    for (const task of tasks) {
      terminateChild(task.child, "SIGKILL");
    }
  }, 4000);
  forceTimer.unref();

  let remaining = tasks.length;
  for (const task of tasks) {
    task.child.once("exit", () => {
      remaining -= 1;
      if (remaining === 0) {
        clearTimeout(forceTimer);
        closeReaders();
        process.exit(exitCode);
      }
    });
  }
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

for (const task of tasks) {
  task.child.on("exit", (code, signal) => {
    if (shuttingDown) return;

    if (code === 0 || signal === "SIGINT" || signal === "SIGTERM") {
      return;
    }

    process.stderr.write(
      `${color("31", "[dev-all]")} ${task.label} exited unexpectedly (code=${String(
        code
      )}, signal=${String(signal)}).\n`
    );
    shutdown(code ?? 1);
  });

  task.child.on("error", (err) => {
    if (shuttingDown) return;
    process.stderr.write(
      `${color("31", "[dev-all]")} ${task.label} failed to start: ${err.message}\n`
    );
    shutdown(1);
  });
}

