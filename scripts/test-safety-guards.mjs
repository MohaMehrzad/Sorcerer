import { readFile } from "fs/promises";
import path from "path";

const root = process.cwd();

async function read(relativePath) {
  return readFile(path.join(root, relativePath), "utf-8");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  const files = {
    pathPolicy: await read("src/lib/server/pathPolicy.ts"),
    filesRoute: await read("src/app/api/files/route.ts"),
    executeRoute: await read("src/app/api/execute/route.ts"),
    agentRunner: await read("src/lib/server/agentRunner.ts"),
    multiAgentRunner: await read("src/lib/server/multiAgentRunner.ts"),
    memoryStore: await read("src/lib/server/memoryStore.ts"),
    ci: await read(".github/workflows/ci.yml"),
    packageJson: await read("package.json"),
  };

  const requiredPathPolicyMarkers = [
    "const SAFE_DENYLIST_PATTERNS",
    "agent-memory",
    "agent-runs",
    "approved-workspaces",
    ".env(",
  ];
  for (const marker of requiredPathPolicyMarkers) {
    assert(
      files.pathPolicy.includes(marker),
      `pathPolicy denylist is missing required marker ${marker}`
    );
  }

  assert(
    files.filesRoute.includes("validateWorkspaceMutationAbsolutePath"),
    "/api/files must use validateWorkspaceMutationAbsolutePath"
  );

  assert(
    files.executeRoute.includes("ENABLE_RUNTIME_EXECUTION"),
    "/api/execute must require explicit opt-in via ENABLE_RUNTIME_EXECUTION"
  );
  assert(
    !files.executeRoute.includes("import { execFile, exec }"),
    "/api/execute should avoid shell exec imports"
  );
  assert(
    !files.executeRoute.includes("execAsync("),
    "/api/execute should avoid shell-based exec usage"
  );

  assert(
    files.agentRunner.includes("buildRestrictedExecutionEnv"),
    "agentRunner must use restricted execution environment"
  );
  assert(
    files.multiAgentRunner.includes("buildRestrictedExecutionEnv"),
    "multiAgentRunner must use restricted execution environment"
  );
  assert(
    !files.agentRunner.includes("...process.env"),
    "agentRunner should not pass full process.env to commands"
  );
  assert(
    !files.multiAgentRunner.includes("...process.env"),
    "multiAgentRunner should not pass full process.env to commands"
  );
  assert(
    files.agentRunner.includes("validateWorkspaceMutationAbsolutePath"),
    "agentRunner must validate mutation paths with shared policy"
  );
  assert(
    files.multiAgentRunner.includes("validateWorkspaceMutationPath"),
    "multiAgentRunner must validate mutation paths with shared policy"
  );

  const lockUses = (files.memoryStore.match(/withWorkspaceStoreLock\(/g) || []).length;
  assert(lockUses >= 7, "memoryStore must guard mutating operations with workspace lock");

  assert(files.packageJson.includes('"test": "node scripts/test-safety-guards.mjs"'), "package.json must define pnpm test");
  assert(files.ci.includes("pnpm test"), "CI workflow must run pnpm test");

  console.log("Safety guard tests passed.");
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`Safety guard tests failed: ${message}`);
  process.exit(1);
});
