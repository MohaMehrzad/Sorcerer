import { execFile } from "child_process";
import { createHash, randomUUID } from "crypto";
import { mkdir, readFile, readdir, stat, unlink, writeFile } from "fs/promises";
import path from "path";
import { promisify } from "util";
import {
  completeModel,
  ModelConfig,
  ModelMessage,
  resolveModelConfig,
} from "@/lib/server/model";
import {
  collectProjectIntelligence,
  ProjectIntelligence,
} from "@/lib/server/projectIntelligence";
import { loadSkillDocuments, SkillDocument } from "@/lib/server/skills";
import {
  normalizePathForWorkspace,
  resolveWorkspacePath,
  toRelativeWorkspacePath,
} from "@/lib/server/workspace";
import {
  addMemoryEntries,
  ContinuationPacket,
  MemoryRetrievalDiagnostics,
  retrieveMemoryContext,
  saveContinuationPacket,
} from "@/lib/server/memoryStore";
import {
  buildLanguageGuidanceBlock,
  resolveDefaultVerificationCommands,
} from "@/lib/server/verificationPlanner";
import type {
  AgentAction,
  AgentCommand,
  AgentRunHooks,
  AgentRunProgressEvent,
  AgentRunRequest,
  AgentRunResult,
  AgentRunStatus,
  AgentStep,
  ChangeJournalEntry,
  ClarificationOption,
  ClarificationQuestion,
  ProjectDigest,
  VerificationCheckResult,
} from "@/lib/server/agentRunner";

const execFileAsync = promisify(execFile);

const DEFAULT_MAX_WORK_UNITS = 8;
const MAX_WORK_UNITS = 16;
const MAX_FILE_SIZE = 350000;
const COMMAND_TIMEOUT_MS = 120000;
const MAX_COMMAND_BUFFER = 800000;
const RESPONSE_OUTPUT_LIMIT = 6000;
const MAX_TREE_DEPTH = 3;
const MAX_FILE_SNIPPET_LINES = 220;
const MAX_FILE_SNIPPETS_PER_UNIT = 8;
const MAX_SUBAGENT_ATTEMPTS = 4;
const DEFAULT_UNIT_MAX_ATTEMPTS = 2;
const UNIT_VERIFICATION_LIMIT = 2;
const MAX_DEPENDENCY_REPLAN_ATTEMPTS = 3;
const ARTIFACT_CACHE_MAX_ENTRIES = 480;
const PATCH_HUNK_MAX_CHARS = 18000;
const FLAKY_TEST_MAX_RETRIES = 2;
const LOW_CONFIDENCE_ESCALATION_THRESHOLD = 0.55;
const CRITIC_REVIEW_ESCALATION_WINDOW = 0.08;
const CRITIC_FLOOR_ON_FINAL_ATTEMPT = 0.45;

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
]);

const ALLOWED_PROGRAMS = new Set([
  "pnpm",
  "npm",
  "npx",
  "yarn",
  "bun",
  "deno",
  "node",
  "python",
  "python3",
  "pytest",
  "dotnet",
  "mvn",
  "gradle",
  "composer",
  "php",
  "bundle",
  "uv",
  "go",
  "cargo",
  "rustc",
  "gcc",
  "g++",
  "javac",
  "java",
  "swift",
  "swiftc",
  "git",
  "rg",
  "ls",
  "cat",
  "pwd",
  "tsc",
]);

const ALLOWED_GIT_SUBCOMMANDS = new Set([
  "status",
  "diff",
  "show",
  "log",
  "rev-parse",
  "branch",
  "ls-files",
  "blame",
]);

const DISALLOWED_PACKAGE_MANAGER_SUBCOMMANDS = new Set([
  "publish",
  "login",
  "logout",
  "adduser",
  "owner",
  "token",
  "profile",
  "org",
  "team",
  "access",
]);

const READONLY_ROLE_PROGRAMS = new Set(["rg", "ls", "cat", "pwd", "git"]);
const MAINTENANCE_ROLE_PROGRAMS = new Set([
  "pnpm",
  "npm",
  "npx",
  "yarn",
  "bun",
  "deno",
  "node",
  "python",
  "python3",
  "dotnet",
  "mvn",
  "gradle",
  "composer",
  "php",
  "bundle",
  "tsc",
]);

const SAFE_DENYLIST_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /^\.git\//, reason: "Git internals are read-only." },
  { pattern: /^\.ssh\//, reason: "SSH material is protected." },
  { pattern: /(^|\/)\.env(\.|$)/, reason: "Environment secrets are protected." },
  { pattern: /(^|\/)id_rsa(\.pub)?$/, reason: "Private key material is protected." },
  { pattern: /(^|\/).*\.pem$/, reason: "Certificate/private key material is protected." },
  { pattern: /(^|\/).*\.key$/, reason: "Private key material is protected." },
  { pattern: /(^|\/)secrets?\//, reason: "Secret directories are protected." },
  { pattern: /^\.tmp\/agent-runs\//, reason: "Internal runtime state is protected." },
];

const DANGEROUS_SEGMENTS = new Set([
  "..",
  ".git",
  ".ssh",
  ".aws",
  ".gnupg",
]);

type VerificationMode = "unit" | "final" | "preflight";

type SubagentModelTier = "light" | "heavy";

type SubagentRole =
  | "supervisor"
  | "scout"
  | "planner"
  | "coder"
  | "critic"
  | "synthesizer";

interface TreeNode {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: TreeNode[];
}

interface WorkUnit {
  id: string;
  title: string;
  objective: string;
  dependsOn: string[];
  priority: number;
  filesHint: string[];
  verificationFocus: string[];
}

type WorkUnitStatus = "pending" | "running" | "completed" | "failed" | "blocked";

interface WorkUnitState {
  unit: WorkUnit;
  status: WorkUnitStatus;
  attempts: number;
  lastError?: string;
  summary?: string;
  verificationPassed: boolean | null;
  criticScore?: number;
  filesTouched: string[];
  blockingIssues: string[];
  startedAtMs?: number;
  endedAtMs?: number;
}

interface UnitPlanningResult {
  strategy: string;
  workUnits: WorkUnit[];
  finalChecks: string[];
}

interface DependencyReplanResult {
  strategyUpdate: string;
  dependencies: Array<{
    id: string;
    dependsOn: string[];
  }>;
}

interface ScoutResult {
  summary: string;
  relevantFiles: Array<{
    path: string;
    reason: string;
    relevance: number;
  }>;
  risks: string[];
}

interface PlannerResult {
  summary: string;
  approach: string[];
  steps: string[];
  writeTargets: Array<{
    path: string;
    operation: "write" | "append" | "delete";
    rationale: string;
  }>;
  testFocus: string[];
}

interface CoderChange {
  op: "write_file" | "append_file" | "delete_file" | "patch_file";
  path: string;
  content?: string;
  hunks?: Array<{
    oldText: string;
    newText: string;
    occurrence?: number;
  }>;
  rationale: string;
}

interface CoderResult {
  summary: string;
  changes: CoderChange[];
  verificationNotes: string[];
  remainingRisks: string[];
  confidence: number;
}

interface CriticResult {
  summary: string;
  score: number;
  blockingIssues: string[];
  nonBlockingIssues: string[];
  recommendations: string[];
}

interface SynthesizerResult {
  summary: string;
  verification: string[];
  remainingWork: string[];
}

interface ArtifactRecord<T = unknown> {
  role: SubagentRole;
  unitId: string;
  timestamp: string;
  summary: string;
  payload: T;
}

interface MultiAgentRunSummary {
  strategy: string;
  finalChecks: string[];
  workUnits: Array<{
    id: string;
    title: string;
    status: WorkUnitStatus;
    dependsOn: string[];
    attempts: number;
    criticScore?: number;
    verificationPassed: boolean | null;
    filesTouched: string[];
    summary?: string;
    error?: string;
    blockingIssues: string[];
  }>;
  artifacts: Array<{
    role: SubagentRole;
    unitId: string;
    summary: string;
    timestamp: string;
  }>;
  flakyQuarantinedCommands: string[];
  observability: {
    totalDurationMs: number;
    modelUsage: Array<{
      role: SubagentRole;
      tier: SubagentModelTier;
      calls: number;
      cacheHits: number;
      retries: number;
      escalations: number;
      estimatedInputTokens: number;
      estimatedOutputTokens: number;
      estimatedCostUnits: number;
      totalLatencyMs: number;
    }>;
    unitMetrics: Array<{
      unitId: string;
      title: string;
      status: WorkUnitStatus;
      attempts: number;
      durationMs: number;
      criticScore?: number;
      verificationPassed: boolean | null;
    }>;
    failureHeatmap: Array<{
      label: string;
      count: number;
    }>;
  };
}

interface FileSnapshot {
  absolutePath: string;
  relativePath: string;
  existed: boolean;
  previousContent: string;
}

interface MultiToolContext {
  workspace: string;
  request: AgentRunRequest;
  changedFiles: Set<string>;
  commandsRun: string[];
  fileWriteCount: number;
  commandRunCount: number;
  snapshots: Map<string, FileSnapshot>;
  changeJournal: ChangeJournalEntry[];
}

interface VerificationRunResult {
  passed: boolean;
  checks: VerificationCheckResult[];
  flakyRecoveredCommands: string[];
}

interface VerificationOptions {
  mode: VerificationMode;
  flakyTestRetries: number;
  allowFlakyQuarantine: boolean;
}

interface ModelRoutingConfig {
  defaultModel: string;
  lightModel: string;
  heavyModel: string;
}

interface SubagentCallResult<T> {
  parsed: T;
  raw: string;
  attempts: number;
  inputTokensEstimate: number;
  outputTokensEstimate: number;
  modelUsed: string;
  tier: SubagentModelTier;
  cacheHit: boolean;
}

class RunCanceledError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunCanceledError";
  }
}

class ArtifactStore {
  private readonly records: ArtifactRecord[] = [];

  add<T>(role: SubagentRole, unitId: string, summary: string, payload: T) {
    this.records.push({
      role,
      unitId,
      summary: truncate(summary, 1200),
      payload,
      timestamp: new Date().toISOString(),
    });
  }

  getUnitContext(unitId: string, maxRecords: number = 8): string {
    const rows = this.records
      .filter((record) => record.unitId === unitId)
      .slice(-maxRecords)
      .map((record) => `- [${record.role}] ${record.summary}`);
    return rows.length > 0 ? rows.join("\n") : "- (no prior artifacts)";
  }

  toSummary(maxItems: number = 80): MultiAgentRunSummary["artifacts"] {
    return this.records.slice(-maxItems).map((record) => ({
      role: record.role,
      unitId: record.unitId,
      summary: record.summary,
      timestamp: record.timestamp,
    }));
  }
}

class SerializedWriteQueue {
  private chain: Promise<void> = Promise.resolve();

  enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.chain.then(task, task);
    this.chain = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }
}

interface CachedSubagentArtifact {
  role: SubagentRole;
  key: string;
  raw: string;
  payload: unknown;
  createdAt: string;
  updatedAt: string;
  hits: number;
}

class SubagentArtifactCache {
  private readonly filePath: string;
  private readonly entries = new Map<string, CachedSubagentArtifact>();
  private loaded = false;

  constructor(workspace: string) {
    this.filePath = path.join(workspace, ".tmp", "agent-runs", "multi-agent-cache.json");
  }

  private normalizeEntries(input: unknown): CachedSubagentArtifact[] {
    if (!Array.isArray(input)) return [];
    return input
      .map((entry) => {
        if (!entry || typeof entry !== "object") return null;
        const typed = entry as Record<string, unknown>;
        if (typeof typed.key !== "string" || !typed.key.trim()) return null;
        if (typeof typed.role !== "string" || !typed.role.trim()) return null;
        if (typeof typed.raw !== "string") return null;
        return {
          role: typed.role as SubagentRole,
          key: typed.key,
          raw: typed.raw,
          payload: typed.payload,
          createdAt:
            typeof typed.createdAt === "string" ? typed.createdAt : new Date().toISOString(),
          updatedAt:
            typeof typed.updatedAt === "string" ? typed.updatedAt : new Date().toISOString(),
          hits: typeof typed.hits === "number" ? Math.max(0, typed.hits) : 0,
        } as CachedSubagentArtifact;
      })
      .filter((entry): entry is CachedSubagentArtifact => entry !== null);
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = await readFile(this.filePath, "utf-8");
      const parsed = JSON.parse(raw) as {
        version?: number;
        entries?: unknown;
      };
      const normalized = this.normalizeEntries(parsed.entries || []);
      for (const entry of normalized) {
        this.entries.set(entry.key, entry);
      }
    } catch {
      // Cache is optional.
    }
  }

  get<T>(
    key: string,
    parser: (value: unknown) => T
  ): { parsed: T; raw: string } | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    try {
      const parsed = parser(entry.payload);
      entry.hits += 1;
      entry.updatedAt = new Date().toISOString();
      this.entries.set(key, entry);
      return {
        parsed,
        raw: entry.raw,
      };
    } catch {
      this.entries.delete(key);
      return undefined;
    }
  }

  set<T>(role: SubagentRole, key: string, value: { raw: string; parsed: T }): void {
    const timestamp = new Date().toISOString();
    this.entries.set(key, {
      role,
      key,
      raw: value.raw,
      payload: value.parsed,
      createdAt: timestamp,
      updatedAt: timestamp,
      hits: 0,
    });
  }

  async persist(): Promise<void> {
    if (!this.loaded) return;
    const entries = Array.from(this.entries.values())
      .sort((a, b) => {
        const first = Date.parse(a.updatedAt);
        const second = Date.parse(b.updatedAt);
        return second - first;
      })
      .slice(0, ARTIFACT_CACHE_MAX_ENTRIES);
    try {
      await mkdir(path.dirname(this.filePath), { recursive: true });
      await writeFile(
        this.filePath,
        JSON.stringify(
          {
            version: 1,
            entries,
          },
          null,
          2
        ),
        "utf-8"
      );
    } catch {
      // Cache persistence is best-effort.
    }
  }
}

interface RoleObservabilityMetric {
  role: SubagentRole;
  tier: SubagentModelTier;
  calls: number;
  cacheHits: number;
  retries: number;
  escalations: number;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedCostUnits: number;
  totalLatencyMs: number;
}

class ObservabilityTracker {
  private readonly roleMetrics = new Map<string, RoleObservabilityMetric>();
  private readonly failures = new Map<string, number>();

  private metricKey(role: SubagentRole, tier: SubagentModelTier): string {
    return `${role}:${tier}`;
  }

  recordSubagentCall(params: {
    role: SubagentRole;
    tier: SubagentModelTier;
    cacheHit: boolean;
    retries: number;
    escalated: boolean;
    inputTokensEstimate: number;
    outputTokensEstimate: number;
    latencyMs: number;
  }) {
    const key = this.metricKey(params.role, params.tier);
    const existing = this.roleMetrics.get(key) || {
      role: params.role,
      tier: params.tier,
      calls: 0,
      cacheHits: 0,
      retries: 0,
      escalations: 0,
      estimatedInputTokens: 0,
      estimatedOutputTokens: 0,
      estimatedCostUnits: 0,
      totalLatencyMs: 0,
    };
    const tierWeight = params.tier === "heavy" ? 2.2 : 1;

    existing.calls += 1;
    existing.cacheHits += params.cacheHit ? 1 : 0;
    existing.retries += params.retries;
    existing.escalations += params.escalated ? 1 : 0;
    existing.estimatedInputTokens += params.inputTokensEstimate;
    existing.estimatedOutputTokens += params.outputTokensEstimate;
    existing.totalLatencyMs += params.latencyMs;
    existing.estimatedCostUnits +=
      (params.inputTokensEstimate + params.outputTokensEstimate) * tierWeight;
    this.roleMetrics.set(key, existing);
  }

  recordFailure(label: string) {
    const normalized = label.trim() || "unknown";
    this.failures.set(normalized, (this.failures.get(normalized) || 0) + 1);
  }

  toSummary(params: {
    totalDurationMs: number;
    unitStates: WorkUnitState[];
  }): MultiAgentRunSummary["observability"] {
    return {
      totalDurationMs: params.totalDurationMs,
      modelUsage: Array.from(this.roleMetrics.values()).sort((a, b) =>
        a.role.localeCompare(b.role)
      ),
      unitMetrics: params.unitStates.map((state) => ({
        unitId: state.unit.id,
        title: state.unit.title,
        status: state.status,
        attempts: state.attempts,
        durationMs:
          state.startedAtMs && state.endedAtMs && state.endedAtMs >= state.startedAtMs
            ? state.endedAtMs - state.startedAtMs
            : 0,
        criticScore: state.criticScore,
        verificationPassed: state.verificationPassed,
      })),
      failureHeatmap: Array.from(this.failures.entries())
        .map(([label, count]) => ({ label, count }))
        .sort((a, b) => b.count - a.count),
    };
  }
}

const TEAM_ROLE_POOL = [
  "Tech Lead",
  "Principal Architect",
  "Backend Engineer",
  "Frontend Engineer",
  "Platform Engineer",
  "DevOps Engineer",
  "QA Engineer",
  "Security Engineer",
  "Performance Engineer",
  "Database Engineer",
  "Reliability Engineer",
  "Developer Experience Engineer",
  "Test Automation Engineer",
  "Accessibility Engineer",
  "API Engineer",
  "Release Engineer",
  "Observability Engineer",
  "Code Review Lead",
  "Product Integrator",
  "Documentation Engineer",
] as const;

function emit(hooks: AgentRunHooks | undefined, event: AgentRunProgressEvent) {
  hooks?.onEvent?.(event);
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new RunCanceledError("Run canceled by user");
  }
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function clampFloat(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n... (truncated ${text.length - maxChars} chars)`;
}

function estimateTokens(value: string): number {
  if (!value) return 0;
  return Math.max(1, Math.ceil(value.length / 4));
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function categorizeFailure(message: string): string {
  const normalized = message.toLowerCase();
  if (normalized.includes("timeout")) return "timeout";
  if (normalized.includes("critic gate")) return "critic_gate";
  if (normalized.includes("verification")) return "verification";
  if (normalized.includes("parse")) return "parse_error";
  if (normalized.includes("dependency")) return "dependency";
  if (normalized.includes("denied")) return "safety_policy";
  return normalized.slice(0, 42) || "unknown";
}

function resolveRoleModelRouting(
  request: AgentRunRequest,
  defaultModel: string
): ModelRoutingConfig {
  if (request.modelOverride && request.modelOverride.trim()) {
    const pinned = request.modelOverride.trim();
    return {
      defaultModel: pinned,
      lightModel: pinned,
      heavyModel: pinned,
    };
  }

  const lightModel =
    process.env.MODEL_NAME_LIGHT ||
    process.env.MODEL_LIGHT_NAME ||
    defaultModel;
  const heavyModel =
    process.env.MODEL_NAME_HEAVY ||
    process.env.MODEL_HEAVY_NAME ||
    defaultModel;

  return {
    defaultModel,
    lightModel: lightModel.trim() || defaultModel,
    heavyModel: heavyModel.trim() || defaultModel,
  };
}

function preferredTierForRole(role: SubagentRole): SubagentModelTier {
  if (role === "scout" || role === "planner") return "light";
  return "heavy";
}

function modelForRole(
  role: SubagentRole,
  routing: ModelRoutingConfig,
  tierOverride?: SubagentModelTier
): { model: string; tier: SubagentModelTier } {
  const tier = tierOverride || preferredTierForRole(role);
  return {
    model: tier === "light" ? routing.lightModel : routing.heavyModel,
    tier,
  };
}

function safeRelativePath(input: string): string {
  return input.replace(/\\/g, "/").replace(/^\/+/, "").trim();
}

function validateSafeWritePath(relativePath: string): { ok: boolean; reason?: string } {
  if (!relativePath || relativePath.length > 260) {
    return { ok: false, reason: "Path is empty or too long." };
  }

  if (/[\u0000-\u001F]/.test(relativePath)) {
    return { ok: false, reason: "Path contains control characters." };
  }

  const segments = relativePath.split("/").filter(Boolean);
  for (const segment of segments) {
    if (DANGEROUS_SEGMENTS.has(segment)) {
      return { ok: false, reason: `Denied unsafe path segment '${segment}'.` };
    }
    if (segment.startsWith(".") && segment !== ".github") {
      return {
        ok: false,
        reason: `Denied hidden path segment '${segment}'.`,
      };
    }
  }

  for (const rule of SAFE_DENYLIST_PATTERNS) {
    if (rule.pattern.test(relativePath)) {
      return { ok: false, reason: `Denied by safety policy: ${rule.reason}` };
    }
  }

  return { ok: true };
}

function detectDependencyCycle(units: WorkUnit[]): string[] | null {
  const byId = new Map(units.map((unit) => [unit.id, unit]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];

  const dfs = (id: string): string[] | null => {
    if (visiting.has(id)) {
      const cycleStart = stack.indexOf(id);
      return cycleStart >= 0 ? stack.slice(cycleStart).concat(id) : [id];
    }
    if (visited.has(id)) return null;
    visiting.add(id);
    stack.push(id);
    const node = byId.get(id);
    if (node) {
      for (const dependencyId of node.dependsOn) {
        if (!byId.has(dependencyId)) continue;
        const cycle = dfs(dependencyId);
        if (cycle) return cycle;
      }
    }
    stack.pop();
    visiting.delete(id);
    visited.add(id);
    return null;
  };

  for (const unit of units) {
    const cycle = dfs(unit.id);
    if (cycle) return cycle;
  }
  return null;
}

function hasDependencyGraphChanged(
  before: Array<{ id: string; dependsOn: string[] }>,
  after: Array<{ id: string; dependsOn: string[] }>
): boolean {
  const normalize = (input: Array<{ id: string; dependsOn: string[] }>) =>
    input
      .map((entry) => `${entry.id}:${entry.dependsOn.slice().sort().join(",")}`)
      .sort()
      .join("|");
  return normalize(before) !== normalize(after);
}

function toErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message.trim().length > 0) {
    return err.message;
  }
  if (typeof err === "string" && err.trim().length > 0) {
    return err;
  }
  return fallback;
}

function ensureString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`${field} must be a string`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return trimmed;
}

function ensureOptionalStringArray(value: unknown, field: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${field} must be an array of strings`);
  }
  return value.map((item) => item.trim()).filter(Boolean);
}

function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();

  try {
    return JSON.parse(trimmed);
  } catch {
    // Continue with extraction fallback.
  }

  const fencedMatch = trimmed.match(/```json\s*([\s\S]*?)```/i);
  if (fencedMatch) {
    return JSON.parse(fencedMatch[1]);
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
  }

  throw new Error("No JSON object found");
}

function createStep(params: {
  iteration: number;
  phase: "action" | "verification";
  role: string;
  summary: string;
  output: string;
  ok: boolean;
  durationMs: number;
  action?: AgentAction;
}): AgentStep {
  return {
    iteration: params.iteration,
    phase: params.phase,
    thinking: `[${params.role}] ${params.summary}`,
    action:
      params.action ||
      ({
        type: "run_command",
        program: `subagent:${params.role.toLowerCase()}`,
        args: [],
      } as AgentAction),
    ok: params.ok,
    summary: params.summary,
    output: truncate(params.output, RESPONSE_OUTPUT_LIMIT),
    durationMs: params.durationMs,
  };
}

async function buildTree(
  dirPath: string,
  relativeTo: string,
  depth: number,
  maxDepth: number
): Promise<TreeNode[]> {
  if (depth >= maxDepth) return [];

  const entries = await readdir(dirPath, { withFileTypes: true });
  const nodes: TreeNode[] = [];
  const sorted = entries.sort((a, b) => {
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
      continue;
    }

    nodes.push({
      name: entry.name,
      path: relPath,
      type: "file",
    });
  }

  return nodes;
}

function treeToString(nodes: TreeNode[], prefix: string = ""): string {
  let output = "";
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    const isLast = index === nodes.length - 1;
    const connector = isLast ? "└── " : "├── ";
    const childPrefix = isLast ? "    " : "│   ";

    output += `${prefix}${connector}${node.name}${node.type === "directory" ? "/" : ""}\n`;
    if (node.children && node.children.length > 0) {
      output += treeToString(node.children, `${prefix}${childPrefix}`);
    }
  }
  return output;
}

function detectLanguageHints(nodes: TreeNode[]): string[] {
  const hints = new Set<string>();
  const walk = (items: TreeNode[]) => {
    for (const item of items) {
      if (item.type === "file") {
        const ext = path.extname(item.name).toLowerCase();
        if (ext === ".ts" || ext === ".tsx") hints.add("TypeScript");
        if (ext === ".js" || ext === ".jsx") hints.add("JavaScript");
        if (ext === ".py") hints.add("Python");
        if (ext === ".go") hints.add("Go");
        if (ext === ".rs") hints.add("Rust");
        if (ext === ".java") hints.add("Java");
        if (ext === ".cs") hints.add("C#");
        if (ext === ".kt" || ext === ".kts") hints.add("Kotlin");
        if (ext === ".swift") hints.add("Swift");
        if (ext === ".php") hints.add("PHP");
        if (ext === ".rb") hints.add("Ruby");
        if (ext === ".dart") hints.add("Dart");
        if (ext === ".sql") hints.add("SQL");
        if (ext === ".sh") hints.add("Shell");
        if (ext === ".c" || ext === ".cpp" || ext === ".h") hints.add("C/C++");
        if (item.name === "go.mod") hints.add("Go");
        if (item.name === "Cargo.toml") hints.add("Rust");
        if (item.name === "pom.xml") hints.add("Java");
        if (item.name === "build.gradle" || item.name === "build.gradle.kts") {
          hints.add("Java");
          hints.add("Kotlin");
        }
        if (item.name === "Package.swift") hints.add("Swift");
        if (item.name === "composer.json") hints.add("PHP");
        if (item.name === "Gemfile") hints.add("Ruby");
        if (item.name === "deno.json" || item.name === "deno.jsonc") hints.add("Deno");
      } else if (item.children) {
        walk(item.children);
      }
    }
  };
  walk(nodes);
  return Array.from(hints);
}

async function buildProjectDigest(workspace: string): Promise<ProjectDigest> {
  const treeNodes = await buildTree(workspace, workspace, 0, MAX_TREE_DEPTH);
  const treePreview = truncate(treeToString(treeNodes), 7000);
  const keyDirectories = treeNodes
    .filter((node) => node.type === "directory")
    .slice(0, 20)
    .map((node) => node.path);

  let packageScripts: string[] = [];
  let hasTests = false;
  try {
    const raw = await readFile(path.join(workspace, "package.json"), "utf-8");
    const parsed = JSON.parse(raw) as { scripts?: Record<string, string> };
    const scripts = parsed.scripts || {};
    packageScripts = Object.keys(scripts).sort();
    hasTests = packageScripts.some((script) => /test/i.test(script));
  } catch {
    // Non-node project.
  }

  if (!hasTests) {
    try {
      await execFileAsync("rg", ["--files", "-g", "*test*", workspace], {
        timeout: 6000,
        maxBuffer: 120000,
      });
      hasTests = true;
    } catch {
      // No test files found.
    }
  }

  return {
    workspace,
    keyDirectories,
    packageScripts,
    languageHints: detectLanguageHints(treeNodes),
    hasTests,
    treePreview,
  };
}

function createEmptyProjectIntelligence(workspace: string): ProjectIntelligence {
  return {
    generatedAt: new Date().toISOString(),
    workspace,
    stack: [],
    topDirectories: [],
    packageScripts: [],
    testFileCount: 0,
    hotspots: [],
    moduleEdges: [],
    signals: [],
    summary: "No intelligence collected.",
  };
}

function buildTeamRoster(teamSize: number): string[] {
  const roster: string[] = [];
  for (let index = 0; index < teamSize; index += 1) {
    const role = TEAM_ROLE_POOL[index % TEAM_ROLE_POOL.length];
    const cycle = Math.floor(index / TEAM_ROLE_POOL.length) + 1;
    roster.push(cycle > 1 ? `${role} ${cycle}` : role);
  }
  return roster;
}

function firstNonFlagArg(args: string[]): string | undefined {
  for (const arg of args) {
    if (!arg.startsWith("-")) return arg;
  }
  return undefined;
}

function validateProgramAndArgs(program: string, args: string[]) {
  if (!ALLOWED_PROGRAMS.has(program)) {
    throw new Error(
      `Program '${program}' is not allowed. Allowed programs: ${Array.from(ALLOWED_PROGRAMS).join(", ")}`
    );
  }

  for (const arg of args) {
    if (arg.length > 1000) {
      throw new Error("Command argument is too long");
    }
  }

  if (program === "git") {
    const subcommand = firstNonFlagArg(args);
    if (!subcommand || !ALLOWED_GIT_SUBCOMMANDS.has(subcommand)) {
      throw new Error(
        `Git subcommand '${subcommand || ""}' is not allowed. Allowed: ${Array.from(ALLOWED_GIT_SUBCOMMANDS).join(", ")}`
      );
    }
  }

  if (
    program === "pnpm" ||
    program === "npm" ||
    program === "npx" ||
    program === "yarn" ||
    program === "bun"
  ) {
    const subcommand = firstNonFlagArg(args);
    if (subcommand && DISALLOWED_PACKAGE_MANAGER_SUBCOMMANDS.has(subcommand)) {
      throw new Error(`Package-manager subcommand '${subcommand}' is not allowed`);
    }
  }
}

function normalizeCommand(command: AgentCommand): AgentCommand {
  const program = command.program?.trim();
  if (!program) {
    throw new Error("Command program cannot be empty");
  }
  const args = Array.isArray(command.args) ? command.args : [];
  if (args.some((arg) => typeof arg !== "string")) {
    throw new Error("Command args must be strings");
  }
  validateProgramAndArgs(program, args);
  return {
    program,
    args,
    cwd: typeof command.cwd === "string" ? command.cwd : undefined,
  };
}

function isProgramAllowedForRole(
  role: "verifier" | "maintenance" | "readonly",
  program: string
): boolean {
  if (role === "verifier") {
    return ALLOWED_PROGRAMS.has(program);
  }
  if (role === "readonly") {
    return READONLY_ROLE_PROGRAMS.has(program);
  }
  return MAINTENANCE_ROLE_PROGRAMS.has(program);
}

function stringifyCommand(command: AgentCommand): string {
  const args = (command.args || []).map((arg) => {
    if (/^[a-zA-Z0-9._\-/=:@]+$/.test(arg)) return arg;
    return JSON.stringify(arg);
  });
  return `${command.program}${args.length > 0 ? ` ${args.join(" ")}` : ""}`;
}

async function runCommand(
  command: AgentCommand,
  context: MultiToolContext,
  signal?: AbortSignal,
  role: "verifier" | "maintenance" | "readonly" = "verifier"
): Promise<{
  ok: boolean;
  output: string;
  summary: string;
  durationMs: number;
}> {
  const normalized = normalizeCommand(command);
  if (!isProgramAllowedForRole(role, normalized.program)) {
    return {
      ok: false,
      output: `Role '${role}' is not permitted to run '${normalized.program}'`,
      summary: "Command denied by role policy",
      durationMs: 0,
    };
  }

  if (context.commandRunCount >= context.request.maxCommandRuns) {
    return {
      ok: false,
      output: `maxCommandRuns=${context.request.maxCommandRuns}`,
      summary: "Command budget exceeded",
      durationMs: 0,
    };
  }

  throwIfAborted(signal);

  const commandString = stringifyCommand(normalized);
  const cwd = normalized.cwd
    ? normalizePathForWorkspace(normalized.cwd, context.workspace)
    : context.workspace;

  context.commandRunCount += 1;
  context.commandsRun.push(commandString);

  // The API runs inside `next dev`, so inherited NODE_ENV=development breaks `next build`.
  const inheritedNodeEnv = process.env.NODE_ENV;
  const commandNodeEnv =
    inheritedNodeEnv && ["production", "test"].includes(inheritedNodeEnv)
      ? inheritedNodeEnv
      : "production";
  const commandEnv: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: commandNodeEnv,
    CI: "1",
    FORCE_COLOR: "0",
  };

  const startedAt = Date.now();
  try {
    const { stdout, stderr } = await execFileAsync(
      normalized.program,
      normalized.args || [],
      {
        cwd,
        timeout: COMMAND_TIMEOUT_MS,
        maxBuffer: MAX_COMMAND_BUFFER,
        env: commandEnv,
        signal,
      }
    );

    const output = [stdout, stderr].filter(Boolean).join("\n").trim();
    return {
      ok: true,
      summary: `Command succeeded: ${commandString}`,
      output: truncate(output || "(no output)", RESPONSE_OUTPUT_LIMIT),
      durationMs: Date.now() - startedAt,
    };
  } catch (err) {
    const error = err as {
      killed?: boolean;
      stdout?: string;
      stderr?: string;
      message?: string;
    };
    if (error.killed) {
      return {
        ok: false,
        summary: `Command timed out: ${commandString}`,
        output: `Command timed out after ${COMMAND_TIMEOUT_MS / 1000}s`,
        durationMs: Date.now() - startedAt,
      };
    }
    const output = [error.stdout, error.stderr, error.message]
      .filter(Boolean)
      .join("\n")
      .trim();
    return {
      ok: false,
      summary: `Command failed: ${commandString}`,
      output: truncate(output || "Command failed", RESPONSE_OUTPUT_LIMIT),
      durationMs: Date.now() - startedAt,
    };
  }
}

async function ensureSnapshot(relativePath: string, context: MultiToolContext): Promise<void> {
  const normalized = relativePath.replace(/\\/g, "/");
  if (context.snapshots.has(normalized)) return;

  const absolutePath = normalizePathForWorkspace(normalized, context.workspace);
  try {
    const previousContent = await readFile(absolutePath, "utf-8");
    context.snapshots.set(normalized, {
      absolutePath,
      relativePath: normalized,
      existed: true,
      previousContent,
    });
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    if (error.code !== "ENOENT") {
      throw err;
    }
    context.snapshots.set(normalized, {
      absolutePath,
      relativePath: normalized,
      existed: false,
      previousContent: "",
    });
  }
}

function journal(
  context: MultiToolContext,
  op: "write" | "append" | "delete",
  targetPath: string,
  details: string
) {
  context.changeJournal.push({
    op,
    path: targetPath,
    timestamp: new Date().toISOString(),
    details,
  });
}

function applyPatchHunks(
  previousContent: string,
  hunks: Array<{ oldText: string; newText: string; occurrence?: number }>
): { ok: boolean; nextContent: string; summary: string } {
  let nextContent = previousContent;
  const rowSummaries: string[] = [];

  for (let index = 0; index < hunks.length; index += 1) {
    const hunk = hunks[index];
    const oldText = hunk.oldText ?? "";
    const newText = hunk.newText ?? "";
    if (typeof oldText !== "string" || typeof newText !== "string") {
      return {
        ok: false,
        nextContent,
        summary: `Hunk ${index + 1} is invalid`,
      };
    }
    if (oldText.length > PATCH_HUNK_MAX_CHARS || newText.length > PATCH_HUNK_MAX_CHARS) {
      return {
        ok: false,
        nextContent,
        summary: `Hunk ${index + 1} exceeds max size`,
      };
    }
    if (!oldText) {
      return {
        ok: false,
        nextContent,
        summary: `Hunk ${index + 1} missing oldText`,
      };
    }

    const positions: number[] = [];
    let start = 0;
    while (start <= nextContent.length) {
      const found = nextContent.indexOf(oldText, start);
      if (found < 0) break;
      positions.push(found);
      start = found + Math.max(1, oldText.length);
      if (positions.length > 12) break;
    }

    if (positions.length === 0) {
      return {
        ok: false,
        nextContent,
        summary: `Hunk ${index + 1} conflict: oldText not found`,
      };
    }

    const occurrence =
      typeof hunk.occurrence === "number" && Number.isFinite(hunk.occurrence)
        ? clampInteger(hunk.occurrence, 1, positions.length)
        : 1;

    if (positions.length > 1 && hunk.occurrence === undefined) {
      return {
        ok: false,
        nextContent,
        summary: `Hunk ${index + 1} ambiguous match (${positions.length} occurrences, provide occurrence)`,
      };
    }

    const position = positions[occurrence - 1];
    const before = nextContent.slice(0, position);
    const after = nextContent.slice(position + oldText.length);
    nextContent = `${before}${newText}${after}`;
    rowSummaries.push(
      `hunk ${index + 1}: occurrence=${occurrence}, old=${oldText.length} chars, new=${newText.length} chars`
    );
  }

  return {
    ok: true,
    nextContent,
    summary: rowSummaries.join(" | "),
  };
}

async function applyChange(
  change: CoderChange,
  context: MultiToolContext
): Promise<{
  ok: boolean;
  summary: string;
  output: string;
  action: AgentAction;
}> {
  const targetPath = change.path.trim();
  if (!targetPath) {
    return {
      ok: false,
      summary: "Change path is required",
      output: "Empty path",
      action: { type: "final", summary: "invalid change path" },
    };
  }

  if (context.fileWriteCount >= context.request.maxFileWrites) {
    return {
      ok: false,
      summary: "File write budget exceeded",
      output: `maxFileWrites=${context.request.maxFileWrites}`,
      action: { type: "final", summary: "file write budget exceeded" },
    };
  }

  const normalizedPath = safeRelativePath(targetPath);
  const safePathCheck = validateSafeWritePath(normalizedPath);
  if (!safePathCheck.ok) {
    return {
      ok: false,
      summary: "Write denied by safety policy",
      output: safePathCheck.reason || "Unsafe target path",
      action: { type: "final", summary: "unsafe write path denied" },
    };
  }

  const absolutePath = normalizePathForWorkspace(normalizedPath, context.workspace);
  const relativePath = toRelativeWorkspacePath(absolutePath, context.workspace);

  await ensureSnapshot(relativePath, context);

  if (change.op === "delete_file") {
    const action: AgentAction = {
      type: "delete_file",
      path: relativePath,
    };

    if (context.request.dryRun) {
      context.fileWriteCount += 1;
      journal(context, "delete", relativePath, "[dry-run] deletion skipped");
      return {
        ok: true,
        summary: `[dry-run] Would delete ${relativePath}`,
        output: "Deletion skipped in dry-run mode",
        action,
      };
    }

    try {
      await unlink(absolutePath);
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      if (error.code !== "ENOENT") {
        throw err;
      }
      return {
        ok: false,
        summary: `Delete failed: file not found (${relativePath})`,
        output: "File does not exist",
        action,
      };
    }

    context.fileWriteCount += 1;
    context.changedFiles.add(relativePath);
    journal(context, "delete", relativePath, change.rationale || "Deleted file");
    return {
      ok: true,
      summary: `Deleted ${relativePath}`,
      output: "File deleted",
      action,
    };
  }

  if (change.op === "patch_file") {
    const action: AgentAction = {
      type: "write_file",
      path: relativePath,
      content: "",
    };
    if (!Array.isArray(change.hunks) || change.hunks.length === 0) {
      return {
        ok: false,
        summary: "Patch operation requires non-empty hunks",
        output: "Missing patch hunks",
        action,
      };
    }

    let previous = "";
    try {
      previous = await readFile(absolutePath, "utf-8");
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      if (error.code !== "ENOENT") {
        throw err;
      }
      return {
        ok: false,
        summary: `Patch failed: file not found (${relativePath})`,
        output: "Patch requires existing file content for conflict-safe apply",
        action,
      };
    }

    const patched = applyPatchHunks(previous, change.hunks);
    if (!patched.ok) {
      return {
        ok: false,
        summary: `Patch conflict for ${relativePath}`,
        output: patched.summary,
        action,
      };
    }

    if (patched.nextContent.length > MAX_FILE_SIZE) {
      return {
        ok: false,
        summary: `Patched content too large for ${relativePath}`,
        output: `Max file size is ${MAX_FILE_SIZE} chars`,
        action,
      };
    }

    action.content = patched.nextContent;

    if (context.request.dryRun) {
      context.fileWriteCount += 1;
      journal(context, "write", relativePath, "[dry-run] patch skipped");
      return {
        ok: true,
        summary: `[dry-run] Would patch ${relativePath} (${change.hunks.length} hunks)`,
        output: patched.summary,
        action,
      };
    }

    await writeFile(absolutePath, patched.nextContent, "utf-8");
    context.fileWriteCount += 1;
    context.changedFiles.add(relativePath);
    journal(
      context,
      "write",
      relativePath,
      `Patched file (${change.hunks.length} hunks): ${change.rationale || "deterministic patch"}`
    );
    return {
      ok: true,
      summary: `Patched ${relativePath} (${change.hunks.length} hunks)`,
      output: patched.summary,
      action,
    };
  }

  if (typeof change.content !== "string") {
    return {
      ok: false,
      summary: "Change content is required for write/append operations",
      output: "Missing content",
      action: { type: "final", summary: "missing change content" },
    };
  }

  if (change.content.length > MAX_FILE_SIZE) {
    return {
      ok: false,
      summary: `Content too large for ${relativePath}`,
      output: `Max file size is ${MAX_FILE_SIZE} chars`,
      action: { type: "final", summary: "content too large" },
    };
  }

  if (change.op === "write_file") {
    const action: AgentAction = {
      type: "write_file",
      path: relativePath,
      content: change.content,
    };
    if (context.request.dryRun) {
      context.fileWriteCount += 1;
      journal(context, "write", relativePath, "[dry-run] write skipped");
      return {
        ok: true,
        summary: `[dry-run] Would write ${relativePath}`,
        output: `chars=${change.content.length}`,
        action,
      };
    }

    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, change.content, "utf-8");
    context.fileWriteCount += 1;
    context.changedFiles.add(relativePath);
    journal(context, "write", relativePath, change.rationale || "Wrote file");
    return {
      ok: true,
      summary: `Wrote ${change.content.length} chars to ${relativePath}`,
      output: change.rationale || "File written",
      action,
    };
  }

  const action: AgentAction = {
    type: "append_file",
    path: relativePath,
    content: change.content,
  };

  let previous = "";
  try {
    previous = await readFile(absolutePath, "utf-8");
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    if (error.code !== "ENOENT") {
      throw err;
    }
  }

  if (context.request.dryRun) {
    context.fileWriteCount += 1;
    journal(context, "append", relativePath, "[dry-run] append skipped");
    return {
      ok: true,
      summary: `[dry-run] Would append to ${relativePath}`,
      output: `chars=${change.content.length}`,
      action,
    };
  }

  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${previous}${change.content}`, "utf-8");
  context.fileWriteCount += 1;
  context.changedFiles.add(relativePath);
  journal(context, "append", relativePath, change.rationale || "Appended file");
  return {
    ok: true,
    summary: `Appended ${change.content.length} chars to ${relativePath}`,
    output: change.rationale || "File appended",
    action,
  };
}

async function rollbackChanges(context: MultiToolContext): Promise<{
  applied: boolean;
  summary: string[];
}> {
  if (context.request.dryRun) {
    return { applied: false, summary: ["Dry-run mode: rollback skipped."] };
  }

  if (context.snapshots.size === 0) {
    return { applied: false, summary: ["No file mutations recorded for rollback."] };
  }

  const rows: string[] = [];
  for (const snapshot of context.snapshots.values()) {
    try {
      if (!snapshot.existed) {
        await unlink(snapshot.absolutePath);
        rows.push(`Removed ${snapshot.relativePath} (created during run).`);
      } else {
        await mkdir(path.dirname(snapshot.absolutePath), { recursive: true });
        await writeFile(snapshot.absolutePath, snapshot.previousContent, "utf-8");
        rows.push(`Restored ${snapshot.relativePath}.`);
      }
    } catch (err) {
      rows.push(
        `Failed to rollback ${snapshot.relativePath}: ${toErrorMessage(err, "unknown error")}`
      );
    }
  }

  return { applied: true, summary: rows };
}

async function resolveVerificationCommands(
  request: AgentRunRequest,
  workspace: string
): Promise<AgentCommand[]> {
  return (await resolveDefaultVerificationCommands(
    workspace,
    request.verificationCommands
  )) as AgentCommand[];
}

function selectUnitVerificationCommands(commands: AgentCommand[]): AgentCommand[] {
  const selected: AgentCommand[] = [];

  for (const command of commands) {
    const asText = stringifyCommand(command).toLowerCase();
    if (/lint|typecheck|tsc/.test(asText)) {
      selected.push(command);
    }
  }

  if (selected.length === 0) {
    return commands.slice(0, UNIT_VERIFICATION_LIMIT);
  }

  return selected.slice(0, UNIT_VERIFICATION_LIMIT);
}

function isLikelyTestCommand(command: AgentCommand): boolean {
  const text = stringifyCommand(command).toLowerCase();
  return /\btest\b/.test(text) || /\bvitest\b/.test(text) || /\bjest\b/.test(text);
}

async function runVerificationSuite(
  iteration: number,
  attempt: number,
  commands: AgentCommand[],
  context: MultiToolContext,
  steps: AgentStep[],
  hooks: AgentRunHooks | undefined,
  options: VerificationOptions,
  signal?: AbortSignal,
  observability?: ObservabilityTracker
): Promise<VerificationRunResult> {
  const checks: VerificationCheckResult[] = [];
  const flakyRecoveredCommands: string[] = [];

  for (const command of commands) {
    throwIfAborted(signal);

    let result = await runCommand(command, context, signal, "verifier");
    if (
      !result.ok &&
      isLikelyTestCommand(command) &&
      options.flakyTestRetries > 0
    ) {
      let recovered = false;
      for (let retry = 1; retry <= options.flakyTestRetries; retry += 1) {
        const retried = await runCommand(command, context, signal, "verifier");
        if (retried.ok) {
          recovered = true;
          result = {
            ...retried,
            output: [
              `Flaky recovery: command passed on retry ${retry}/${options.flakyTestRetries}.`,
              retried.output,
            ]
              .filter(Boolean)
              .join("\n"),
            summary: `${retried.summary} (flaky recovered on retry ${retry})`,
          };
          if (options.allowFlakyQuarantine) {
            flakyRecoveredCommands.push(stringifyCommand(command));
          }
          break;
        }
        result = retried;
      }
      if (!recovered) {
        observability?.recordFailure(
          `verification:${options.mode}:test_failure:${command.program}`
        );
      }
    } else if (!result.ok) {
      observability?.recordFailure(
        `verification:${options.mode}:failure:${command.program}`
      );
    }

    const check: VerificationCheckResult = {
      attempt,
      command,
      ok: result.ok,
      output: result.output,
      durationMs: result.durationMs,
    };

    checks.push(check);
    const step = createStep({
      iteration,
      phase: "verification",
      role: "Verifier",
      summary: result.summary,
      output: result.output,
      ok: result.ok,
      durationMs: result.durationMs,
      action: {
        type: "run_command",
        program: command.program,
        args: command.args,
        cwd: command.cwd,
      },
    });
    steps.push(step);
    emit(hooks, { type: "step", data: { step } });
  }

  const passed = checks.every((check) => check.ok);
  emit(hooks, {
    type: "verification",
    data: {
      attempt,
      passed,
      checks,
    },
  });

  return { passed, checks, flakyRecoveredCommands };
}

async function readSnippet(
  workspace: string,
  relativePath: string,
  maxLines: number
): Promise<string | null> {
  try {
    const absolute = normalizePathForWorkspace(relativePath, workspace);
    const info = await stat(absolute);
    if (!info.isFile() || info.size > MAX_FILE_SIZE) return null;
    const raw = await readFile(absolute, "utf-8");
    const lines = raw.split("\n").slice(0, maxLines);
    return lines.join("\n");
  } catch {
    return null;
  }
}

function sanitizeUnitId(value: string, index: number): string {
  const base = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (base.length > 0) return base.slice(0, 40);
  return `unit_${index + 1}`;
}

function normalizeWorkUnits(rawUnits: unknown): WorkUnit[] {
  if (!Array.isArray(rawUnits)) {
    throw new Error("workUnits must be an array");
  }

  const normalized: WorkUnit[] = [];
  const idSet = new Set<string>();

  for (let index = 0; index < rawUnits.length; index += 1) {
    const item = rawUnits[index];
    if (!item || typeof item !== "object") {
      continue;
    }
    const typed = item as Record<string, unknown>;
    const id = sanitizeUnitId(String(typed.id || ""), index);
    if (idSet.has(id)) continue;
    idSet.add(id);

    const title = ensureString(String(typed.title || `Work Unit ${index + 1}`), "workUnit.title");
    const objective = ensureString(
      String(typed.objective || typed.title || ""),
      "workUnit.objective"
    );
    const dependsOnRaw = Array.isArray(typed.dependsOn) ? typed.dependsOn : [];
    const dependsOn = dependsOnRaw
      .filter((value): value is string => typeof value === "string")
      .map((value) => sanitizeUnitId(value, 0))
      .filter((value) => value && value !== id);
    const priorityRaw =
      typeof typed.priority === "number" && Number.isFinite(typed.priority)
        ? typed.priority
        : index + 1;
    const filesHint = Array.isArray(typed.filesHint)
      ? typed.filesHint
          .filter((value): value is string => typeof value === "string")
          .map((value) => value.trim())
          .filter(Boolean)
      : [];
    const verificationFocus = Array.isArray(typed.verificationFocus)
      ? typed.verificationFocus
          .filter((value): value is string => typeof value === "string")
          .map((value) => value.trim())
          .filter(Boolean)
      : [];

    normalized.push({
      id,
      title: truncate(title, 120),
      objective: truncate(objective, 320),
      dependsOn,
      priority: clampInteger(priorityRaw, 1, 100),
      filesHint: filesHint.slice(0, 12),
      verificationFocus: verificationFocus.slice(0, 10),
    });

    if (normalized.length >= MAX_WORK_UNITS) break;
  }

  if (normalized.length === 0) {
    throw new Error("No valid work units found");
  }

  const validIds = new Set(normalized.map((unit) => unit.id));
  for (const unit of normalized) {
    unit.dependsOn = unit.dependsOn.filter((id) => validIds.has(id));
  }

  return normalized.sort((a, b) => a.priority - b.priority);
}

function parsePlanningResult(value: unknown): UnitPlanningResult {
  if (!value || typeof value !== "object") {
    throw new Error("Planning output must be an object");
  }
  const typed = value as Record<string, unknown>;
  const strategy = ensureString(String(typed.strategy || "Parallel multi-agent execution"), "strategy");
  const workUnits = normalizeWorkUnits(typed.workUnits);
  const finalChecks = ensureOptionalStringArray(typed.finalChecks, "finalChecks");
  return {
    strategy,
    workUnits: workUnits.slice(0, DEFAULT_MAX_WORK_UNITS),
    finalChecks,
  };
}

function parseDependencyReplanResult(value: unknown): DependencyReplanResult {
  if (!value || typeof value !== "object") {
    throw new Error("Dependency replan output must be an object");
  }
  const typed = value as Record<string, unknown>;
  const strategyUpdate = ensureString(
    String(typed.strategyUpdate || "Dependency graph updated"),
    "strategyUpdate"
  );
  const dependenciesRaw = Array.isArray(typed.dependencies) ? typed.dependencies : [];
  const dependencies = dependenciesRaw
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const typedEntry = entry as Record<string, unknown>;
      if (typeof typedEntry.id !== "string") return null;
      const id = sanitizeUnitId(typedEntry.id, 0);
      const dependsOn = Array.isArray(typedEntry.dependsOn)
        ? typedEntry.dependsOn
            .filter((item): item is string => typeof item === "string")
            .map((item) => sanitizeUnitId(item, 0))
            .filter(Boolean)
        : [];
      return { id, dependsOn };
    })
    .filter((entry): entry is DependencyReplanResult["dependencies"][number] => entry !== null);
  if (dependencies.length === 0) {
    throw new Error("Dependency replan returned no dependency entries");
  }
  return {
    strategyUpdate,
    dependencies,
  };
}

function applyDependencyReplan(
  workUnitStates: Map<string, WorkUnitState>,
  replan: DependencyReplanResult
): { changed: boolean; cycle: string[] | null } {
  const before = Array.from(workUnitStates.values()).map((state) => ({
    id: state.unit.id,
    dependsOn: state.unit.dependsOn.slice(),
  }));
  const validIds = new Set(before.map((entry) => entry.id));
  const proposed = new Map<string, string[]>();
  for (const dependency of replan.dependencies) {
    if (!validIds.has(dependency.id)) continue;
    const filtered = dependency.dependsOn.filter(
      (id) => validIds.has(id) && id !== dependency.id
    );
    proposed.set(dependency.id, Array.from(new Set(filtered)));
  }

  for (const state of workUnitStates.values()) {
    if (proposed.has(state.unit.id)) {
      state.unit.dependsOn = proposed.get(state.unit.id) || [];
      if (state.status === "blocked" && state.lastError === "Dependency failed") {
        state.status = "pending";
        state.lastError = undefined;
      }
    }
  }

  const after = Array.from(workUnitStates.values()).map((state) => ({
    id: state.unit.id,
    dependsOn: state.unit.dependsOn.slice(),
  }));
  const cycle = detectDependencyCycle(
    Array.from(workUnitStates.values()).map((state) => state.unit)
  );
  return {
    changed: hasDependencyGraphChanged(before, after),
    cycle,
  };
}

function parseScoutResult(value: unknown): ScoutResult {
  if (!value || typeof value !== "object") {
    throw new Error("Scout output must be an object");
  }
  const typed = value as Record<string, unknown>;
  const summary = ensureString(String(typed.summary || "Scouting complete"), "summary");
  const relevantFilesRaw = Array.isArray(typed.relevantFiles) ? typed.relevantFiles : [];
  const relevantFiles = relevantFilesRaw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const typedItem = item as Record<string, unknown>;
      if (typeof typedItem.path !== "string") return null;
      const pathValue = typedItem.path.trim().replace(/\\/g, "/");
      if (!pathValue) return null;
      const reason = typeof typedItem.reason === "string" ? typedItem.reason.trim() : "";
      const relevanceRaw =
        typeof typedItem.relevance === "number" ? typedItem.relevance : 0.5;
      return {
        path: pathValue,
        reason: reason || "Potentially relevant",
        relevance: clampFloat(relevanceRaw, 0, 1),
      };
    })
    .filter((item): item is ScoutResult["relevantFiles"][number] => item !== null)
    .slice(0, 14);
  const risks = ensureOptionalStringArray(typed.risks, "risks");
  return { summary, relevantFiles, risks };
}

function parsePlannerResult(value: unknown): PlannerResult {
  if (!value || typeof value !== "object") {
    throw new Error("Planner output must be an object");
  }
  const typed = value as Record<string, unknown>;
  const summary = ensureString(String(typed.summary || "Planning complete"), "summary");
  const approach = ensureOptionalStringArray(typed.approach, "approach");
  const steps = ensureOptionalStringArray(typed.steps, "steps");
  const writeTargetsRaw = Array.isArray(typed.writeTargets) ? typed.writeTargets : [];
  const writeTargets = writeTargetsRaw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const typedItem = item as Record<string, unknown>;
      if (typeof typedItem.path !== "string") return null;
      const operation = String(typedItem.operation || "").toLowerCase();
      if (operation !== "write" && operation !== "append" && operation !== "delete") {
        return null;
      }
      const rationale =
        typeof typedItem.rationale === "string" && typedItem.rationale.trim().length > 0
          ? typedItem.rationale.trim()
          : "Planned file operation";
      return {
        path: typedItem.path.trim().replace(/\\/g, "/"),
        operation,
        rationale,
      } as PlannerResult["writeTargets"][number];
    })
    .filter((item): item is PlannerResult["writeTargets"][number] => item !== null)
    .slice(0, 20);
  const testFocus = ensureOptionalStringArray(typed.testFocus, "testFocus");
  return {
    summary,
    approach,
    steps,
    writeTargets,
    testFocus,
  };
}

function parseCoderResult(value: unknown): CoderResult {
  if (!value || typeof value !== "object") {
    throw new Error("Coder output must be an object");
  }
  const typed = value as Record<string, unknown>;
  const summary = ensureString(String(typed.summary || "Code changes prepared"), "summary");
  const changesRaw = Array.isArray(typed.changes) ? typed.changes : [];
  const changes = changesRaw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const typedItem = item as Record<string, unknown>;
      const op = String(typedItem.op || "");
      if (
        op !== "write_file" &&
        op !== "append_file" &&
        op !== "delete_file" &&
        op !== "patch_file"
      ) {
        return null;
      }
      if (typeof typedItem.path !== "string" || typedItem.path.trim().length === 0) {
        return null;
      }
      const change: CoderChange = {
        op,
        path: typedItem.path.trim().replace(/\\/g, "/"),
        rationale:
          typeof typedItem.rationale === "string" && typedItem.rationale.trim().length > 0
            ? typedItem.rationale.trim()
            : "Code change",
      };
      if (op === "patch_file") {
        if (!Array.isArray(typedItem.hunks) || typedItem.hunks.length === 0) {
          return null;
        }
        const parsedHunks = typedItem.hunks
          .map((hunk) => {
            if (!hunk || typeof hunk !== "object") return null;
            const typedHunk = hunk as Record<string, unknown>;
            if (typeof typedHunk.oldText !== "string") return null;
            if (typeof typedHunk.newText !== "string") return null;
            const occurrence =
              typeof typedHunk.occurrence === "number" && Number.isFinite(typedHunk.occurrence)
                ? clampInteger(typedHunk.occurrence, 1, 12)
                : undefined;
            const normalizedHunk: {
              oldText: string;
              newText: string;
              occurrence?: number;
            } = {
              oldText: typedHunk.oldText,
              newText: typedHunk.newText,
            };
            if (occurrence !== undefined) {
              normalizedHunk.occurrence = occurrence;
            }
            return normalizedHunk;
          })
          .filter((hunk): hunk is { oldText: string; newText: string; occurrence?: number } => hunk !== null);
        if (parsedHunks.length === 0) {
          return null;
        }
        change.hunks = parsedHunks;
      } else if (op !== "delete_file") {
        if (typeof typedItem.content !== "string") {
          return null;
        }
        change.content = typedItem.content;
      }
      return change;
    })
    .filter((item): item is CoderChange => item !== null)
    .slice(0, 24);

  const verificationNotes = ensureOptionalStringArray(
    typed.verificationNotes,
    "verificationNotes"
  );
  const remainingRisks = ensureOptionalStringArray(typed.remainingRisks, "remainingRisks");
  const confidenceRaw =
    typeof typed.confidence === "number" && Number.isFinite(typed.confidence)
      ? typed.confidence
      : 0.55;
  return {
    summary,
    changes,
    verificationNotes,
    remainingRisks,
    confidence: clampFloat(confidenceRaw, 0, 1),
  };
}

function parseCriticResult(value: unknown): CriticResult {
  if (!value || typeof value !== "object") {
    throw new Error("Critic output must be an object");
  }
  const typed = value as Record<string, unknown>;
  const summary = ensureString(String(typed.summary || "Critique complete"), "summary");
  const scoreRaw =
    typeof typed.score === "number" && Number.isFinite(typed.score) ? typed.score : 0.5;
  const score = clampFloat(scoreRaw, 0, 1);
  const blockingIssues = ensureOptionalStringArray(typed.blockingIssues, "blockingIssues");
  const nonBlockingIssues = ensureOptionalStringArray(
    typed.nonBlockingIssues,
    "nonBlockingIssues"
  );
  const recommendations = ensureOptionalStringArray(
    typed.recommendations,
    "recommendations"
  );
  return {
    summary,
    score,
    blockingIssues,
    nonBlockingIssues,
    recommendations,
  };
}

function parseSynthesizerResult(value: unknown): SynthesizerResult {
  if (!value || typeof value !== "object") {
    throw new Error("Synthesizer output must be an object");
  }
  const typed = value as Record<string, unknown>;
  const summary = ensureString(String(typed.summary || "Synthesis complete"), "summary");
  const verification = ensureOptionalStringArray(typed.verification, "verification");
  const remainingWork = ensureOptionalStringArray(typed.remainingWork, "remainingWork");
  return {
    summary,
    verification,
    remainingWork,
  };
}

function renderSkillContext(skills: SkillDocument[]): string {
  if (skills.length === 0) {
    return "(none)";
  }
  return skills
    .map((skill, index) => {
      const content = truncate(skill.content, 1800);
      return `### Skill ${index + 1}: ${skill.name}\nPath: ${skill.relativePath}\n${content}`;
    })
    .join("\n\n");
}

function shouldCacheRole(role: SubagentRole): boolean {
  return role === "scout" || role === "planner";
}

function buildSubagentCacheKey(params: {
  role: SubagentRole;
  model: string;
  system: string;
  prompt: string;
}): string {
  return hashText(
    [
      "subagent-cache-v1",
      params.role,
      params.model,
      params.system,
      params.prompt,
    ].join("\n\n")
  );
}

async function callSubagent<T>(params: {
  role: SubagentRole;
  routing: ModelRoutingConfig;
  modelConfig: Partial<ModelConfig> | undefined;
  signal?: AbortSignal;
  parser: (value: unknown) => T;
  system: string;
  prompt: string;
  tierOverride?: SubagentModelTier;
  cache?: SubagentArtifactCache;
  observability: ObservabilityTracker;
  escalated?: boolean;
}): Promise<SubagentCallResult<T>> {
  const selectedModel = modelForRole(params.role, params.routing, params.tierOverride);
  const cacheKey = buildSubagentCacheKey({
    role: params.role,
    model: selectedModel.model,
    system: params.system,
    prompt: params.prompt,
  });

  const inputTokensEstimate = estimateTokens(params.system) + estimateTokens(params.prompt);

  if (params.cache && shouldCacheRole(params.role)) {
    const cached = params.cache.get<T>(cacheKey, params.parser);
    if (cached) {
      const outputTokensEstimate = estimateTokens(cached.raw);
      params.observability.recordSubagentCall({
        role: params.role,
        tier: selectedModel.tier,
        cacheHit: true,
        retries: 0,
        escalated: Boolean(params.escalated),
        inputTokensEstimate,
        outputTokensEstimate,
        latencyMs: 0,
      });
      return {
        parsed: cached.parsed,
        raw: cached.raw,
        attempts: 1,
        inputTokensEstimate,
        outputTokensEstimate,
        modelUsed: selectedModel.model,
        tier: selectedModel.tier,
        cacheHit: true,
      };
    }
  }

  let lastError = "subagent parse failure";
  let correction = "";
  const startedAt = Date.now();
  let lastRaw = "";

  for (let attempt = 1; attempt <= MAX_SUBAGENT_ATTEMPTS; attempt += 1) {
    throwIfAborted(params.signal);
    const messages: ModelMessage[] = [
      {
        role: "system",
        content: params.system,
      },
      {
        role: "user",
        content: correction
          ? `${params.prompt}\n\nCorrection: ${correction}`
          : params.prompt,
      },
    ];

    const { content } = await completeModel(messages, {
      model: selectedModel.model,
      modelConfig: params.modelConfig,
      temperature: 0.1,
      maxTokens: 1600,
      signal: params.signal,
    });
    lastRaw = content;

    try {
      const payload = extractJsonObject(content);
      const parsed = params.parser(payload);
      if (params.cache && shouldCacheRole(params.role)) {
        params.cache.set(params.role, cacheKey, {
          raw: content,
          parsed,
        });
      }
      const outputTokensEstimate = estimateTokens(content);
      params.observability.recordSubagentCall({
        role: params.role,
        tier: selectedModel.tier,
        cacheHit: false,
        retries: attempt - 1,
        escalated: Boolean(params.escalated),
        inputTokensEstimate: inputTokensEstimate * attempt,
        outputTokensEstimate,
        latencyMs: Date.now() - startedAt,
      });
      return {
        parsed,
        raw: content,
        attempts: attempt,
        inputTokensEstimate: inputTokensEstimate * attempt,
        outputTokensEstimate,
        modelUsed: selectedModel.model,
        tier: selectedModel.tier,
        cacheHit: false,
      };
    } catch (err) {
      lastError = toErrorMessage(err, "invalid subagent output");
      correction =
        "Return exactly one valid JSON object that matches the required schema. No markdown.";
      continue;
    }
  }

  params.observability.recordFailure(
    `${params.role}:${categorizeFailure(lastError || "subagent failure")}`
  );
  throw new Error(`${params.role} failed after retries: ${lastError}. lastRaw=${truncate(lastRaw, 300)}`);
}

function buildClarificationQuestions(digest: ProjectDigest): ClarificationQuestion[] {
  const dirs = digest.keyDirectories.slice(0, 5).join(", ") || "(none detected)";
  const scopes = digest.keyDirectories.slice(0, 5).map((entry) => ({
    id: entry.replace(/[^a-zA-Z0-9_-]/g, "_"),
    label: entry,
    value: entry,
    description: `Focus edits under ${entry}`,
  })) as ClarificationOption[];

  return [
    {
      id: "goal_execution_mode",
      question:
        "Before edits start, choose execution mode for this run (targeted patch, feature complete, or broad refactor).",
      rationale: "Matches implementation depth to expected outcome and runtime.",
      required: true,
      allowCustomAnswer: true,
      options: [
        {
          id: "targeted_patch",
          label: "Targeted patch",
          value: "Targeted patch",
          description: "Minimal focused edits.",
          recommended: true,
        },
        {
          id: "feature_complete",
          label: "Feature complete",
          value: "Feature complete",
          description: "Balanced implementation with supporting refactors/tests.",
        },
        {
          id: "broad_refactor",
          label: "Broad refactor",
          value: "Broad refactor",
          description: "Allows larger architecture-level changes.",
        },
      ],
    },
    {
      id: "primary_scope",
      question: `Detected top directories: ${dirs}. Which should be primary edit scope?`,
      rationale: "Avoids touching unrelated areas.",
      required: true,
      allowCustomAnswer: true,
      options: scopes.length > 0 ? scopes : undefined,
    },
    {
      id: "testing_expectations",
      question:
        "Which verification depth is required for acceptance (quick checks, standard lint/typecheck/test/build, or exhaustive)?",
      rationale: "Calibrates runtime and quality gates.",
      required: true,
      allowCustomAnswer: true,
      options: [
        {
          id: "quick",
          label: "Quick",
          value: "Quick checks",
          description: "Fastest verification.",
        },
        {
          id: "standard",
          label: "Standard",
          value: "Standard verification",
          description: "Lint + typecheck + tests + build when available.",
          recommended: true,
        },
        {
          id: "exhaustive",
          label: "Exhaustive",
          value: "Exhaustive verification",
          description: "All checks plus deeper targeted tests.",
        },
      ],
    },
  ];
}

function hasMissingRequiredClarification(
  questions: ClarificationQuestion[],
  answers: Record<string, string>
): boolean {
  for (const question of questions) {
    if (!question.required) continue;
    const answer = answers[question.id];
    if (!answer || !answer.trim()) return true;
  }
  return false;
}

function computeZeroKnownIssues(params: {
  status: AgentRunStatus;
  preflightPassed: boolean | null;
  preflightChecks: VerificationCheckResult[];
  verificationPassed: boolean | null;
  remainingWork: string[];
  projectIntelligence: ProjectIntelligence;
}): boolean {
  const hasHighRiskSignals = params.projectIntelligence.signals.some(
    (signal) => signal.severity === "high" && signal.count > 0
  );
  return (
    params.status === "completed" &&
    (params.preflightPassed === null ||
      params.preflightPassed ||
      params.preflightChecks.length === 0) &&
    (params.verificationPassed === null || params.verificationPassed) &&
    params.remainingWork.length === 0 &&
    !hasHighRiskSignals
  );
}

function formatMemoryDiagnosticsForPrompt(
  diagnostics: MemoryRetrievalDiagnostics | undefined
): string {
  if (!diagnostics) return "(none)";
  if (diagnostics.conflictCount === 0) {
    return "No contradictory memory pairs detected.";
  }
  return [
    `Conflict count: ${diagnostics.conflictCount}`,
    ...diagnostics.conflicts.slice(0, 6).map((conflict, index) => {
      return `${index + 1}. ${conflict.reason} topic=${conflict.topicTokens.join(",") || "(unspecified)"} ids=${conflict.firstEntryId} vs ${conflict.secondEntryId}`;
    }),
    ...diagnostics.guidance.map((line) => `- ${line}`),
  ].join("\n");
}

function hasUnitEvidenceForMutation(params: {
  scout: ScoutResult;
  planner: PlannerResult;
  snippetsCount: number;
}): boolean {
  if (params.snippetsCount > 0) return true;
  if (params.scout.relevantFiles.length > 0) return true;
  if (params.planner.testFocus.length > 0) return true;
  return false;
}

function goalLikelyRequiresCodeMutation(goal: string): boolean {
  return /(?:create|write|implement|build|fix|refactor|add|generate|code|project|file|backend|frontend)/i.test(
    goal
  );
}

function dedupeLines(lines: string[]): string[] {
  return Array.from(new Set(lines.filter((line) => line.trim().length > 0)));
}

function buildContinuationSummaryFromUnits(unitStates: WorkUnitState[]): {
  pendingWork: string[];
  nextActions: string[];
  summary: string;
} {
  const unresolved = unitStates.filter(
    (state) => state.status !== "completed"
  );
  const pendingWork = unresolved.map((state) => {
    const reason = state.lastError ? ` (${state.lastError})` : "";
    return `${state.unit.id}: ${state.unit.title}${reason}`;
  });
  const nextActions: string[] = [];
  for (const state of unresolved) {
    if (state.status === "blocked") {
      nextActions.push(`Repair dependency path for ${state.unit.id}.`);
      continue;
    }
    if (state.status === "failed") {
      nextActions.push(`Fix root cause and retry ${state.unit.id}.`);
      continue;
    }
    if (state.status === "pending") {
      nextActions.push(`Execute pending unit ${state.unit.id}.`);
      continue;
    }
    nextActions.push(`Resume in-progress unit ${state.unit.id}.`);
  }
  const summary =
    unresolved.length === 0
      ? "All work units completed."
      : `Unresolved units: ${unresolved.length}.`;
  return {
    pendingWork: pendingWork.slice(0, 24),
    nextActions: nextActions.slice(0, 24),
    summary,
  };
}

function buildLongTermMemoryCandidates(params: {
  workspace: string;
  goal: string;
  runId: string;
  status: AgentRunStatus;
  dryRun: boolean;
  verificationPassed: boolean | null;
  verificationCommands: AgentCommand[];
  unitStates: WorkUnitState[];
  synthesisSummary: string;
  flakyQuarantinedCommands: string[];
  clarificationAnswers: Record<string, string>;
}): Array<{
  type: "bug_pattern" | "fix_pattern" | "verification_rule" | "project_convention";
  title: string;
  content: string;
  tags: string[];
  pinned?: boolean;
  successScore?: number;
  confidenceScore?: number;
  evidence?: Array<{
    type:
      | "command_output"
      | "file_excerpt"
      | "verification_result"
      | "human_feedback"
      | "run_summary"
      | "external_source";
    source: string;
    summary: string;
    createdAt: string;
  }>;
  lastValidatedAt?: string;
  sourceRunId: string;
  sourceGoal: string;
}> {
  const entries: Array<{
    type: "bug_pattern" | "fix_pattern" | "verification_rule" | "project_convention";
    title: string;
    content: string;
    tags: string[];
    pinned?: boolean;
    successScore?: number;
    confidenceScore?: number;
    evidence?: Array<{
      type:
        | "command_output"
        | "file_excerpt"
        | "verification_result"
        | "human_feedback"
        | "run_summary"
        | "external_source";
      source: string;
      summary: string;
      createdAt: string;
    }>;
    lastValidatedAt?: string;
    sourceRunId: string;
    sourceGoal: string;
  }> = [];
  const runTags = params.dryRun ? ["dry_run"] : [];

  for (const state of params.unitStates) {
    if (state.status === "completed") {
      entries.push({
        type: "fix_pattern",
        title: `Fix pattern: ${state.unit.title}`,
        content: [
          `Unit: ${state.unit.id}`,
          `Summary: ${state.summary || "(no summary)"}`,
          `Files: ${state.filesTouched.join(", ") || "(none)"}`,
          `Critic score: ${typeof state.criticScore === "number" ? state.criticScore.toFixed(2) : "n/a"}`,
          `Verification passed: ${String(state.verificationPassed)}`,
        ].join("\n"),
        tags: ["unit_fix", state.unit.id, ...state.filesTouched.slice(0, 4), ...runTags],
        successScore: 0.84,
        confidenceScore: 0.82,
        evidence: [
          {
            type: "run_summary",
            source: `unit:${state.unit.id}`,
            summary: "Completed work unit with critic-approved result.",
            createdAt: new Date().toISOString(),
          },
        ],
        lastValidatedAt: new Date().toISOString(),
        sourceRunId: params.runId,
        sourceGoal: params.goal,
      });
    } else if (state.lastError && !params.dryRun) {
      entries.push({
        type: "bug_pattern",
        title: `Failure pattern: ${state.unit.title}`,
        content: [
          `Unit: ${state.unit.id}`,
          `Status: ${state.status}`,
          `Error: ${state.lastError}`,
          `Attempts: ${state.attempts}`,
          `Files: ${state.filesTouched.join(", ") || "(none)"}`,
        ].join("\n"),
        tags: ["unit_failure", state.unit.id, state.status, ...runTags],
        successScore: 0.22,
        confidenceScore: 0.44,
        evidence: [
          {
            type: "run_summary",
            source: `unit:${state.unit.id}`,
            summary: "Unit failure extracted from orchestrator state.",
            createdAt: new Date().toISOString(),
          },
        ],
        sourceRunId: params.runId,
        sourceGoal: params.goal,
      });
    }
  }

  if (params.verificationCommands.length > 0) {
    entries.push({
      type: "verification_rule",
      title: "Verification baseline",
      content: [
        `Commands: ${params.verificationCommands.map((command) => stringifyCommand(command)).join(" | ")}`,
        `Verification passed: ${String(params.verificationPassed)}`,
        `Flaky quarantined: ${params.flakyQuarantinedCommands.join(", ") || "(none)"}`,
      ].join("\n"),
      tags: [
        "verification",
        params.workspace.includes("ChatBot") ? "chatbot" : "workspace",
        ...runTags,
      ],
      pinned: Boolean(params.verificationPassed),
      successScore: params.verificationPassed === false ? 0.38 : 0.78,
      confidenceScore: params.verificationPassed === false ? 0.48 : 0.82,
      evidence: [
        {
          type: "verification_result",
          source: `run:${params.runId}`,
          summary: `Verification commands tracked: ${params.verificationCommands.length}`,
          createdAt: new Date().toISOString(),
        },
      ],
      lastValidatedAt: new Date().toISOString(),
      sourceRunId: params.runId,
      sourceGoal: params.goal,
    });
  }

  if (Object.keys(params.clarificationAnswers).length > 0) {
    entries.push({
      type: "project_convention",
      title: "Run clarification conventions",
      content: Object.entries(params.clarificationAnswers)
        .map(([key, value]) => `${key}: ${value}`)
        .join("\n"),
      tags: ["clarification", "convention", ...runTags],
      successScore: 0.7,
      confidenceScore: 0.74,
      evidence: [
        {
          type: "human_feedback",
          source: `run:${params.runId}`,
          summary: "User clarification answers captured for this run.",
          createdAt: new Date().toISOString(),
        },
      ],
      sourceRunId: params.runId,
      sourceGoal: params.goal,
    });
  }

  entries.push({
    type: "project_convention",
    title: `Run summary (${params.status})`,
    content: params.synthesisSummary,
    tags: ["run_summary", params.status, ...runTags],
    successScore: params.status === "completed" ? 0.82 : 0.45,
    confidenceScore: params.status === "completed" ? 0.8 : 0.5,
    evidence: [
      {
        type: "run_summary",
        source: `run:${params.runId}`,
        summary: "Final multi-agent synthesis summary.",
        createdAt: new Date().toISOString(),
      },
    ],
    lastValidatedAt: new Date().toISOString(),
    sourceRunId: params.runId,
    sourceGoal: params.goal,
  });

  return entries.slice(0, 40);
}

function buildCompletionResult(params: {
  status: AgentRunStatus;
  runId: string;
  resumedFromRunId?: string;
  goal: string;
  startedAt: string;
  model: string;
  maxIterations: number;
  summary: string;
  verification: string[];
  remainingWork: string[];
  context: MultiToolContext;
  strictVerification: boolean;
  autoFixVerification: boolean;
  dryRun: boolean;
  rollbackOnFailure: boolean;
  verificationAttempts: number;
  verificationPassed: boolean | null;
  verificationCommands: AgentCommand[];
  verificationChecks: VerificationCheckResult[];
  rollbackApplied: boolean;
  rollbackSummary: string[];
  teamSize: number;
  teamRoster: string[];
  runPreflightChecks: boolean;
  preflightPassed: boolean | null;
  preflightChecks: VerificationCheckResult[];
  clarificationRequired: boolean;
  clarificationQuestions: ClarificationQuestion[];
  clarificationAnswersUsed: Record<string, string>;
  projectDigest: ProjectDigest;
  projectIntelligence: ProjectIntelligence;
  steps: AgentStep[];
  error?: string;
  multiAgent: MultiAgentRunSummary;
}): AgentRunResult {
  const highestIteration = params.steps.reduce(
    (max, step) => Math.max(max, step.iteration),
    0
  );
  const iterationsUsed = Math.min(params.maxIterations, highestIteration);
  return {
    status: params.status,
    runId: params.runId,
    resumedFromRunId: params.resumedFromRunId,
    goal: params.goal,
    startedAt: params.startedAt,
    finishedAt: new Date().toISOString(),
    model: params.model,
    maxIterations: params.maxIterations,
    iterationsUsed,
    summary: params.summary,
    verification: params.verification,
    remainingWork: params.remainingWork,
    filesChanged: Array.from(params.context.changedFiles),
    commandsRun: params.context.commandsRun,
    fileWriteCount: params.context.fileWriteCount,
    commandRunCount: params.context.commandRunCount,
    strictVerification: params.strictVerification,
    autoFixVerification: params.autoFixVerification,
    dryRun: params.dryRun,
    rollbackOnFailure: params.rollbackOnFailure,
    verificationAttempts: params.verificationAttempts,
    verificationPassed: params.verificationPassed,
    verificationCommands: params.verificationCommands,
    verificationChecks: params.verificationChecks,
    rollbackApplied: params.rollbackApplied,
    rollbackSummary: params.rollbackSummary,
    changeJournal: params.context.changeJournal,
    teamSize: params.teamSize,
    teamRoster: params.teamRoster,
    runPreflightChecks: params.runPreflightChecks,
    preflightPassed: params.preflightPassed,
    preflightChecks: params.preflightChecks,
    clarificationRequired: params.clarificationRequired,
    clarificationQuestions: params.clarificationQuestions,
    clarificationAnswersUsed: params.clarificationAnswersUsed,
    projectDigest: params.projectDigest,
    projectIntelligence: params.projectIntelligence,
    zeroKnownIssues: computeZeroKnownIssues({
      status: params.status,
      preflightPassed: params.preflightPassed,
      preflightChecks: params.preflightChecks,
      verificationPassed: params.verificationPassed,
      remainingWork: params.remainingWork,
      projectIntelligence: params.projectIntelligence,
    }),
    steps: params.steps,
    error: params.error,
    executionMode: "multi",
    multiAgentReport: params.multiAgent,
  };
}

export async function runMultiAgentAutonomous(
  request: AgentRunRequest,
  hooks?: AgentRunHooks
): Promise<AgentRunResult> {
  const runStartedAtMs = Date.now();
  const startedAt = new Date().toISOString();
  const workspace = await resolveWorkspacePath(request.workspacePath);
  const config = resolveModelConfig(request.modelConfig);
  const modelName = request.modelOverride || config.model;
  const modelRouting = resolveRoleModelRouting(request, modelName);
  const runId = randomUUID();
  const teamRoster = buildTeamRoster(request.teamSize);
  const observability = new ObservabilityTracker();
  const artifactCache = new SubagentArtifactCache(workspace);
  await artifactCache.load();

  const [projectDigest, projectIntelligenceRaw] = await Promise.all([
    buildProjectDigest(workspace),
    collectProjectIntelligence(workspace).catch(() =>
      createEmptyProjectIntelligence(workspace)
    ),
  ]);
  const projectIntelligence =
    projectIntelligenceRaw || createEmptyProjectIntelligence(workspace);
  const languageGuidance = buildLanguageGuidanceBlock(
    projectDigest.languageHints,
    projectIntelligence.stack
  );

  const clarificationQuestions = request.requireClarificationBeforeEdits
    ? buildClarificationQuestions(projectDigest)
    : [];

  emit(hooks, {
    type: "started",
    data: {
      goal: request.goal,
      maxIterations: request.maxIterations,
      model: modelName,
      strictVerification: request.strictVerification,
      autoFixVerification: request.autoFixVerification,
      dryRun: request.dryRun,
      rollbackOnFailure: request.rollbackOnFailure,
      teamSize: request.teamSize,
      runPreflightChecks: request.runPreflightChecks,
      requireClarificationBeforeEdits: request.requireClarificationBeforeEdits,
      executionMode: "multi",
    },
  });

  if (
    request.requireClarificationBeforeEdits &&
    hasMissingRequiredClarification(clarificationQuestions, request.clarificationAnswers)
  ) {
    const noopContext: MultiToolContext = {
      workspace,
      request,
      changedFiles: new Set<string>(),
      commandsRun: [],
      fileWriteCount: 0,
      commandRunCount: 0,
      snapshots: new Map<string, FileSnapshot>(),
      changeJournal: [],
    };

    const clarificationResult = buildCompletionResult({
      status: "needs_clarification",
      runId,
      goal: request.goal,
      startedAt,
      model: modelName,
      maxIterations: request.maxIterations,
      summary:
        "Clarification is required before edits in multi-agent mode. Provide answers and rerun.",
      verification: ["Answer all required clarification questions."],
      remainingWork: [
        "Answer required clarification prompts.",
        "Rerun autonomous task after clarification.",
      ],
      context: noopContext,
      strictVerification: request.strictVerification,
      autoFixVerification: request.autoFixVerification,
      dryRun: request.dryRun,
      rollbackOnFailure: request.rollbackOnFailure,
      verificationAttempts: 0,
      verificationPassed: null,
      verificationCommands: [],
      verificationChecks: [],
      rollbackApplied: false,
      rollbackSummary: ["No rollback needed (no edits were applied)."],
      teamSize: request.teamSize,
      teamRoster,
      runPreflightChecks: request.runPreflightChecks,
      preflightPassed: null,
      preflightChecks: [],
      clarificationRequired: true,
      clarificationQuestions,
      clarificationAnswersUsed: request.clarificationAnswers,
      projectDigest,
      projectIntelligence,
      steps: [],
      multiAgent: {
        strategy: "Clarification gate",
        finalChecks: [],
        workUnits: [],
        artifacts: [],
        flakyQuarantinedCommands: [],
        observability: {
          totalDurationMs: Date.now() - runStartedAtMs,
          modelUsage: [],
          unitMetrics: [],
          failureHeatmap: [],
        },
      },
    });
    await artifactCache.persist();
    return clarificationResult;
  }

  const verificationCommands = await resolveVerificationCommands(request, workspace);
  const context: MultiToolContext = {
    workspace,
    request,
    changedFiles: new Set<string>(),
    commandsRun: [],
    fileWriteCount: 0,
    commandRunCount: 0,
    snapshots: new Map<string, FileSnapshot>(),
    changeJournal: [],
  };

  const steps: AgentStep[] = [];
  const verificationChecks: VerificationCheckResult[] = [];
  const preflightChecks: VerificationCheckResult[] = [];
  let preflightPassed: boolean | null = null;
  let verificationPassed: boolean | null = null;
  let verificationAttempts = 0;
  const flakyQuarantinedCommands = new Set<string>();

  const skillDocuments =
    request.skillFiles.length > 0
      ? await loadSkillDocuments(workspace, request.skillFiles, 8).catch(() => [])
      : [];
  const skillContext = renderSkillContext(skillDocuments);
  const longMemory = await retrieveMemoryContext({
    workspace,
    query: request.goal,
    limit: 12,
    maxChars: 5200,
    includePinned: true,
    types: [
      "bug_pattern",
      "fix_pattern",
      "verification_rule",
      "project_convention",
      "continuation",
    ],
  });
  const longMemoryBlock = longMemory.contextBlock;
  const longMemoryDiagnostics = formatMemoryDiagnosticsForPrompt(longMemory.diagnostics);
  const requiresRunWideMemoryEvidenceGate =
    longMemory.diagnostics.requiresVerificationBeforeMutation;
  const continuationHint = longMemory.latestContinuation
    ? [
        `Latest continuation packet (run ${longMemory.latestContinuation.runId}, ${longMemory.latestContinuation.executionMode}):`,
        `Summary: ${longMemory.latestContinuation.summary}`,
        `Pending: ${longMemory.latestContinuation.pendingWork.join("; ") || "(none)"}`,
        `Next: ${longMemory.latestContinuation.nextActions.join("; ") || "(none)"}`,
      ].join("\n")
    : "(none)";

  if (requiresRunWideMemoryEvidenceGate) {
    emit(hooks, {
      type: "status",
      data: {
        message:
          "Memory conflicts detected for goal; units must gather evidence before applying mutations.",
      },
    });
  }

  emit(hooks, {
    type: "status",
    data: {
      message: "Multi-agent orchestrator: planning work units.",
    },
  });

  const planningStart = Date.now();
  let planning: UnitPlanningResult;
  try {
    const planningResult = await callSubagent<UnitPlanningResult>({
      role: "supervisor",
      routing: modelRouting,
      modelConfig: request.modelConfig,
      signal: hooks?.signal,
      parser: parsePlanningResult,
      cache: artifactCache,
      observability,
      system:
        "You are a supervisor agent. Decompose coding goals into an async DAG of lightweight work units. Return JSON only.",
      prompt: [
        "Return JSON shape:",
        "{",
        '  "strategy": "string",',
        '  "workUnits": [',
        "    {",
        '      "id": "string",',
        '      "title": "string",',
        '      "objective": "string",',
        '      "dependsOn": ["unit_id"],',
        '      "priority": 1,',
        '      "filesHint": ["path"],',
        '      "verificationFocus": ["string"]',
        "    }",
        "  ],",
        '  "finalChecks": ["string"]',
        "}",
        "",
        `Goal:\n${request.goal}`,
        "",
        `Workspace: ${workspace}`,
        `Project language hints: ${projectDigest.languageHints.join(", ") || "(unknown)"}`,
        `Top directories: ${projectDigest.keyDirectories.join(", ") || "(none)"}`,
        `Scripts: ${projectDigest.packageScripts.join(", ") || "(none)"}`,
        `Project intelligence summary: ${projectIntelligence.summary}`,
        "",
        "Language-specific guidance:",
        languageGuidance,
        "",
        "Clarification answers:",
        JSON.stringify(request.clarificationAnswers, null, 2),
        "",
        "Active skills:",
        skillContext,
        "",
        "Retrieved long-term memory:",
        longMemoryBlock,
        "",
        "Memory diagnostics:",
        longMemoryDiagnostics,
        "",
        "Continuation hint:",
        continuationHint,
        "",
        `Hard limits: max work units ${DEFAULT_MAX_WORK_UNITS}.`,
      ].join("\n"),
    });
    planning = planningResult.parsed;
    const step = createStep({
      iteration: 1,
      phase: "action",
      role: "Supervisor",
      summary: "Planned multi-agent work graph",
      output: truncate(
        `model=${planningResult.modelUsed}, attempts=${planningResult.attempts}, cache=${String(planningResult.cacheHit)}\n${planningResult.raw}`,
        RESPONSE_OUTPUT_LIMIT
      ),
      ok: true,
      durationMs: Date.now() - planningStart,
    });
    steps.push(step);
    emit(hooks, { type: "step", data: { step } });
  } catch (err) {
    planning = {
      strategy: "Fallback single-unit strategy",
      finalChecks: [],
      workUnits: [
        {
          id: "unit_1",
          title: "Complete requested goal",
          objective: request.goal,
          dependsOn: [],
          priority: 1,
          filesHint: [],
          verificationFocus: [],
        },
      ],
    };
    const step = createStep({
      iteration: 1,
      phase: "action",
      role: "Supervisor",
      summary: "Planner fallback activated",
      output: toErrorMessage(err, "Failed to parse planning output"),
      ok: false,
      durationMs: Date.now() - planningStart,
    });
    steps.push(step);
    emit(hooks, { type: "step", data: { step } });
  }

  const workUnits = planning.workUnits.slice(0, DEFAULT_MAX_WORK_UNITS);
  const workUnitStates = new Map<string, WorkUnitState>();
  for (const unit of workUnits) {
    workUnitStates.set(unit.id, {
      unit,
      status: "pending",
      attempts: 0,
      verificationPassed: null,
      filesTouched: [],
      blockingIssues: [],
    });
  }

  let dependencyReplanAttempts = 0;

  async function persistContinuationSnapshot(reason: string): Promise<void> {
    const stateSnapshot = Array.from(workUnitStates.values());
    const continuationSummary = buildContinuationSummaryFromUnits(stateSnapshot);
    const packet: ContinuationPacket = {
      runId,
      executionMode: "multi",
      goal: request.goal,
      summary: `${reason}. ${continuationSummary.summary}`,
      pendingWork: continuationSummary.pendingWork,
      nextActions: continuationSummary.nextActions,
      createdAt: new Date().toISOString(),
    };
    await saveContinuationPacket(workspace, packet).catch(() => undefined);
  }

  async function runDependencyReplan(reason: string): Promise<boolean> {
    if (dependencyReplanAttempts >= MAX_DEPENDENCY_REPLAN_ATTEMPTS) {
      return false;
    }
    dependencyReplanAttempts += 1;

    const statesSnapshot = Array.from(workUnitStates.values()).map((state) => ({
      id: state.unit.id,
      title: state.unit.title,
      status: state.status,
      dependsOn: state.unit.dependsOn,
      attempts: state.attempts,
      error: state.lastError,
    }));

    try {
      const replan = await callSubagent<DependencyReplanResult>({
        role: "supervisor",
        routing: modelRouting,
        modelConfig: request.modelConfig,
        signal: hooks?.signal,
        parser: parseDependencyReplanResult,
        cache: artifactCache,
        observability,
        tierOverride: "heavy",
        escalated: true,
        system:
          "You are the dependency orchestrator. Repair dependency graph deadlocks/cycles while preserving correctness. Return JSON only.",
        prompt: [
          "Return JSON shape:",
          "{",
          '  "strategyUpdate": "string",',
          '  "dependencies": [{"id":"string","dependsOn":["unit_id"]}]',
          "}",
          "",
          `Reason: ${reason}`,
          `Goal: ${request.goal}`,
          "",
          "Unit states:",
          JSON.stringify(statesSnapshot, null, 2),
        ].join("\n"),
      });

      const applied = applyDependencyReplan(workUnitStates, replan.parsed);
      const summary = applied.changed
        ? `Dependency graph replanned: ${replan.parsed.strategyUpdate}`
        : "Dependency replan produced no graph changes";
      const step = createStep({
        iteration: 1,
        phase: "action",
        role: "Orchestrator",
        summary,
        output: truncate(replan.raw, RESPONSE_OUTPUT_LIMIT),
        ok: applied.changed && !applied.cycle,
        durationMs: 0,
      });
      steps.push(step);
      emit(hooks, { type: "step", data: { step } });

      if (applied.cycle) {
        observability.recordFailure("dependency:cycle_after_replan");
        return false;
      }

      return applied.changed;
    } catch (err) {
      observability.recordFailure(categorizeFailure(toErrorMessage(err, "dependency replan failed")));
      const step = createStep({
        iteration: 1,
        phase: "action",
        role: "Orchestrator",
        summary: "Dependency replan failed",
        output: toErrorMessage(err, "dependency replan failed"),
        ok: false,
        durationMs: 0,
      });
      steps.push(step);
      emit(hooks, { type: "step", data: { step } });
      return false;
    }
  }

  const initialCycle = detectDependencyCycle(workUnits);
  if (initialCycle) {
    const repaired = await runDependencyReplan(
      `Initial cycle detected: ${initialCycle.join(" -> ")}`
    );
    if (!repaired) {
      for (const state of workUnitStates.values()) {
        state.status = "blocked";
        state.lastError = `Dependency cycle detected: ${initialCycle.join(" -> ")}`;
      }
    }
  }
  await persistContinuationSnapshot("Planning complete");

  if (request.runPreflightChecks && verificationCommands.length > 0) {
    emit(hooks, {
      type: "status",
      data: {
        message: "Multi-agent preflight: running baseline quality checks.",
      },
    });
    verificationAttempts += 1;
    const preflight = await runVerificationSuite(
      1,
      verificationAttempts,
      selectUnitVerificationCommands(verificationCommands),
      context,
      steps,
      hooks,
      {
        mode: "preflight",
        flakyTestRetries: 0,
        allowFlakyQuarantine: false,
      },
      hooks?.signal,
      observability
    );
    preflightChecks.push(...preflight.checks);
    preflightPassed = preflight.passed;
  }

  const writeQueue = new SerializedWriteQueue();
  const artifactStore = new ArtifactStore();
  let iterationCounter = 1;
  const unitVerificationCommands = request.strictVerification
    ? selectUnitVerificationCommands(verificationCommands)
    : [];
  const maxParallel = clampInteger(request.maxParallelWorkUnits, 1, 8);
  const failedUnits = new Set<string>();
  let reachedIterationLimit = false;

  async function executeUnit(state: WorkUnitState): Promise<void> {
    const { unit } = state;
    state.startedAtMs = state.startedAtMs || Date.now();
    state.status = "running";
    state.attempts += 1;
    emit(hooks, {
      type: "status",
      data: {
        message: `Unit ${unit.id}: ${unit.title} (attempt ${state.attempts})`,
      },
    });
    throwIfAborted(hooks?.signal);

    const unitContext = artifactStore.getUnitContext(unit.id);
    const unitMemory = await retrieveMemoryContext({
      workspace,
      query: `${request.goal}\n${unit.title}\n${unit.objective}`,
      limit: 6,
      maxChars: 2800,
      includePinned: true,
      types: [
        "bug_pattern",
        "fix_pattern",
        "verification_rule",
        "project_convention",
      ],
    });
    const unitMemoryDiagnostics = formatMemoryDiagnosticsForPrompt(
      unitMemory.diagnostics
    );
    const requiresUnitEvidenceGate =
      requiresRunWideMemoryEvidenceGate ||
      unitMemory.diagnostics.requiresVerificationBeforeMutation;
    const scoutPrompt = [
      "Return JSON shape:",
      "{",
      '  "summary": "string",',
      '  "relevantFiles": [{"path":"string","reason":"string","relevance":0.0}],',
      '  "risks": ["string"]',
      "}",
      "",
      `Goal: ${request.goal}`,
      `Work unit: ${unit.title}`,
      `Objective: ${unit.objective}`,
      `Files hint: ${unit.filesHint.join(", ") || "(none)"}`,
      `Dependencies: ${unit.dependsOn.join(", ") || "(none)"}`,
      `Workspace tree preview:\n${truncate(projectDigest.treePreview, 2800)}`,
      "",
      "Relevant long-term memory:",
      unitMemory.contextBlock,
      "",
      "Memory diagnostics:",
      unitMemoryDiagnostics,
      "",
      "Prior unit artifacts:",
      unitContext,
    ].join("\n");

    const plannerPrompt = [
      "Return JSON shape:",
      "{",
      '  "summary": "string",',
      '  "approach": ["string"],',
      '  "steps": ["string"],',
      '  "writeTargets": [{"path":"string","operation":"write|append|delete","rationale":"string"}],',
      '  "testFocus": ["string"]',
      "}",
      "",
      `Goal: ${request.goal}`,
      `Work unit: ${unit.title}`,
      `Objective: ${unit.objective}`,
      `Verification focus: ${unit.verificationFocus.join(", ") || "(none)"}`,
      `Clarification answers: ${JSON.stringify(request.clarificationAnswers)}`,
      "",
      "Relevant long-term memory:",
      unitMemory.contextBlock,
      "",
      "Memory diagnostics:",
      unitMemoryDiagnostics,
      "",
      "Prior unit artifacts:",
      unitContext,
      "",
      "Active skills:",
      skillContext,
      "",
      "Language-specific guidance:",
      languageGuidance,
    ].join("\n");

    const scoutStartedAt = Date.now();
    const plannerStartedAt = Date.now();
    const [scoutOutcome, plannerOutcome] = await Promise.allSettled([
      callSubagent<ScoutResult>({
        role: "scout",
        routing: modelRouting,
        modelConfig: request.modelConfig,
        signal: hooks?.signal,
        parser: parseScoutResult,
        cache: artifactCache,
        observability,
        system:
          "You are the Scout agent. Select the smallest relevant file set needed to implement this unit. Return JSON only.",
        prompt: scoutPrompt,
      }),
      callSubagent<PlannerResult>({
        role: "planner",
        routing: modelRouting,
        modelConfig: request.modelConfig,
        signal: hooks?.signal,
        parser: parsePlannerResult,
        cache: artifactCache,
        observability,
        system:
          "You are the Planner agent. Produce a lightweight, high-precision plan for this work unit. Return JSON only.",
        prompt: plannerPrompt,
      }),
    ]);

    if (scoutOutcome.status !== "fulfilled" || plannerOutcome.status !== "fulfilled") {
      const messages: string[] = [];
      if (scoutOutcome.status === "rejected") {
        messages.push(`Scout failed: ${toErrorMessage(scoutOutcome.reason, "unknown error")}`);
      }
      if (plannerOutcome.status === "rejected") {
        messages.push(
          `Planner failed: ${toErrorMessage(plannerOutcome.reason, "unknown error")}`
        );
      }
      throw new Error(messages.join(" | "));
    }

    const scout = scoutOutcome.value.parsed;
    const planner = plannerOutcome.value.parsed;
    artifactStore.add("scout", unit.id, scout.summary, scout);
    artifactStore.add("planner", unit.id, planner.summary, planner);

    const scoutStep = createStep({
      iteration: iterationCounter,
      phase: "action",
      role: "Scout",
      summary: scout.summary,
      output: truncate(
        `model=${scoutOutcome.value.modelUsed}, attempts=${scoutOutcome.value.attempts}, cache=${String(scoutOutcome.value.cacheHit)}\n${scoutOutcome.value.raw}`,
        RESPONSE_OUTPUT_LIMIT
      ),
      ok: true,
      durationMs: Date.now() - scoutStartedAt,
    });
    steps.push(scoutStep);
    emit(hooks, { type: "step", data: { step: scoutStep } });

    const plannerStep = createStep({
      iteration: iterationCounter,
      phase: "action",
      role: "Planner",
      summary: planner.summary,
      output: truncate(
        `model=${plannerOutcome.value.modelUsed}, attempts=${plannerOutcome.value.attempts}, cache=${String(plannerOutcome.value.cacheHit)}\n${plannerOutcome.value.raw}`,
        RESPONSE_OUTPUT_LIMIT
      ),
      ok: true,
      durationMs: Date.now() - plannerStartedAt,
    });
    steps.push(plannerStep);
    emit(hooks, { type: "step", data: { step: plannerStep } });

    const fileCandidates = new Set<string>();
    for (const hint of unit.filesHint) fileCandidates.add(hint);
    for (const file of scout.relevantFiles) fileCandidates.add(file.path);
    for (const target of planner.writeTargets) fileCandidates.add(target.path);

    const snippets: Array<{ path: string; content: string }> = [];
    await Promise.all(
      Array.from(fileCandidates)
        .slice(0, MAX_FILE_SNIPPETS_PER_UNIT)
        .map(async (candidatePath) => {
          const snippet = await readSnippet(
            workspace,
            candidatePath,
            MAX_FILE_SNIPPET_LINES
          );
          if (!snippet) return;
          snippets.push({
            path: candidatePath,
            content: snippet,
          });
        })
    );

    const snippetsText =
      snippets.length > 0
        ? snippets
            .map(
              (snippet) =>
                `### ${snippet.path}\n${truncate(snippet.content, 2800)}`
            )
            .join("\n\n")
        : "(no snippets available)";

    const coderStartedAt = Date.now();
    let coderOutput = await callSubagent<CoderResult>({
      role: "coder",
      routing: modelRouting,
      modelConfig: request.modelConfig,
      signal: hooks?.signal,
      parser: parseCoderResult,
      cache: artifactCache,
      observability,
      system:
        "You are the Coder agent. Produce deterministic, minimal file operations. Prefer patch_file hunks with conflict-safe oldText/newText replacements. Return JSON only.",
      prompt: [
        "Return JSON shape:",
        "{",
        '  "summary": "string",',
        '  "changes": [',
        '    {"op":"patch_file","path":"string","hunks":[{"oldText":"string","newText":"string","occurrence":1}],"rationale":"string"}',
        '    or {"op":"write_file|append_file|delete_file","path":"string","content":"string when required","rationale":"string"}',
        "  ],",
        '  "verificationNotes": ["string"],',
        '  "remainingRisks": ["string"],',
        '  "confidence": 0.0',
        "}",
        "",
        `Goal: ${request.goal}`,
        `Work unit: ${unit.title}`,
        `Objective: ${unit.objective}`,
        "",
        "Scout output:",
        JSON.stringify(scout, null, 2),
        "",
        "Planner output:",
        JSON.stringify(planner, null, 2),
        "",
        "File snippets:",
        snippetsText,
        "",
        "Relevant long-term memory:",
        unitMemory.contextBlock,
        "",
        "Memory diagnostics:",
        unitMemoryDiagnostics,
        "",
        "Language-specific guidance:",
        languageGuidance,
        "",
        "Prior unit artifacts:",
        artifactStore.getUnitContext(unit.id),
      ].join("\n"),
    });
    if (coderOutput.parsed.confidence < LOW_CONFIDENCE_ESCALATION_THRESHOLD) {
      const escalatedCoder = await callSubagent<CoderResult>({
        role: "coder",
        routing: modelRouting,
        modelConfig: request.modelConfig,
        signal: hooks?.signal,
        parser: parseCoderResult,
        cache: artifactCache,
        observability,
        tierOverride: "heavy",
        escalated: true,
        system:
          "You are a senior Coder fallback. Improve confidence and determinism. Prefer patch_file hunks.",
        prompt: [
          `Goal: ${request.goal}`,
          `Work unit: ${unit.title}`,
          "Previous low-confidence coder output:",
          coderOutput.raw,
          "",
          "Re-produce deterministic changes with stronger reasoning.",
        ].join("\n"),
      });
      if (escalatedCoder.parsed.confidence >= coderOutput.parsed.confidence) {
        coderOutput = escalatedCoder;
      }
    }
    const coder = coderOutput.parsed;
    artifactStore.add("coder", unit.id, coder.summary, coder);

    const coderStep = createStep({
      iteration: iterationCounter,
      phase: "action",
      role: "Coder",
      summary: coder.summary,
      output: truncate(
        `model=${coderOutput.modelUsed}, attempts=${coderOutput.attempts}, cache=${String(coderOutput.cacheHit)}, confidence=${coder.confidence.toFixed(2)}\n${coderOutput.raw}`,
        RESPONSE_OUTPUT_LIMIT
      ),
      ok: true,
      durationMs: Date.now() - coderStartedAt,
    });
    steps.push(coderStep);
    emit(hooks, { type: "step", data: { step: coderStep } });

    if (coder.changes.length === 0) {
      throw new Error("Coder produced no changes for the unit");
    }

    const criticStartedAt = Date.now();
    let criticOutput = await callSubagent<CriticResult>({
      role: "critic",
      routing: modelRouting,
      modelConfig: request.modelConfig,
      signal: hooks?.signal,
      parser: parseCriticResult,
      cache: artifactCache,
      observability,
      system:
        "You are the Critic agent. Evaluate safety, correctness, and regressions. Score 0..1 where >= threshold is required. Return JSON only.",
      prompt: [
        "Return JSON shape:",
        "{",
        '  "summary": "string",',
        '  "score": 0.0,',
        '  "blockingIssues": ["string"],',
        '  "nonBlockingIssues": ["string"],',
        '  "recommendations": ["string"]',
        "}",
        "",
        `Required score threshold: ${request.criticPassThreshold}`,
        `Goal: ${request.goal}`,
        `Work unit: ${unit.title}`,
        "",
        "Relevant long-term memory:",
        unitMemory.contextBlock,
        "",
        "Memory diagnostics:",
        unitMemoryDiagnostics,
        "",
        "Language-specific guidance:",
        languageGuidance,
        "",
        "Planned changes:",
        JSON.stringify(coder.changes, null, 2),
        "",
        "File snippets:",
        snippetsText,
      ].join("\n"),
    });
    let critic = criticOutput.parsed;
    if (
      critic.blockingIssues.length === 0 &&
      critic.score < request.criticPassThreshold &&
      request.criticPassThreshold - critic.score <= CRITIC_REVIEW_ESCALATION_WINDOW
    ) {
      const escalatedCritic = await callSubagent<CriticResult>({
        role: "critic",
        routing: modelRouting,
        modelConfig: request.modelConfig,
        signal: hooks?.signal,
        parser: parseCriticResult,
        cache: artifactCache,
        observability,
        tierOverride: "heavy",
        escalated: true,
        system:
          "You are a final-gate Critic. Re-evaluate this candidate patch with rigorous correctness focus. Return JSON only.",
        prompt: [
          `Goal: ${request.goal}`,
          `Work unit: ${unit.title}`,
          `Threshold: ${request.criticPassThreshold}`,
          "Patch candidate:",
          JSON.stringify(coder.changes, null, 2),
          "",
          "Prior critic output:",
          criticOutput.raw,
        ].join("\n"),
      });
      if (escalatedCritic.parsed.score >= critic.score) {
        criticOutput = escalatedCritic;
        critic = escalatedCritic.parsed;
      }
    }
    artifactStore.add("critic", unit.id, critic.summary, critic);

    const criticStep = createStep({
      iteration: iterationCounter,
      phase: "action",
      role: "Critic",
      summary: `score=${critic.score.toFixed(2)} ${critic.summary}`,
      output: truncate(
        `model=${criticOutput.modelUsed}, attempts=${criticOutput.attempts}, cache=${String(criticOutput.cacheHit)}\n${criticOutput.raw}`,
        RESPONSE_OUTPUT_LIMIT
      ),
      ok: critic.blockingIssues.length === 0,
      durationMs: Date.now() - criticStartedAt,
    });
    steps.push(criticStep);
    emit(hooks, { type: "step", data: { step: criticStep } });

    state.criticScore = critic.score;
    state.blockingIssues = critic.blockingIssues;

    const isFinalRetryForUnit = state.attempts >= DEFAULT_UNIT_MAX_ATTEMPTS;
    const canProceedWithLowCriticScore =
      critic.blockingIssues.length === 0 &&
      critic.score >= CRITIC_FLOOR_ON_FINAL_ATTEMPT &&
      coder.confidence >= 0.35 &&
      isFinalRetryForUnit;

    if (
      critic.blockingIssues.length > 0 ||
      coder.confidence < 0.35 ||
      (critic.score < request.criticPassThreshold && !canProceedWithLowCriticScore)
    ) {
      const reasons: string[] = [];
      if (critic.blockingIssues.length > 0) {
        reasons.push(`blocking issues: ${critic.blockingIssues.join("; ")}`);
      }
      if (critic.score < request.criticPassThreshold) {
        reasons.push(
          `critic score ${critic.score.toFixed(2)} below threshold ${request.criticPassThreshold.toFixed(2)}`
        );
      }
      if (coder.confidence < 0.35) {
        reasons.push(`coder confidence too low (${coder.confidence.toFixed(2)})`);
      }
      throw new Error(`Critic gate failed: ${reasons.join(" | ")}`);
    }

    if (critic.score < request.criticPassThreshold && canProceedWithLowCriticScore) {
      const warningStep = createStep({
        iteration: iterationCounter,
        phase: "action",
        role: "Orchestrator",
        summary:
          "Critic score below threshold on final retry; proceeding to apply changes and rely on verification gates.",
        output: `score=${critic.score.toFixed(2)} threshold=${request.criticPassThreshold.toFixed(2)} floor=${CRITIC_FLOOR_ON_FINAL_ATTEMPT.toFixed(2)}`,
        ok: true,
        durationMs: 0,
      });
      steps.push(warningStep);
      emit(hooks, { type: "step", data: { step: warningStep } });
    }

    if (
      requiresUnitEvidenceGate &&
      !hasUnitEvidenceForMutation({
        scout,
        planner,
        snippetsCount: snippets.length,
      })
    ) {
      throw new Error(
        "Memory evidence gate failed: conflicting memory requires file/test evidence before mutation."
      );
    }

    const applyResults = await writeQueue.enqueue(async () => {
      const outputs: Array<{
        ok: boolean;
        summary: string;
        output: string;
        action: AgentAction;
      }> = [];
      for (const change of coder.changes) {
        throwIfAborted(hooks?.signal);
        const applied = await applyChange(change, context);
        outputs.push(applied);
        if (!applied.ok) break;
      }
      return outputs;
    });

    for (const applied of applyResults) {
      const changeStep = createStep({
        iteration: iterationCounter,
        phase: "action",
        role: "Writer",
        summary: applied.summary,
        output: applied.output,
        ok: applied.ok,
        durationMs: 0,
        action: applied.action,
      });
      steps.push(changeStep);
      emit(hooks, { type: "step", data: { step: changeStep } });
    }

    const failedChange = applyResults.find((entry) => !entry.ok);
    if (failedChange) {
      throw new Error(failedChange.summary);
    }

    state.filesTouched = coder.changes.map((change) => change.path);

    if (request.strictVerification && unitVerificationCommands.length > 0) {
      verificationAttempts += 1;
      const verificationOutcome = await runVerificationSuite(
        iterationCounter,
        verificationAttempts,
        unitVerificationCommands,
        context,
        steps,
        hooks,
        {
          mode: "unit",
          flakyTestRetries: 1,
          allowFlakyQuarantine: true,
        },
        hooks?.signal,
        observability
      );
      verificationChecks.push(...verificationOutcome.checks);
      for (const flakyCommand of verificationOutcome.flakyRecoveredCommands) {
        flakyQuarantinedCommands.add(flakyCommand);
      }
      state.verificationPassed = verificationOutcome.passed;

      if (!verificationOutcome.passed) {
        throw new Error("Unit verification checks failed");
      }
    } else {
      state.verificationPassed = null;
    }

    state.status = "completed";
    state.summary = `${coder.summary} | ${critic.summary}`;
    state.endedAtMs = Date.now();
  }

  while (true) {
    throwIfAborted(hooks?.signal);
    if (iterationCounter >= request.maxIterations) {
      reachedIterationLimit = true;
      break;
    }

    const pendingUnits = Array.from(workUnitStates.values()).filter(
      (state) => state.status === "pending"
    );
    if (pendingUnits.length === 0) break;

    const ready = pendingUnits.filter((state) =>
      state.unit.dependsOn.every((dependencyId) => {
        const dependencyState = workUnitStates.get(dependencyId);
        return dependencyState?.status === "completed";
      })
    );

    const blockedByFailures = pendingUnits.filter((state) =>
      state.unit.dependsOn.some((dependencyId) => failedUnits.has(dependencyId))
    );
    for (const blocked of blockedByFailures) {
      blocked.status = "blocked";
      blocked.lastError = "Dependency failed";
      failedUnits.add(blocked.unit.id);
    }

    if (ready.length === 0) {
      const replanned = await runDependencyReplan(
        "No ready units available while pending units remain."
      );
      if (replanned) {
        continue;
      }
      for (const pending of pendingUnits) {
        if (pending.status === "pending") {
          pending.status = "blocked";
          pending.lastError = "Dependency graph unresolved";
          failedUnits.add(pending.unit.id);
        }
      }
      break;
    }

    const batch = ready.slice(0, maxParallel);
    await Promise.allSettled(
      batch.map(async (state) => {
        let succeeded = false;
        for (
          let attempt = 1;
          attempt <= DEFAULT_UNIT_MAX_ATTEMPTS && !succeeded;
          attempt += 1
        ) {
          if (iterationCounter >= request.maxIterations) {
            reachedIterationLimit = true;
            state.status = "failed";
            state.lastError = "Iteration budget exhausted";
            failedUnits.add(state.unit.id);
            break;
          }
          iterationCounter += 1;
          try {
            await executeUnit(state);
            succeeded = true;
          } catch (err) {
            state.lastError = toErrorMessage(err, "Unit execution failed");
            state.status = "failed";
            state.endedAtMs = Date.now();
            observability.recordFailure(categorizeFailure(state.lastError));
            const failStep = createStep({
              iteration: iterationCounter,
              phase: "action",
              role: "Orchestrator",
              summary: `Unit ${state.unit.id} failed on attempt ${attempt}`,
              output: state.lastError,
              ok: false,
              durationMs: 0,
            });
            steps.push(failStep);
            emit(hooks, { type: "step", data: { step: failStep } });
            if (!request.autoFixVerification || attempt >= DEFAULT_UNIT_MAX_ATTEMPTS) {
              break;
            }
            state.status = "pending";
          }
        }
        if (state.status !== "completed") {
          failedUnits.add(state.unit.id);
        }
      })
    );
    await persistContinuationSnapshot("Batch execution checkpoint");
  }

  const unitStates = Array.from(workUnitStates.values());
  const hasFailedUnit = unitStates.some(
    (state) => state.status === "failed" || state.status === "blocked"
  );

  if (request.strictVerification && verificationCommands.length > 0) {
    emit(hooks, {
      type: "status",
      data: {
        message: "Multi-agent final verification: running full quality gates.",
      },
    });
    verificationAttempts += 1;
    const finalVerification = await runVerificationSuite(
      iterationCounter + 1,
      verificationAttempts,
      verificationCommands,
      context,
      steps,
      hooks,
      {
        mode: "final",
        flakyTestRetries: FLAKY_TEST_MAX_RETRIES,
        allowFlakyQuarantine: true,
      },
      hooks?.signal,
      observability
    );
    verificationChecks.push(...finalVerification.checks);
    for (const flakyCommand of finalVerification.flakyRecoveredCommands) {
      flakyQuarantinedCommands.add(flakyCommand);
    }
    verificationPassed = finalVerification.passed;
  } else {
    verificationPassed = null;
  }

  const overallSuccess =
    !hasFailedUnit &&
    (verificationPassed === null || verificationPassed) &&
    !unitStates.some((state) => state.status !== "completed");

  let synthesis: SynthesizerResult = {
    summary: overallSuccess
      ? "All work units completed and verification passed."
      : "Some work units failed or quality gates did not pass.",
    verification: [],
    remainingWork: [],
  };

  try {
    const synthInput = await callSubagent<SynthesizerResult>({
      role: "synthesizer",
      routing: modelRouting,
      modelConfig: request.modelConfig,
      signal: hooks?.signal,
      parser: parseSynthesizerResult,
      cache: artifactCache,
      observability,
      system:
        "You are the Synthesizer agent. Summarize final status, verification notes, and concrete remaining work. Return JSON only.",
      prompt: [
        "Return JSON shape:",
        "{",
        '  "summary": "string",',
        '  "verification": ["string"],',
        '  "remainingWork": ["string"]',
        "}",
        "",
        `Goal: ${request.goal}`,
        `Strategy: ${planning.strategy}`,
        `Unit states:\n${JSON.stringify(
          unitStates.map((state) => ({
            id: state.unit.id,
            title: state.unit.title,
            status: state.status,
            attempts: state.attempts,
            criticScore: state.criticScore,
            summary: state.summary,
            error: state.lastError,
            verificationPassed: state.verificationPassed,
          })),
          null,
          2
        )}`,
        "",
        `Verification passed: ${String(verificationPassed)}`,
        `Changed files: ${Array.from(context.changedFiles).join(", ") || "(none)"}`,
        `Flaky quarantined commands: ${Array.from(flakyQuarantinedCommands).join(", ") || "(none)"}`,
      ].join("\n"),
    });
    synthesis = synthInput.parsed;
    artifactStore.add("synthesizer", "final", synthesis.summary, synthesis);
  } catch {
    // Keep default synthesis fallback.
  }

  let status: AgentRunStatus = "completed";
  if (reachedIterationLimit) {
    status = "max_iterations";
  } else if (hasFailedUnit) {
    status = "failed";
  } else if (request.strictVerification && verificationPassed === false) {
    status = "verification_failed";
  }

  if (
    !request.dryRun &&
    goalLikelyRequiresCodeMutation(request.goal) &&
    context.fileWriteCount === 0
  ) {
    status = "failed";
    const noMutationMessage =
      "No file mutations were applied for a coding goal. This run did not complete implementation work.";
    synthesis = {
      ...synthesis,
      summary: `${noMutationMessage} ${synthesis.summary}`.trim(),
      verification: dedupeLines([...synthesis.verification, noMutationMessage]),
      remainingWork: dedupeLines([
        ...synthesis.remainingWork,
        "Apply concrete file changes that implement the requested goal.",
      ]),
    };
    observability.recordFailure("run:zero_mutation_for_coding_goal");
  }

  let rollbackApplied = false;
  let rollbackSummary: string[] = [];
  if (status !== "completed" && request.rollbackOnFailure) {
    const rollback = await rollbackChanges(context);
    rollbackApplied = rollback.applied;
    rollbackSummary = rollback.summary;
  } else {
    rollbackSummary = ["No rollback needed (run completed successfully)."];
  }

  const multiAgent: MultiAgentRunSummary = {
    strategy: planning.strategy,
    finalChecks: planning.finalChecks,
    workUnits: unitStates.map((state) => ({
      id: state.unit.id,
      title: state.unit.title,
      status: state.status,
      dependsOn: state.unit.dependsOn,
      attempts: state.attempts,
      criticScore: state.criticScore,
      verificationPassed: state.verificationPassed,
      filesTouched: state.filesTouched,
      summary: state.summary,
      error: state.lastError,
      blockingIssues: state.blockingIssues,
    })),
    artifacts: artifactStore.toSummary(),
    flakyQuarantinedCommands: Array.from(flakyQuarantinedCommands),
    observability: observability.toSummary({
      totalDurationMs: Date.now() - runStartedAtMs,
      unitStates,
    }),
  };

  if (status !== "completed") {
    await persistContinuationSnapshot(`Run status ${status}`);
  } else {
    await saveContinuationPacket(workspace, {
      runId,
      executionMode: "multi",
      goal: request.goal,
      summary: "Run completed successfully.",
      pendingWork: [],
      nextActions: ["Start next goal or archive completed context."],
      createdAt: new Date().toISOString(),
    }).catch(() => undefined);
  }

  await artifactCache.persist();

  await addMemoryEntries(
    workspace,
    buildLongTermMemoryCandidates({
      workspace,
      goal: request.goal,
      runId,
      status,
      dryRun: request.dryRun,
      verificationPassed,
      verificationCommands,
      unitStates,
      synthesisSummary: synthesis.summary,
      flakyQuarantinedCommands: Array.from(flakyQuarantinedCommands),
      clarificationAnswers: request.clarificationAnswers,
    })
  ).catch(() => undefined);

  return buildCompletionResult({
    status,
    runId,
    goal: request.goal,
    startedAt,
    model: modelName,
    maxIterations: request.maxIterations,
    summary: synthesis.summary,
    verification: synthesis.verification,
    remainingWork: synthesis.remainingWork,
    context,
    strictVerification: request.strictVerification,
    autoFixVerification: request.autoFixVerification,
    dryRun: request.dryRun,
    rollbackOnFailure: request.rollbackOnFailure,
    verificationAttempts,
    verificationPassed,
    verificationCommands,
    verificationChecks,
    rollbackApplied,
    rollbackSummary,
    teamSize: request.teamSize,
    teamRoster,
    runPreflightChecks: request.runPreflightChecks,
    preflightPassed,
    preflightChecks,
    clarificationRequired: false,
    clarificationQuestions,
    clarificationAnswersUsed: request.clarificationAnswers,
    projectDigest,
    projectIntelligence,
    steps,
    error:
      status === "completed"
        ? undefined
        : status === "verification_failed"
          ? "Final quality gates failed."
          : "One or more work units failed.",
    multiAgent,
  });
}
