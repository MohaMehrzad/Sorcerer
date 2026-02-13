import { execFile } from "child_process";
import { promisify } from "util";
import { appendFile, mkdir, readFile, readdir, unlink, writeFile } from "fs/promises";
import { createHash, randomUUID } from "crypto";
import path from "path";
import {
  completeModel,
  ModelConfig,
  ModelMessage,
  parseModelConfigInput,
  resolveModelConfig,
} from "@/lib/server/model";
import {
  collectProjectIntelligence,
  ProjectIntelligence,
} from "@/lib/server/projectIntelligence";
import { loadSkillDocuments, SkillDocument } from "@/lib/server/skills";
import {
  getDefaultWorkspacePath,
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

const execFileAsync = promisify(execFile);

const UNBOUNDED_MAX_ITERATIONS = 0;
const DEFAULT_MAX_ITERATIONS = UNBOUNDED_MAX_ITERATIONS;
const MAX_ITERATIONS_LIMIT = 40;
const DEFAULT_MAX_FILE_WRITES = 24;
const DEFAULT_MAX_COMMAND_RUNS = 36;
const DEFAULT_TEAM_SIZE = 6;
const MAX_TEAM_SIZE = 100;
const MODEL_OUTPUT_LIMIT = 9000;
const RESPONSE_OUTPUT_LIMIT = 6000;
const COMMAND_TIMEOUT_MS = 120000;
const MAX_COMMAND_BUFFER = 800000;
const MAX_FILE_SIZE = 350000;
const RUN_CHECKPOINT_VERSION = 1;
const CONTEXT_WINDOW_TOKEN_LEVELS = [52000, 36000, 24000, 16000] as const;
const CONTEXT_WINDOW_MIN_RECENT_MESSAGES = 10;
const CONTEXT_WINDOW_COMPACTION_TRIGGER_TOKENS = 68000;
const CONTEXT_WINDOW_HARD_HISTORY_MESSAGES = 180;
const CONTEXT_WINDOW_SUMMARY_LIMIT = 5200;
const CHECKPOINT_INTERVAL = 2;
const DECISION_HEARTBEAT_INTERVAL_MS = 10000;
const RESUME_STALE_AFTER_MS = 5 * 60 * 1000;
const MAX_SKILL_FILES = 20;
const MAX_ACTIVE_SKILLS = 8;
const MAX_SKILL_CONTEXT_TOTAL_CHARS = 16000;
const MAX_SKILL_CONTEXT_PER_FILE_CHARS = 3200;
const STAGNATION_NO_MUTATION_ITERATIONS = 4;
const STAGNATION_REPEAT_ACTION_ITERATIONS = 3;
const MAX_STAGNATION_INTERVENTIONS = 4;

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

const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".svg",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".pdf",
  ".zip",
  ".tar",
  ".gz",
  ".mp3",
  ".mp4",
  ".avi",
  ".mov",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".pyc",
  ".class",
  ".o",
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

interface TreeNode {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: TreeNode[];
}

export interface AgentCommand {
  program: string;
  args?: string[];
  cwd?: string;
}

export type AgentAction =
  | {
      type: "list_tree";
      maxDepth?: number;
    }
  | {
      type: "search_files";
      pattern: string;
      glob?: string;
      maxResults?: number;
    }
  | {
      type: "read_file";
      path: string;
      startLine?: number;
      endLine?: number;
    }
  | {
      type: "read_many_files";
      paths: string[];
      maxLinesPerFile?: number;
    }
  | {
      type: "write_file";
      path: string;
      content: string;
    }
  | {
      type: "append_file";
      path: string;
      content: string;
    }
  | {
      type: "delete_file";
      path: string;
    }
  | {
      type: "run_command";
      program: string;
      args?: string[];
      cwd?: string;
    }
  | {
      type: "web_search";
      query: string;
    }
  | {
      type: "final";
      summary: string;
      verification?: string[];
      remainingWork?: string[];
    };

interface AgentDecision {
  thinking: string;
  action: AgentAction;
}

interface ToolResult {
  ok: boolean;
  summary: string;
  output: string;
}

export interface AgentStep {
  iteration: number;
  phase: "action" | "verification";
  thinking: string;
  action: AgentAction;
  ok: boolean;
  summary: string;
  output: string;
  durationMs: number;
}

export interface VerificationCheckResult {
  attempt: number;
  command: AgentCommand;
  ok: boolean;
  output: string;
  durationMs: number;
}

export type AgentRunStatus =
  | "completed"
  | "max_iterations"
  | "verification_failed"
  | "needs_clarification"
  | "failed"
  | "canceled";

export type AgentExecutionMode = "single" | "multi";

export interface ClarificationQuestion {
  id: string;
  question: string;
  rationale: string;
  required: boolean;
  options?: ClarificationOption[];
  allowCustomAnswer?: boolean;
}

export interface ClarificationOption {
  id: string;
  label: string;
  value: string;
  description?: string;
  recommended?: boolean;
}

export interface ProjectDigest {
  workspace: string;
  keyDirectories: string[];
  packageScripts: string[];
  languageHints: string[];
  hasTests: boolean;
  treePreview: string;
}

export interface MultiAgentReport {
  strategy: string;
  finalChecks: string[];
  workUnits: Array<{
    id: string;
    title: string;
    status: "pending" | "running" | "completed" | "failed" | "blocked";
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
    role: "supervisor" | "scout" | "planner" | "coder" | "critic" | "synthesizer";
    unitId: string;
    summary: string;
    timestamp: string;
  }>;
  flakyQuarantinedCommands: string[];
  observability: {
    totalDurationMs: number;
    modelUsage: Array<{
      role: "supervisor" | "scout" | "planner" | "coder" | "critic" | "synthesizer";
      tier: "light" | "heavy";
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
      status: "pending" | "running" | "completed" | "failed" | "blocked";
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

export interface AgentRunResult {
  status: AgentRunStatus;
  runId: string;
  resumedFromRunId?: string;
  executionMode: AgentExecutionMode;
  goal: string;
  startedAt: string;
  finishedAt: string;
  model: string;
  maxIterations: number;
  iterationsUsed: number;
  summary: string;
  verification: string[];
  remainingWork: string[];
  filesChanged: string[];
  commandsRun: string[];
  fileWriteCount: number;
  commandRunCount: number;
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
  changeJournal: ChangeJournalEntry[];
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
  zeroKnownIssues: boolean;
  steps: AgentStep[];
  multiAgentReport?: MultiAgentReport;
  error?: string;
}

export interface AgentRunRequest {
  goal: string;
  workspacePath?: string;
  executionMode: AgentExecutionMode;
  skillFiles: string[];
  resumeRunId?: string;
  resumeFromLastCheckpoint: boolean;
  maxIterations: number;
  modelOverride?: string;
  modelConfig?: Partial<ModelConfig>;
  strictVerification: boolean;
  autoFixVerification: boolean;
  dryRun: boolean;
  rollbackOnFailure: boolean;
  verificationCommands: AgentCommand[];
  maxFileWrites: number;
  maxCommandRuns: number;
  maxParallelWorkUnits: number;
  criticPassThreshold: number;
  teamSize: number;
  runPreflightChecks: boolean;
  requireClarificationBeforeEdits: boolean;
  clarificationAnswers: Record<string, string>;
}

export type AgentRunProgressEvent =
  | {
      type: "started";
      data: {
        goal: string;
        maxIterations: number;
        model: string;
        strictVerification: boolean;
        autoFixVerification: boolean;
        dryRun: boolean;
        rollbackOnFailure: boolean;
        teamSize: number;
        runPreflightChecks: boolean;
        requireClarificationBeforeEdits: boolean;
        executionMode: AgentExecutionMode;
      };
    }
  | {
      type: "status";
      data: {
        message: string;
      };
    }
  | {
      type: "step";
      data: {
        step: AgentStep;
      };
    }
  | {
      type: "verification";
      data: {
        attempt: number;
        passed: boolean;
        checks: VerificationCheckResult[];
      };
    };

export interface AgentRunHooks {
  signal?: AbortSignal;
  onEvent?: (event: AgentRunProgressEvent) => void;
}

interface ToolContext {
  workspace: string;
  request: AgentRunRequest;
  changedFiles: Set<string>;
  commandsRun: string[];
  fileWriteCount: number;
  commandRunCount: number;
  changeSnapshots: Map<string, FileSnapshot>;
  changeJournal: ChangeJournalEntry[];
}

interface VerificationOutcome {
  passed: boolean;
  checks: VerificationCheckResult[];
  feedback: string;
}

interface FileSnapshot {
  path: string;
  existed: boolean;
  previousContent: string;
}

export interface ChangeJournalEntry {
  op: "write" | "append" | "delete";
  path: string;
  timestamp: string;
  details: string;
}

interface ConversationCompactionState {
  summary: string;
  lastCompactedIteration: number;
  droppedMessages: number;
}

interface RunCheckpointRecord {
  version: number;
  runId: string;
  resumeKey: string;
  workspace: string;
  goal: string;
  skillFiles?: string[];
  startedAt: string;
  updatedAt: string;
  status: AgentRunStatus | "in_progress";
  resumedFromRunId?: string;
  lastIteration: number;
  history: ModelMessage[];
  compaction: ConversationCompactionState;
  steps: AgentStep[];
  changedFiles: string[];
  commandsRun: string[];
  fileWriteCount: number;
  commandRunCount: number;
  verificationChecks: VerificationCheckResult[];
  preflightChecks: VerificationCheckResult[];
  preflightPassed: boolean | null;
  verificationAttempts: number;
  verificationPassed: boolean | null;
  verification: string[];
  remainingWork: string[];
  summary: string;
  rollbackApplied: boolean;
  rollbackSummary: string[];
  changeJournal: ChangeJournalEntry[];
  clarificationAnswers: Record<string, string>;
  clarificationQuestions: ClarificationQuestion[];
  projectDigest: ProjectDigest;
  projectIntelligence: ProjectIntelligence;
}

interface RunCheckpointMeta {
  runId: string;
  resumeKey: string;
  workspace: string;
  goal: string;
  startedAt: string;
  updatedAt: string;
  status: AgentRunStatus | "in_progress";
  resumedFromRunId?: string;
  lastIteration: number;
}

interface RunPersistenceContext {
  runId: string;
  runDir: string;
  eventsPath: string;
  checkpointPath: string;
  metaPath: string;
  resumeKey: string;
  startedAt: string;
  resumedFromRunId?: string;
}

class RunCanceledError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunCanceledError";
  }
}

function emit(hooks: AgentRunHooks | undefined, event: AgentRunProgressEvent) {
  hooks?.onEvent?.(event);
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new RunCanceledError("Run canceled by user");
  }
}

function toErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message.trim().length > 0) {
    return err.message;
  }
  if (typeof err === "string" && err.trim().length > 0) {
    return err;
  }
  if (err && typeof err === "object" && "message" in err) {
    const message = (err as { message?: unknown }).message;
    if (typeof message === "string" && message.trim().length > 0) {
      return message;
    }
  }
  return fallback;
}

function clampNumber(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  if (value === undefined || Number.isNaN(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function isUnboundedIterationMode(maxIterations: number): boolean {
  return maxIterations === UNBOUNDED_MAX_ITERATIONS;
}

function hasIterationBudgetRemaining(iteration: number, maxIterations: number): boolean {
  return isUnboundedIterationMode(maxIterations) || iteration <= maxIterations;
}

function hasFollowupIteration(iteration: number, maxIterations: number): boolean {
  return isUnboundedIterationMode(maxIterations) || iteration < maxIterations;
}

function formatIterationBudget(maxIterations: number): string {
  return isUnboundedIterationMode(maxIterations) ? "unbounded" : String(maxIterations);
}

function normalizeCheckpointIteration(
  iterationsUsed: number,
  maxIterations: number
): number {
  if (isUnboundedIterationMode(maxIterations)) {
    return Math.max(0, iterationsUsed);
  }
  return Math.min(maxIterations, Math.max(0, iterationsUsed));
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n... (truncated ${text.length - maxChars} chars)`;
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function estimateMessageTokens(message: ModelMessage): number {
  return estimateTokens(message.role) + estimateTokens(message.content) + 8;
}

function estimateMessagesTokens(messages: ModelMessage[]): number {
  return messages.reduce((total, message) => total + estimateMessageTokens(message), 0);
}

function getRunStorageRoot(): string {
  return path.join(getDefaultWorkspacePath(), ".tmp", "agent-runs");
}

function buildResumeKey(workspace: string, goal: string): string {
  return createHash("sha256")
    .update(`${workspace}\n${goal.trim()}`)
    .digest("hex")
    .slice(0, 24);
}

function createInitialCompactionState(): ConversationCompactionState {
  return {
    summary: "",
    lastCompactedIteration: 0,
    droppedMessages: 0,
  };
}

function isStaleRunTimestamp(timestamp: string): boolean {
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) return true;
  return Date.now() - parsed > RESUME_STALE_AFTER_MS;
}

function buildOperationalMemorySummary(params: {
  goal: string;
  iteration: number;
  maxIterations: number;
  steps: AgentStep[];
  changedFiles: Set<string>;
  verificationChecks: VerificationCheckResult[];
  preflightChecks: VerificationCheckResult[];
  compaction: ConversationCompactionState;
}): string {
  const recentSteps = params.steps.slice(-8).map((step) => {
    const status = step.ok ? "ok" : "fail";
    return `${step.iteration}/${step.phase}/${status}: ${actionSummaryForMemory(step.action)} => ${step.summary}`;
  });

  const recentFailures = [...params.verificationChecks, ...params.preflightChecks]
    .filter((check) => !check.ok)
    .slice(-6)
    .map((check) => `${stringifyCommand(check.command)} :: ${truncate(check.output, 220)}`);

  const changedFiles = Array.from(params.changedFiles).slice(-24);

  const summary = [
    "Operational memory checkpoint:",
    `Goal: ${truncate(params.goal, 260)}`,
    `Progress: iteration ${params.iteration}/${formatIterationBudget(params.maxIterations)}`,
    `Compaction stats: droppedMessages=${params.compaction.droppedMessages}, lastCompactedIteration=${params.compaction.lastCompactedIteration}`,
    `Changed files (${changedFiles.length}): ${changedFiles.join(", ") || "(none)"}`,
    "",
    "Recent steps:",
    recentSteps.length > 0 ? recentSteps.map((line) => `- ${line}`).join("\n") : "- (none)",
    "",
    "Recent failed checks:",
    recentFailures.length > 0
      ? recentFailures.map((line) => `- ${line}`).join("\n")
      : "- (none)",
  ].join("\n");

  return truncate(summary, CONTEXT_WINDOW_SUMMARY_LIMIT);
}

function actionSummaryForMemory(action: AgentAction): string {
  switch (action.type) {
    case "list_tree":
      return `list_tree depth=${String(action.maxDepth ?? 4)}`;
    case "search_files":
      return `search_files ${action.pattern}`;
    case "read_file":
      return `read_file ${action.path}`;
    case "read_many_files":
      return `read_many_files ${action.paths.length}`;
    case "write_file":
      return `write_file ${action.path}`;
    case "append_file":
      return `append_file ${action.path}`;
    case "delete_file":
      return `delete_file ${action.path}`;
    case "run_command":
      return `run_command ${action.program}`;
    case "web_search":
      return `web_search ${action.query}`;
    case "final":
      return "final";
    default:
      return "unknown";
  }
}

function collectRecentFailedStepSummaries(
  steps: AgentStep[],
  limit = 8
): string[] {
  return steps
    .filter((step) => !step.ok)
    .slice(-limit)
    .map(
      (step) =>
        `Iter ${step.iteration} ${actionSummaryForMemory(step.action)}: ${truncate(step.summary, 180)}`
    );
}

function buildContinuationNextActions(
  status: AgentRunStatus | "in_progress",
  nextIterationHint?: number
): string[] {
  if (status === "completed") {
    return ["Start the next goal or archive this completed run context."];
  }
  if (status === "needs_clarification") {
    return ["Provide clarification answers, then rerun this goal."];
  }
  if (status === "verification_failed") {
    return ["Fix verification failures and rerun quality gates."];
  }
  if (status === "max_iterations") {
    return ["Increase iteration budget or narrow scope, then rerun."];
  }
  if (status === "canceled") {
    return ["Resume from latest checkpoint when ready."];
  }
  if (status === "in_progress") {
    return [`Resume from iteration ${String(nextIterationHint ?? 1)}.`];
  }
  return ["Review failed step output and rerun with a focused objective."];
}

function buildSingleAgentContinuationPacket(params: {
  runId: string;
  goal: string;
  status: AgentRunStatus | "in_progress";
  summary: string;
  remainingWork: string[];
  steps: AgentStep[];
  nextIterationHint?: number;
}): ContinuationPacket {
  const fallbackPending = collectRecentFailedStepSummaries(params.steps, 10);
  const pendingWork = (params.remainingWork.length > 0
    ? params.remainingWork
    : fallbackPending
  ).slice(0, 24);

  return {
    runId: params.runId,
    executionMode: "single",
    goal: params.goal,
    summary: truncate(params.summary || "Single-agent checkpoint snapshot.", 1200),
    pendingWork,
    nextActions: buildContinuationNextActions(params.status, params.nextIterationHint).slice(
      0,
      24
    ),
    createdAt: new Date().toISOString(),
  };
}

function buildSingleAgentMemoryCandidates(params: {
  goal: string;
  runId: string;
  status: AgentRunStatus;
  summary: string;
  dryRun: boolean;
  verificationPassed: boolean | null;
  verificationCommands: AgentCommand[];
  verificationChecks: VerificationCheckResult[];
  changedFiles: string[];
  steps: AgentStep[];
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

  const successfulMutations = params.steps
    .filter(
      (step) =>
        step.ok &&
        (step.action.type === "write_file" ||
          step.action.type === "append_file" ||
          step.action.type === "delete_file")
    )
    .slice(-8);

  const runTags = params.dryRun ? ["dry_run"] : [];

  if (params.status === "completed" && successfulMutations.length > 0) {
    entries.push({
      type: "fix_pattern",
      title: "Single-agent completion pattern",
      content: [
        `Summary: ${params.summary || "(none)"}`,
        `Changed files: ${params.changedFiles.join(", ") || "(none)"}`,
        `Successful mutations: ${successfulMutations.length}`,
        `Verification passed: ${String(params.verificationPassed)}`,
        ].join("\n"),
        tags: ["single_agent", "completion", ...params.changedFiles.slice(0, 5), ...runTags],
        successScore: 0.84,
        confidenceScore: 0.82,
        evidence: [
          {
            type: "run_summary",
            source: `run:${params.runId}`,
            summary: "Single-agent completion with successful mutations.",
            createdAt: new Date().toISOString(),
          },
        ],
        lastValidatedAt: new Date().toISOString(),
        sourceRunId: params.runId,
        sourceGoal: params.goal,
      });
    }

  const failedSteps = collectRecentFailedStepSummaries(params.steps, 6);
  if ((params.status !== "completed" || failedSteps.length > 0) && !params.dryRun) {
    entries.push({
      type: "bug_pattern",
        title: `Single-agent failure pattern (${params.status})`,
      content: [
        `Summary: ${params.summary || "(none)"}`,
        `Failed step traces: ${failedSteps.join(" | ") || "(none)"}`,
        `Changed files before failure: ${params.changedFiles.join(", ") || "(none)"}`,
        ].join("\n"),
        tags: ["single_agent", "failure", params.status, ...runTags],
        successScore: params.status === "completed" ? 0.45 : 0.22,
        confidenceScore: 0.42,
        evidence: [
          {
            type: "run_summary",
            source: `run:${params.runId}`,
            summary: "Failure captured from step traces and terminal summary.",
            createdAt: new Date().toISOString(),
          },
        ],
        sourceRunId: params.runId,
        sourceGoal: params.goal,
      });
    }

  if (params.verificationCommands.length > 0) {
      entries.push({
        type: "verification_rule",
        title: "Single-agent verification baseline",
      content: [
        `Commands: ${params.verificationCommands.map((command) => stringifyCommand(command)).join(" | ")}`,
        `Verification passed: ${String(params.verificationPassed)}`,
        `Failed checks: ${params.verificationChecks.filter((check) => !check.ok).length}`,
        ].join("\n"),
        tags: ["verification", "single_agent", ...runTags],
        pinned: params.verificationPassed === true,
        successScore: params.verificationPassed === false ? 0.4 : 0.76,
        confidenceScore: params.verificationPassed === false ? 0.45 : 0.82,
        evidence: [
          {
            type: "verification_result",
            source: `run:${params.runId}`,
            summary: `Verification checks captured: ${params.verificationChecks.length}`,
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
        title: "Clarification conventions (single-agent run)",
      content: Object.entries(params.clarificationAnswers)
        .map(([key, value]) => `${key}: ${value}`)
        .join("\n"),
        tags: ["clarification", "convention", "single_agent", ...runTags],
        successScore: 0.7,
        confidenceScore: 0.74,
        evidence: [
          {
            type: "human_feedback",
            source: `run:${params.runId}`,
            summary: "User-provided clarification answers captured.",
            createdAt: new Date().toISOString(),
          },
        ],
        sourceRunId: params.runId,
        sourceGoal: params.goal,
      });
    }

  entries.push({
    type: "project_convention",
    title: `Single-agent run summary (${params.status})`,
    content: params.summary || "(none)",
    tags: ["run_summary", "single_agent", params.status, ...runTags],
    successScore: params.status === "completed" ? 0.82 : 0.45,
    confidenceScore: params.status === "completed" ? 0.8 : 0.5,
    evidence: [
      {
        type: "run_summary",
        source: `run:${params.runId}`,
        summary: "Final single-agent run synthesis.",
        createdAt: new Date().toISOString(),
      },
    ],
    lastValidatedAt: new Date().toISOString(),
    sourceRunId: params.runId,
    sourceGoal: params.goal,
  });

  return entries.slice(0, 24);
}

function compactConversationHistory(
  history: ModelMessage[],
  compaction: ConversationCompactionState,
  iteration: number,
  memorySummary: string
): {
  history: ModelMessage[];
  compaction: ConversationCompactionState;
  compacted: boolean;
} {
  const historyTokens = estimateMessagesTokens(history);
  if (
    history.length <= CONTEXT_WINDOW_HARD_HISTORY_MESSAGES &&
    historyTokens <= CONTEXT_WINDOW_COMPACTION_TRIGGER_TOKENS
  ) {
    return { history, compaction, compacted: false };
  }

  if (history.length < 3) {
    return { history, compaction, compacted: false };
  }

  const [systemMessage, initialContextMessage] = history;
  const tail = history.slice(-28);
  const memoryMessage: ModelMessage = {
    role: "user",
    content: [
      "Conversation was compacted to protect context reliability.",
      memorySummary,
    ].join("\n\n"),
  };

  const nextHistory: ModelMessage[] = [
    systemMessage,
    initialContextMessage,
    memoryMessage,
    ...tail,
  ];

  const droppedMessages = Math.max(0, history.length - nextHistory.length);
  return {
    history: nextHistory,
    compacted: true,
    compaction: {
      summary: memorySummary,
      lastCompactedIteration: iteration,
      droppedMessages: compaction.droppedMessages + droppedMessages,
    },
  };
}

function buildBudgetedModelInput(params: {
  history: ModelMessage[];
  prompt: string;
  memorySummary: string;
  degradeLevel: number;
}): { messages: ModelMessage[]; droppedMessages: number; tokenEstimate: number } {
  const budget =
    CONTEXT_WINDOW_TOKEN_LEVELS[
      Math.min(params.degradeLevel, CONTEXT_WINDOW_TOKEN_LEVELS.length - 1)
    ];

  const history = params.history;
  if (history.length === 0) {
    const fallbackMessages: ModelMessage[] = [{ role: "user", content: params.prompt }];
    return {
      messages: fallbackMessages,
      droppedMessages: 0,
      tokenEstimate: estimateMessagesTokens(fallbackMessages),
    };
  }

  const anchors = history.slice(0, Math.min(2, history.length));
  const dynamicMemory: ModelMessage = {
    role: "user",
    content: params.memorySummary,
  };
  const promptMessage: ModelMessage = { role: "user", content: params.prompt };

  let tokenEstimate = estimateMessagesTokens([...anchors, dynamicMemory, promptMessage]);
  const selectable = history.slice(2);
  const selectedReverse: ModelMessage[] = [];

  for (let index = selectable.length - 1; index >= 0; index -= 1) {
    const candidate = selectable[index];
    const candidateTokens = estimateMessageTokens(candidate);
    const mustInclude = selectedReverse.length < CONTEXT_WINDOW_MIN_RECENT_MESSAGES;

    if (!mustInclude && tokenEstimate + candidateTokens > budget) {
      continue;
    }

    if (mustInclude && tokenEstimate + candidateTokens > budget) {
      const remainingTokens = Math.max(120, budget - tokenEstimate - 12);
      const clipped: ModelMessage = {
        role: candidate.role,
        content: truncate(candidate.content, remainingTokens * 4),
      };
      selectedReverse.push(clipped);
      tokenEstimate += estimateMessageTokens(clipped);
      continue;
    }

    selectedReverse.push(candidate);
    tokenEstimate += candidateTokens;
  }

  const selected = selectedReverse.reverse();
  const droppedMessages = Math.max(0, selectable.length - selected.length);
  const droppedNotice: ModelMessage | null =
    droppedMessages > 0
      ? {
          role: "user",
          content: `Context manager omitted ${droppedMessages} older message(s) to stay within the active reliability budget.`,
        }
      : null;

  const messages: ModelMessage[] = [
    ...anchors,
    dynamicMemory,
    ...(droppedNotice ? [droppedNotice] : []),
    ...selected,
    promptMessage,
  ];

  return {
    messages,
    droppedMessages,
    tokenEstimate: estimateMessagesTokens(messages),
  };
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await readFile(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, JSON.stringify(value), "utf-8");
}

async function appendRunEvent(
  persistence: RunPersistenceContext | null,
  type: string,
  payload: Record<string, unknown>
): Promise<void> {
  if (!persistence) return;
  const event = {
    timestamp: new Date().toISOString(),
    type,
    payload,
  };
  await appendFile(persistence.eventsPath, `${JSON.stringify(event)}\n`, "utf-8");
}

async function findResumeCheckpoint(
  rootDir: string,
  resumeKey: string,
  resumeRunId?: string
): Promise<RunCheckpointRecord | null> {
  if (resumeRunId && resumeRunId.trim().length > 0) {
    const checkpointPath = path.join(rootDir, resumeRunId.trim(), "checkpoint.json");
    const checkpoint = await readJsonFile<RunCheckpointRecord>(checkpointPath);
    if (!checkpoint) return null;
    if (checkpoint.resumeKey !== resumeKey) return null;
    if (checkpoint.status !== "in_progress") return null;
    if (isStaleRunTimestamp(checkpoint.updatedAt)) return null;
    return checkpoint;
  }

  const entries = await readdir(rootDir, { withFileTypes: true });
  const candidates: RunCheckpointMeta[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const metaPath = path.join(rootDir, entry.name, "meta.json");
    const meta = await readJsonFile<RunCheckpointMeta>(metaPath);
    if (!meta) continue;
    if (meta.resumeKey !== resumeKey) continue;
    if (meta.status !== "in_progress") continue;
    if (isStaleRunTimestamp(meta.updatedAt)) continue;
    candidates.push(meta);
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));

  for (const candidate of candidates) {
    const checkpointPath = path.join(rootDir, candidate.runId, "checkpoint.json");
    const checkpoint = await readJsonFile<RunCheckpointRecord>(checkpointPath);
    if (!checkpoint) continue;
    if (checkpoint.status !== "in_progress") continue;
    if (isStaleRunTimestamp(checkpoint.updatedAt)) continue;
    return checkpoint;
  }

  return null;
}

async function initializeRunPersistence(params: {
  workspace: string;
  goal: string;
  startedAt: string;
  resumeRunId?: string;
  resumeFromLastCheckpoint: boolean;
}): Promise<{
  persistence: RunPersistenceContext;
  resumeCheckpoint: RunCheckpointRecord | null;
}> {
  const rootDir = getRunStorageRoot();
  await mkdir(rootDir, { recursive: true });

  const resumeKey = buildResumeKey(params.workspace, params.goal);
  const resumeCheckpoint = params.resumeFromLastCheckpoint
    ? await findResumeCheckpoint(rootDir, resumeKey, params.resumeRunId)
    : null;

  const runId = randomUUID();
  const runDir = path.join(rootDir, runId);
  await mkdir(runDir, { recursive: true });

  const persistence: RunPersistenceContext = {
    runId,
    runDir,
    eventsPath: path.join(runDir, "events.ndjson"),
    checkpointPath: path.join(runDir, "checkpoint.json"),
    metaPath: path.join(runDir, "meta.json"),
    resumeKey,
    startedAt: params.startedAt,
    resumedFromRunId: resumeCheckpoint?.runId,
  };

  const meta: RunCheckpointMeta = {
    runId,
    resumeKey,
    workspace: params.workspace,
    goal: params.goal,
    startedAt: params.startedAt,
    updatedAt: params.startedAt,
    status: "in_progress",
    resumedFromRunId: resumeCheckpoint?.runId,
    lastIteration: resumeCheckpoint?.lastIteration ?? 0,
  };
  await writeJsonFile(persistence.metaPath, meta);
  await appendRunEvent(persistence, "run_started", {
    workspace: params.workspace,
    resumeKey,
    resumedFromRunId: resumeCheckpoint?.runId ?? null,
  });

  return { persistence, resumeCheckpoint };
}

async function persistRunCheckpoint(
  persistence: RunPersistenceContext | null,
  checkpoint: RunCheckpointRecord
): Promise<void> {
  if (!persistence) return;

  await writeJsonFile(persistence.checkpointPath, checkpoint);

  const meta: RunCheckpointMeta = {
    runId: checkpoint.runId,
    resumeKey: checkpoint.resumeKey,
    workspace: checkpoint.workspace,
    goal: checkpoint.goal,
    startedAt: checkpoint.startedAt,
    updatedAt: checkpoint.updatedAt,
    status: checkpoint.status,
    resumedFromRunId: checkpoint.resumedFromRunId,
    lastIteration: checkpoint.lastIteration,
  };
  await writeJsonFile(persistence.metaPath, meta);
}

function isRetryableModelError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const message = err.message || "";
  return (
    /Model API (?:error|timeout) \((408|429|5\d{2})\)/i.test(message) ||
    /Model API error (408|429|5\d{2})/i.test(message) ||
    /Model request timeout/i.test(message) ||
    /Model completion body timeout/i.test(message) ||
    /Connection error/i.test(message) ||
    /timed?\s*out/i.test(message) ||
    /operation was aborted/i.test(message)
  );
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function stringifyCommand(command: AgentCommand): string {
  const args = (command.args || []).map((arg) => {
    if (/^[a-zA-Z0-9._\-/=:@]+$/.test(arg)) return arg;
    return JSON.stringify(arg);
  });

  return `${command.program}${args.length > 0 ? ` ${args.join(" ")}` : ""}`;
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

function countLines(value: string): number {
  if (!value) return 0;
  return value.split("\n").length;
}

function summarizeContentChange(previous: string, next: string): string {
  if (previous === next) {
    return "No content changes";
  }

  const previousLines = countLines(previous);
  const nextLines = countLines(next);
  const delta = next.length - previous.length;

  const deltaText = delta >= 0 ? `+${delta}` : `${delta}`;

  return `Updated content (${previousLines} -> ${nextLines} lines, ${deltaText} chars)`;
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

function buildTeamRoster(teamSize: number): string[] {
  const roster: string[] = [];
  for (let index = 0; index < teamSize; index += 1) {
    const baseRole = TEAM_ROLE_POOL[index % TEAM_ROLE_POOL.length];
    const cycle = Math.floor(index / TEAM_ROLE_POOL.length) + 1;
    roster.push(cycle > 1 ? `${baseRole} ${cycle}` : baseRole);
  }
  return roster;
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
  const treeNodes = await buildTree(workspace, workspace, 0, 3);
  const treePreview = truncate(treeToString(treeNodes), 7000);
  const keyDirectories = treeNodes
    .filter((node) => node.type === "directory")
    .slice(0, 20)
    .map((node) => node.path);

  let packageScripts: string[] = [];
  let hasTests = false;

  try {
    const raw = await readFile(path.join(workspace, "package.json"), "utf-8");
    const parsed = JSON.parse(raw) as {
      scripts?: Record<string, string>;
    };
    const scripts = parsed.scripts || {};
    packageScripts = Object.keys(scripts).sort();
    hasTests = packageScripts.some((script) => /test/i.test(script));
  } catch {
    // Non-Node projects may not have package.json.
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

function formatIntelligenceForPrompt(projectIntelligence: ProjectIntelligence): string {
  const topSignals = projectIntelligence.signals
    .filter((signal) => signal.count > 0)
    .slice(0, 4)
    .map((signal) => `${signal.label}: ${signal.count} (${signal.severity})`);
  const topHotspots = projectIntelligence.hotspots
    .slice(0, 4)
    .map((hotspot) => `${hotspot.path} (${hotspot.lines} lines)`);

  return [
    `Summary: ${projectIntelligence.summary}`,
    `Stack: ${projectIntelligence.stack.join(", ") || "(unknown)"}`,
    `Top directories: ${projectIntelligence.topDirectories.join(", ") || "(none)"}`,
    `Test files: ${projectIntelligence.testFileCount}`,
    `Top risk signals: ${topSignals.join("; ") || "(none)"}`,
    `Top hotspots: ${topHotspots.join("; ") || "(none)"}`,
    `Module edges detected: ${projectIntelligence.moduleEdges.length}`,
  ].join("\n");
}

function buildClarificationQuestions(
  request: AgentRunRequest,
  projectDigest: ProjectDigest,
  projectIntelligence: ProjectIntelligence
): ClarificationQuestion[] {
  if (!request.requireClarificationBeforeEdits) return [];

  const answers = request.clarificationAnswers || {};
  const stackHints = Array.from(
    new Set(
      [...projectDigest.languageHints, ...projectIntelligence.stack]
        .map((value) => value.trim())
        .filter(Boolean)
    )
  ).slice(0, 6);
  const keyDirectories = projectDigest.keyDirectories.filter(Boolean).slice(0, 5);
  const hasTestScript = projectDigest.packageScripts.some((script) => /test/i.test(script));
  const supportsTests =
    projectDigest.hasTests || hasTestScript || projectIntelligence.testFileCount > 0;
  const highRiskSignals = projectIntelligence.signals.filter(
    (signal) => signal.severity === "high" && signal.count > 0
  );
  const mediumRiskSignals = projectIntelligence.signals.filter(
    (signal) => signal.severity === "medium" && signal.count > 0
  );
  const stackLabel = stackHints.join(", ") || "unknown stack";
  const scopeLabel = keyDirectories.join(", ") || "(no key directories detected)";
  const scriptsLabel = projectDigest.packageScripts.join(", ") || "(no scripts detected)";
  const goalSummary = truncate(request.goal, 180).replace(/\s+/g, " ");

  const questions: ClarificationQuestion[] = [
    {
      id: "goal_execution_mode",
      question: `I interpreted your goal as "${goalSummary}". Based on detected stack (${stackLabel}) and project areas (${scopeLabel}), which execution mode do you want?`,
      rationale: "Aligns implementation depth to your expected outcome before edits start.",
      required: true,
      options: [
        {
          id: "targeted_patch",
          label: "Targeted patch",
          value: "Use a targeted patch: minimal changes focused only on the requested behavior.",
          description: "Smallest safe change set.",
          recommended: true,
        },
        {
          id: "feature_complete",
          label: "Feature complete",
          value:
            "Use feature-complete mode: include required supporting refactors and tests needed to satisfy the goal.",
          description: "Balanced depth and quality.",
        },
        {
          id: "broad_refactor",
          label: "Broad refactor",
          value:
            "Allow broad refactoring where needed to deliver a robust long-term solution.",
          description: "Largest scope and runtime.",
        },
      ],
      allowCustomAnswer: true,
    },
    {
      id: "primary_scope",
      question:
        keyDirectories.length > 0
          ? `Detected top directories: ${keyDirectories.join(
              ", "
            )}. Which area should be the primary edit scope?`
          : "No strong directory hotspots were detected. Should edits be allowed across the whole workspace?",
      rationale: "Keeps edits constrained to the intended project area.",
      required: true,
      options:
        keyDirectories.length > 0
          ? [
              ...keyDirectories.map((directory, index) => ({
                id: `scope_${index + 1}`,
                label: directory,
                value: `Primary edit scope: ${directory}. Avoid unrelated directories unless strictly required.`,
                description: `Focus edits in ${directory}.`,
                recommended: index === 0,
              })),
              {
                id: "scope_workspace",
                label: "Whole workspace",
                value:
                  "Primary edit scope: whole workspace. Keep changes minimal but allow cross-directory updates when needed.",
                description: "Allow broader edits.",
              },
            ]
          : [
              {
                id: "scope_workspace_only",
                label: "Whole workspace",
                value:
                  "Allow edits across the workspace with minimal blast radius and explicit reporting of touched areas.",
                description: "No folder restrictions.",
                recommended: true,
              },
              {
                id: "scope_manual",
                label: "I will specify",
                value: "I will provide explicit path boundaries manually before edits begin.",
                description: "Manual constraints.",
              },
            ],
      allowCustomAnswer: true,
    },
    {
      id: "verification_level",
      question: `Detected test context: hasTests=${String(
        projectDigest.hasTests
      )}, testFileCount=${projectIntelligence.testFileCount}, scripts=${scriptsLabel}. Which verification level should I enforce?`,
      rationale: "Defines the quality gate required before completion.",
      required: true,
      options: [
        {
          id: "verify_standard",
          label: "Standard gates",
          value: "Run lint, typecheck, and build. Fix all failures before finalizing.",
          description: "Reliable default verification.",
          recommended: !supportsTests,
        },
        {
          id: "verify_with_tests",
          label: "Strict with tests",
          value:
            "Run lint, typecheck, build, and tests where available. Fix all failures before finalizing.",
          description: "Highest regression confidence.",
          recommended: supportsTests,
        },
        {
          id: "verify_light",
          label: "Light validation",
          value:
            "Run only targeted validation needed for this change and report residual risks explicitly.",
          description: "Fastest turnaround, lower confidence.",
        },
      ],
      allowCustomAnswer: true,
    },
    {
      id: "dependency_policy",
      question: `Detected stack hints: ${stackLabel}. What is the dependency policy for this run?`,
      rationale: "Prevents unwanted package churn and controls upgrade risk.",
      required: false,
      options: [
        {
          id: "deps_no_new",
          label: "No new dependencies",
          value: "Do not add new dependencies or upgrade existing versions.",
          description: "Most conservative.",
          recommended: true,
        },
        {
          id: "deps_if_needed",
          label: "Add if required",
          value:
            "Adding or upgrading dependencies is allowed only when necessary to meet requirements.",
          description: "Balanced policy.",
        },
        {
          id: "deps_allowed",
          label: "Dependencies allowed",
          value:
            "Dependency additions or upgrades are allowed if they improve correctness or maintainability.",
          description: "Least restrictive.",
        },
      ],
      allowCustomAnswer: true,
    },
  ];

  if (!projectDigest.hasTests && projectIntelligence.testFileCount === 0) {
    questions.push({
      id: "test_strategy",
      question:
        "I could not detect an obvious test suite. Should this run introduce tests as part of the implementation?",
      rationale: "Clarifies whether this run should invest in creating test coverage.",
      required: false,
      options: [
        {
          id: "test_create",
          label: "Create tests",
          value: "Introduce a minimal automated test strategy as part of this run.",
          description: "Increase future safety.",
          recommended: true,
        },
        {
          id: "test_no_create",
          label: "No new tests",
          value:
            "Do not create new tests in this run. Use non-test verification and report remaining risk.",
          description: "Keep scope focused.",
        },
      ],
      allowCustomAnswer: true,
    });
  }

  if (stackHints.length > 0) {
    questions.push({
      id: "stack_preference",
      question: `Detected stack hints: ${stackLabel}. Any preferred frameworks/libraries to prioritize?`,
      rationale: "Helps the agent choose conventions consistent with your preferred ecosystem.",
      required: false,
      options: stackHints.slice(0, 3).map((hint, index) => ({
        id: `stack_${index + 1}`,
        label: hint,
        value: `Prefer ${hint}-idiomatic patterns and tooling for this run.`,
        description: `Prioritize ${hint} conventions.`,
        recommended: index === 0,
      })),
      allowCustomAnswer: true,
    });
  }

  if (highRiskSignals.length > 0) {
    questions.push({
      id: "high_risk_signal_policy",
      question: `Detected high-risk signals (${highRiskSignals
        .map((signal) => `${signal.label}: ${signal.count}`)
        .join(", ")}). Should this run actively remediate these risks?`,
      rationale: "Controls whether high-risk cleanup is in-scope for this execution.",
      required: false,
      options: [
        {
          id: "risk_remediate",
          label: "Remediate now",
          value:
            "Include remediation of detected high-risk signals in this run when safe and relevant.",
          description: "Security-first behavior.",
          recommended: true,
        },
        {
          id: "risk_defer",
          label: "Defer risks",
          value:
            "Do not remediate unrelated high-risk signals now; report them as follow-up items.",
          description: "Keep scope tightly tied to the primary goal.",
        },
      ],
      allowCustomAnswer: true,
    });
  }

  if (highRiskSignals.length === 0 && mediumRiskSignals.length > 0) {
    questions.push({
      id: "medium_risk_signal_policy",
      question: `Detected medium-risk signals (${mediumRiskSignals
        .map((signal) => `${signal.label}: ${signal.count}`)
        .join(", ")}). How should I handle them during this run?`,
      rationale: "Balances delivery speed against proactive quality improvements.",
      required: false,
      options: [
        {
          id: "medium_fix_if_touched",
          label: "Fix if touched",
          value:
            "If work touches these areas, remediate medium-risk issues before finalizing.",
          description: "Pragmatic and efficient.",
          recommended: true,
        },
        {
          id: "medium_report_only",
          label: "Report only",
          value:
            "Keep scope on primary goal and report medium-risk findings as follow-up recommendations.",
          description: "Fastest path to delivery.",
        },
      ],
      allowCustomAnswer: true,
    });
  }

  return questions.filter((question) => {
    const answer = answers[question.id];
    return typeof answer !== "string" || answer.trim().length === 0;
  });
}

function formatClarificationAnswers(answers: Record<string, string>): string {
  const entries = Object.entries(answers).filter(([, value]) => value.trim().length > 0);
  if (entries.length === 0) return "(none)";
  return entries.map(([key, value]) => `- ${key}: ${value.trim()}`).join("\n");
}

function recordJournal(
  context: ToolContext,
  op: ChangeJournalEntry["op"],
  filePath: string,
  details: string
) {
  context.changeJournal.push({
    op,
    path: filePath,
    timestamp: new Date().toISOString(),
    details,
  });
}

async function loadSnapshotIfMissing(filePath: string, context: ToolContext): Promise<void> {
  if (context.request.dryRun) return;
  if (context.changeSnapshots.has(filePath)) return;

  const absolute = normalizePathForWorkspace(filePath, context.workspace);

  try {
    const previousContent = await readFile(absolute, "utf-8");
    context.changeSnapshots.set(filePath, {
      path: filePath,
      existed: true,
      previousContent,
    });
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    if (error.code === "ENOENT") {
      context.changeSnapshots.set(filePath, {
        path: filePath,
        existed: false,
        previousContent: "",
      });
      return;
    }
    throw err;
  }
}

async function rollbackChanges(
  context: ToolContext,
  hooks?: AgentRunHooks
): Promise<{ applied: boolean; summary: string[] }> {
  if (context.request.dryRun) {
    return { applied: false, summary: ["Dry-run mode: rollback skipped."] };
  }

  if (context.changeSnapshots.size === 0) {
    return { applied: false, summary: ["No file mutations recorded for rollback."] };
  }

  const snapshots = Array.from(context.changeSnapshots.values()).reverse();
  const summary: string[] = [];

  emit(hooks, {
    type: "status",
    data: {
      message: "Applying rollback to restore pre-run file state.",
    },
  });

  for (const snapshot of snapshots) {
    const absolute = normalizePathForWorkspace(snapshot.path, context.workspace);
    try {
      if (snapshot.existed) {
        await mkdir(path.dirname(absolute), { recursive: true });
        await writeFile(absolute, snapshot.previousContent, "utf-8");
        summary.push(`Restored ${snapshot.path}`);
      } else {
        await unlink(absolute).catch((err) => {
          const error = err as NodeJS.ErrnoException;
          if (error.code !== "ENOENT") {
            throw err;
          }
        });
        summary.push(`Removed created file ${snapshot.path}`);
      }
    } catch (err) {
      summary.push(
        `Failed to rollback ${snapshot.path}: ${
          err instanceof Error ? err.message : "unknown error"
        }`
      );
    }
  }

  return {
    applied: true,
    summary,
  };
}

async function toolListTree(
  maxDepth: number | undefined,
  workspace: string
): Promise<ToolResult> {
  const depth = maxDepth && maxDepth > 0 ? Math.min(maxDepth, 8) : 4;
  const tree = await buildTree(workspace, workspace, 0, depth);

  return {
    ok: true,
    summary: `Workspace tree loaded at depth ${depth}`,
    output: truncate(treeToString(tree) || "(empty workspace)", RESPONSE_OUTPUT_LIMIT),
  };
}

async function toolSearchFiles(
  pattern: string,
  workspace: string,
  glob?: string,
  maxResults?: number
): Promise<ToolResult> {
  const trimmedPattern = pattern.trim();
  if (!trimmedPattern) {
    return {
      ok: false,
      summary: "Pattern cannot be empty",
      output: "",
    };
  }

  const limit = Math.max(1, Math.min(maxResults ?? 80, 250));

  const args = [
    "--line-number",
    "--color",
    "never",
    "--no-heading",
    "--max-count",
    String(limit),
  ];

  if (glob?.trim()) {
    args.push("--glob", glob.trim());
  }

  args.push(trimmedPattern, workspace);

  try {
    const { stdout } = await execFileAsync("rg", args, {
      timeout: 20000,
      maxBuffer: MAX_COMMAND_BUFFER,
    });

    const lines = stdout
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const match = line.match(/^(.*?):(\d+):(.*)$/);
        if (!match) return line;

        const [, filePath, lineNumber, content] = match;
        const relative = path.relative(workspace, filePath);
        return `${relative}:${lineNumber}: ${content}`;
      });

    return {
      ok: true,
      summary: `Found ${lines.length} matching lines`,
      output: truncate(lines.join("\n") || "No matches", RESPONSE_OUTPUT_LIMIT),
    };
  } catch (err) {
    const error = err as {
      code?: number;
      stderr?: string;
      message?: string;
    };

    if (error.code === 1) {
      return {
        ok: true,
        summary: "No matches found",
        output: "No matches",
      };
    }

    return {
      ok: false,
      summary: "Failed to search files",
      output: truncate(
        error.stderr || error.message || "Unknown search error",
        RESPONSE_OUTPUT_LIMIT
      ),
    };
  }
}

async function readFileWithOptionalRange(
  filePath: string,
  workspace: string,
  startLine?: number,
  endLine?: number
): Promise<ToolResult> {
  const absolute = normalizePathForWorkspace(filePath, workspace);
  const ext = path.extname(absolute).toLowerCase();

  if (BINARY_EXTENSIONS.has(ext)) {
    return {
      ok: false,
      summary: "Cannot read binary file",
      output: `Binary file detected: ${filePath}`,
    };
  }

  const raw = await readFile(absolute, "utf-8");
  const content = raw.length > MAX_FILE_SIZE ? truncate(raw, MAX_FILE_SIZE) : raw;

  if (startLine || endLine) {
    const lines = content.split("\n");
    const from = Math.max(1, startLine || 1);
    const to = Math.min(lines.length, endLine || lines.length);

    const sliced = lines
      .slice(from - 1, to)
      .map((line, idx) => `${from + idx}: ${line}`)
      .join("\n");

    return {
      ok: true,
      summary: `Read ${Math.max(0, to - from + 1)} lines from ${filePath}`,
      output: truncate(sliced, RESPONSE_OUTPUT_LIMIT),
    };
  }

  return {
    ok: true,
    summary: `Read file ${filePath} (${content.length} chars)`,
    output: truncate(content, RESPONSE_OUTPUT_LIMIT),
  };
}

async function toolReadFile(
  filePath: string,
  workspace: string,
  startLine?: number,
  endLine?: number
): Promise<ToolResult> {
  return readFileWithOptionalRange(filePath, workspace, startLine, endLine);
}

async function toolReadManyFiles(
  paths: string[],
  workspace: string,
  maxLinesPerFile?: number
): Promise<ToolResult> {
  if (!paths.length) {
    return {
      ok: false,
      summary: "No paths provided",
      output: "",
    };
  }

  const normalized = paths
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 12);

  if (normalized.length === 0) {
    return {
      ok: false,
      summary: "No valid paths provided",
      output: "",
    };
  }

  const lineLimit = clampNumber(maxLinesPerFile, 200, 20, 800);
  const blocks: string[] = [];

  for (const filePath of normalized) {
    try {
      const result = await readFileWithOptionalRange(filePath, workspace, 1, lineLimit);
      blocks.push(`# ${filePath}\n${result.output}`);
    } catch (err) {
      blocks.push(
        `# ${filePath}\nError: ${err instanceof Error ? err.message : "read failure"}`
      );
    }
  }

  return {
    ok: true,
    summary: `Read ${normalized.length} file(s)`,
    output: truncate(blocks.join("\n\n"), RESPONSE_OUTPUT_LIMIT),
  };
}

async function toolWriteFile(
  filePath: string,
  content: string,
  context: ToolContext
): Promise<ToolResult> {
  const absolute = normalizePathForWorkspace(filePath, context.workspace);

  if (context.fileWriteCount >= context.request.maxFileWrites) {
    return {
      ok: false,
      summary: "File write budget exceeded",
      output: `maxFileWrites=${context.request.maxFileWrites}`,
    };
  }

  await loadSnapshotIfMissing(filePath, context);

  let previous = "";
  try {
    previous = await readFile(absolute, "utf-8");
  } catch {
    previous = "";
  }

  const changeSummary = summarizeContentChange(previous, content);

  if (context.request.dryRun) {
    context.fileWriteCount += 1;
    recordJournal(context, "write", filePath, `[dry-run] ${changeSummary}`);
    return {
      ok: true,
      summary: `[dry-run] Would write ${filePath}`,
      output: changeSummary,
    };
  }

  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, content, "utf-8");

  context.fileWriteCount += 1;
  context.changedFiles.add(toRelativeWorkspacePath(absolute, context.workspace));
  recordJournal(context, "write", filePath, changeSummary);

  return {
    ok: true,
    summary: `Wrote ${content.length} chars to ${filePath}`,
    output: changeSummary,
  };
}

async function toolAppendFile(
  filePath: string,
  content: string,
  context: ToolContext
): Promise<ToolResult> {
  const absolute = normalizePathForWorkspace(filePath, context.workspace);

  if (context.fileWriteCount >= context.request.maxFileWrites) {
    return {
      ok: false,
      summary: "File write budget exceeded",
      output: `maxFileWrites=${context.request.maxFileWrites}`,
    };
  }

  await loadSnapshotIfMissing(filePath, context);

  let previous = "";
  try {
    previous = await readFile(absolute, "utf-8");
  } catch {
    previous = "";
  }

  const next = `${previous}${content}`;
  const changeSummary = summarizeContentChange(previous, next);

  if (context.request.dryRun) {
    context.fileWriteCount += 1;
    recordJournal(context, "append", filePath, `[dry-run] ${changeSummary}`);
    return {
      ok: true,
      summary: `[dry-run] Would append to ${filePath}`,
      output: changeSummary,
    };
  }

  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, next, "utf-8");
  context.fileWriteCount += 1;
  context.changedFiles.add(toRelativeWorkspacePath(absolute, context.workspace));
  recordJournal(context, "append", filePath, changeSummary);

  return {
    ok: true,
    summary: `Appended ${content.length} chars to ${filePath}`,
    output: changeSummary,
  };
}

async function toolDeleteFile(filePath: string, context: ToolContext): Promise<ToolResult> {
  const absolute = normalizePathForWorkspace(filePath, context.workspace);

  if (context.fileWriteCount >= context.request.maxFileWrites) {
    return {
      ok: false,
      summary: "File write budget exceeded",
      output: `maxFileWrites=${context.request.maxFileWrites}`,
    };
  }

  if (context.request.dryRun) {
    context.fileWriteCount += 1;
    recordJournal(context, "delete", filePath, "[dry-run] Deletion skipped");
    return {
      ok: true,
      summary: `[dry-run] Would delete ${filePath}`,
      output: "Deletion skipped in dry-run mode",
    };
  }

  await loadSnapshotIfMissing(filePath, context);
  try {
    await unlink(absolute);
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    if (error.code === "ENOENT") {
      return {
        ok: false,
        summary: `Delete failed: file not found (${filePath})`,
        output: "File does not exist",
      };
    }
    throw err;
  }
  context.fileWriteCount += 1;
  context.changedFiles.add(toRelativeWorkspacePath(absolute, context.workspace));
  recordJournal(context, "delete", filePath, "File deleted");

  return {
    ok: true,
    summary: `Deleted ${filePath}`,
    output: "File deleted",
  };
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

function normalizeCommand(program: string, argsInput: unknown, cwd?: string): AgentCommand {
  const safeProgram = program.trim();
  if (!safeProgram) {
    throw new Error("Command program cannot be empty");
  }

  if (!argsInput) {
    validateProgramAndArgs(safeProgram, []);
    return {
      program: safeProgram,
      args: [],
      cwd,
    };
  }

  if (!Array.isArray(argsInput)) {
    throw new Error("Command args must be an array of strings");
  }

  const args = argsInput.map((arg) => {
    if (typeof arg !== "string") {
      throw new Error("Command args must only contain strings");
    }
    return arg;
  });

  validateProgramAndArgs(safeProgram, args);

  return {
    program: safeProgram,
    args,
    cwd,
  };
}

async function runCommand(
  command: AgentCommand,
  context: ToolContext
): Promise<ToolResult> {
  const normalized = normalizeCommand(command.program, command.args || [], command.cwd);

  if (context.commandRunCount >= context.request.maxCommandRuns) {
    return {
      ok: false,
      summary: "Command budget exceeded",
      output: `maxCommandRuns=${context.request.maxCommandRuns}`,
    };
  }

  const execCwd = normalized.cwd
    ? normalizePathForWorkspace(normalized.cwd, context.workspace)
    : context.workspace;
  const commandString = stringifyCommand({
    program: normalized.program,
    args: normalized.args,
    cwd: normalized.cwd,
  });

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

  try {
    const { stdout, stderr } = await execFileAsync(
      normalized.program,
      normalized.args || [],
      {
        cwd: execCwd,
        timeout: COMMAND_TIMEOUT_MS,
        maxBuffer: MAX_COMMAND_BUFFER,
        env: commandEnv,
      }
    );

    const output = [stdout, stderr].filter(Boolean).join("\n").trim();
    return {
      ok: true,
      summary: `Command succeeded: ${commandString}`,
      output: truncate(output || "(no output)", RESPONSE_OUTPUT_LIMIT),
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
    };
  }
}

async function toolRunCommand(
  program: string,
  argsInput: unknown,
  cwd: string | undefined,
  context: ToolContext
): Promise<ToolResult> {
  const command = normalizeCommand(program, argsInput, cwd);
  return runCommand(command, context);
}

async function toolWebSearch(query: string): Promise<ToolResult> {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    return {
      ok: false,
      summary: "Search query cannot be empty",
      output: "",
    };
  }

  const scriptPath = path.join(getDefaultWorkspacePath(), "scripts", "search.py");

  try {
    const { stdout } = await execFileAsync("python3", [scriptPath, trimmedQuery], {
      timeout: 20000,
      maxBuffer: MAX_COMMAND_BUFFER,
    });

    const parsed = JSON.parse(stdout) as
      | {
          error?: string;
        }
      | Array<{
          title?: string;
          url?: string;
          snippet?: string;
        }>;

    if (!Array.isArray(parsed)) {
      return {
        ok: false,
        summary: "Search script returned error",
        output: truncate(parsed.error || "Unknown search error", RESPONSE_OUTPUT_LIMIT),
      };
    }

    const lines = parsed.slice(0, 8).map((result, index) => {
      return `${index + 1}. ${result.title || "(no title)"}\nURL: ${result.url || ""}\n${result.snippet || ""}`;
    });

    return {
      ok: true,
      summary: `Found ${parsed.length} web results for '${trimmedQuery}'`,
      output: truncate(lines.join("\n\n") || "No search results", RESPONSE_OUTPUT_LIMIT),
    };
  } catch (err) {
    const error = err as { stderr?: string; message?: string };
    return {
      ok: false,
      summary: "Web search failed",
      output: truncate(error.stderr || error.message || "Search failure", RESPONSE_OUTPUT_LIMIT),
    };
  }
}

async function executeAction(action: AgentAction, context: ToolContext): Promise<ToolResult> {
  try {
    switch (action.type) {
      case "list_tree":
        return toolListTree(action.maxDepth, context.workspace);
      case "search_files":
        return toolSearchFiles(
          action.pattern,
          context.workspace,
          action.glob,
          action.maxResults
        );
      case "read_file":
        return toolReadFile(action.path, context.workspace, action.startLine, action.endLine);
      case "read_many_files":
        return toolReadManyFiles(action.paths, context.workspace, action.maxLinesPerFile);
      case "write_file":
        return toolWriteFile(action.path, action.content, context);
      case "append_file":
        return toolAppendFile(action.path, action.content, context);
      case "delete_file":
        return toolDeleteFile(action.path, context);
      case "run_command":
        return toolRunCommand(action.program, action.args, action.cwd, context);
      case "web_search":
        return toolWebSearch(action.query);
      case "final":
        return {
          ok: true,
          summary: "Received final response",
          output: action.summary,
        };
      default:
        return {
          ok: false,
          summary: "Unknown action",
          output: "",
        };
    }
  } catch (err) {
    return {
      ok: false,
      summary: `Action failed: ${action.type}`,
      output: err instanceof Error ? err.message : "Unknown action error",
    };
  }
}

function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();

  try {
    return JSON.parse(trimmed);
  } catch {
    // Continue with extraction fallback
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

function ensureString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Field '${field}' must be a non-empty string`);
  }

  return value;
}

function ensureOptionalStringArray(value: unknown, field: string): string[] | undefined {
  if (value === undefined) return undefined;

  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`Field '${field}' must be an array of strings`);
  }

  return value as string[];
}

function normalizeActionType(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function parseDecision(rawResponse: string): AgentDecision {
  const parsed = extractJsonObject(rawResponse) as {
    thinking?: unknown;
    type?: unknown;
    action?: unknown;
    [key: string]: unknown;
  };

  const thinking =
    typeof parsed.thinking === "string" && parsed.thinking.trim().length > 0
      ? parsed.thinking.trim()
      : "No explicit reasoning provided.";

  let actionPayload: { type?: unknown; [key: string]: unknown } | null = null;

  if (parsed.action && typeof parsed.action === "object" && !Array.isArray(parsed.action)) {
    actionPayload = parsed.action as { type?: unknown; [key: string]: unknown };
  } else if (typeof parsed.action === "string") {
    actionPayload = { type: parsed.action };
  } else if (typeof parsed.type === "string") {
    actionPayload = parsed;
  }

  if (!actionPayload) {
    throw new Error("Missing action object");
  }

  const actionType = ensureString(actionPayload.type, "action.type");
  const normalizedActionType = normalizeActionType(actionType);

  let action: AgentAction;

  switch (normalizedActionType) {
    case "list_tree":
      action = {
        type: "list_tree",
        maxDepth:
          typeof actionPayload.maxDepth === "number"
            ? actionPayload.maxDepth
            : undefined,
      };
      break;
    case "search_files":
      action = {
        type: "search_files",
        pattern: ensureString(actionPayload.pattern, "action.pattern"),
        glob: typeof actionPayload.glob === "string" ? actionPayload.glob : undefined,
        maxResults:
          typeof actionPayload.maxResults === "number"
            ? actionPayload.maxResults
            : undefined,
      };
      break;
    case "read_file":
      action = {
        type: "read_file",
        path: ensureString(actionPayload.path, "action.path"),
        startLine:
          typeof actionPayload.startLine === "number"
            ? actionPayload.startLine
            : undefined,
        endLine:
          typeof actionPayload.endLine === "number"
            ? actionPayload.endLine
            : undefined,
      };
      break;
    case "read_many_files": {
      const paths = actionPayload.paths;
      if (!Array.isArray(paths) || paths.some((item) => typeof item !== "string")) {
        throw new Error("Field 'action.paths' must be an array of strings");
      }
      action = {
        type: "read_many_files",
        paths,
        maxLinesPerFile:
          typeof actionPayload.maxLinesPerFile === "number"
            ? actionPayload.maxLinesPerFile
            : undefined,
      };
      break;
    }
    case "write_file":
      action = {
        type: "write_file",
        path: ensureString(actionPayload.path, "action.path"),
        content: ensureString(actionPayload.content, "action.content"),
      };
      break;
    case "append_file":
      action = {
        type: "append_file",
        path: ensureString(actionPayload.path, "action.path"),
        content: ensureString(actionPayload.content, "action.content"),
      };
      break;
    case "delete_file":
      action = {
        type: "delete_file",
        path: ensureString(actionPayload.path, "action.path"),
      };
      break;
    case "run_command":
      action = {
        type: "run_command",
        program: ensureString(actionPayload.program, "action.program"),
        args: Array.isArray(actionPayload.args)
          ? (actionPayload.args as string[])
          : undefined,
        cwd: typeof actionPayload.cwd === "string" ? actionPayload.cwd : undefined,
      };
      break;
    case "web_search":
      action = {
        type: "web_search",
        query: ensureString(actionPayload.query, "action.query"),
      };
      break;
    case "final":
      action = {
        type: "final",
        summary: ensureString(actionPayload.summary, "action.summary"),
        verification: ensureOptionalStringArray(
          actionPayload.verification,
          "action.verification"
        ),
        remainingWork: ensureOptionalStringArray(
          actionPayload.remainingWork,
          "action.remainingWork"
        ),
      };
      break;
    default:
      throw new Error(`Unsupported action type: ${actionType}`);
  }

  return {
    thinking,
    action,
  };
}

function buildSystemPrompt(): string {
  return `You are an autonomous principal software engineer operating directly in a coding workspace.

Objective:
- Complete the user's requested engineering task end-to-end with production-level quality.
- Keep iterating until quality gates pass or you hit hard limits.

Behavior rules:
1. Discover context first (list/search/read) before editing.
2. Prefer minimal, high-leverage edits.
3. Use read_many_files when several files are needed.
4. Use run_command for verification and diagnostics.
5. Do not claim completion until the quality gates pass.
6. If a quality gate fails, fix root cause and retry.
7. Respect budgets: file writes and command runs are limited.
8. If in dry-run mode, still plan and verify, but do not perform real file mutations.
9. Treat the run as a coordinated multi-person team execution with role-based discipline.
10. If active skill documents are provided, treat them as mandatory execution guidance before planning or edits.

Response format:
- Return ONLY one JSON object.
- Do not add markdown or extra text.
- Shape:
{
  "thinking": "short deterministic reasoning",
  "action": {
    "type": "list_tree | search_files | read_file | read_many_files | write_file | append_file | delete_file | run_command | web_search | final",
    "...fields": "based on action"
  }
}

Action schemas:
- list_tree: {"type":"list_tree","maxDepth":4}
- search_files: {"type":"search_files","pattern":"...","glob":"optional","maxResults":120}
- read_file: {"type":"read_file","path":"src/app/page.tsx","startLine":1,"endLine":240}
- read_many_files: {"type":"read_many_files","paths":["src/a.ts","src/b.ts"],"maxLinesPerFile":220}
- write_file: {"type":"write_file","path":"src/file.ts","content":"full file content"}
- append_file: {"type":"append_file","path":"notes.md","content":"\nnew notes"}
- delete_file: {"type":"delete_file","path":"src/old.ts"}
- run_command: {"type":"run_command","program":"pnpm","args":["-s","lint"],"cwd":"."}
- web_search: {"type":"web_search","query":"official docs ..."}
- final: {"type":"final","summary":"...","verification":["..."],"remainingWork":["..."]}

Always choose the single best next action.`;
}

function buildActiveSkillsInstruction(skillDocuments: SkillDocument[]): string {
  if (skillDocuments.length === 0) {
    return "";
  }

  let remainingChars = MAX_SKILL_CONTEXT_TOTAL_CHARS;
  const lines: string[] = [
    "Active skill documents are enabled for this run.",
    "Apply these skills before planning, coding, or verification.",
    "When skills overlap, prioritize the most specific skill while preserving safety and quality gates.",
    "",
  ];

  for (let index = 0; index < skillDocuments.length; index += 1) {
    if (remainingChars <= 0) break;

    const skill = skillDocuments[index];
    const allowedChars = Math.min(remainingChars, MAX_SKILL_CONTEXT_PER_FILE_CHARS);
    const content = truncate(skill.content, allowedChars);
    remainingChars -= content.length;

    lines.push(
      `### Skill ${index + 1}: ${skill.name}`,
      `Path: ${skill.relativePath}`,
      content,
      ""
    );
  }

  return lines.join("\n").trim();
}

function buildInitialMessage(
  request: AgentRunRequest,
  workspace: string,
  initialTree: string,
  teamRoster: string[],
  projectDigest: ProjectDigest,
  projectIntelligence: ProjectIntelligence,
  longTermMemoryBlock: string,
  continuationHint: string,
  memoryDiagnosticsHint: string
): string {
  const languageGuidance = buildLanguageGuidanceBlock(
    projectDigest.languageHints,
    projectIntelligence.stack
  );
  const verificationCommands =
    request.verificationCommands.length > 0
      ? request.verificationCommands.map((command) => `- ${stringifyCommand(command)}`).join("\n")
      : "- (none)";
  const rosterPreview = teamRoster.slice(0, 25).join(", ");
  const rosterSuffix =
    teamRoster.length > 25
      ? ` ... (+${teamRoster.length - 25} more roles)`
      : "";

  return [
    `Time: ${new Date().toISOString()}`,
    `Workspace: ${workspace}`,
    `Max iterations: ${
      isUnboundedIterationMode(request.maxIterations)
        ? "unbounded (0)"
        : request.maxIterations
    }`,
    `Budgets: maxFileWrites=${request.maxFileWrites}, maxCommandRuns=${request.maxCommandRuns}`,
    `Strict verification: ${request.strictVerification}`,
    `Auto-fix verification failures: ${request.autoFixVerification}`,
    `Dry run: ${request.dryRun}`,
    `Rollback on failure: ${request.rollbackOnFailure}`,
    `Team size: ${request.teamSize}`,
    "",
    "Verification commands:",
    verificationCommands,
    "",
    "Team roster:",
    `${rosterPreview}${rosterSuffix}`,
    "",
    "Project digest:",
    `- Key directories: ${projectDigest.keyDirectories.join(", ") || "(none detected)"}`,
    `- Language hints: ${projectDigest.languageHints.join(", ") || "(unknown)"}`,
    `- Has tests: ${projectDigest.hasTests}`,
    `- package scripts: ${projectDigest.packageScripts.join(", ") || "(none detected)"}`,
    "",
    "Project intelligence:",
    formatIntelligenceForPrompt(projectIntelligence),
    "",
    "Language-specific guidance:",
    languageGuidance,
    "",
    "Retrieved long-term memory:",
    longTermMemoryBlock || "(none)",
    "",
    "Continuation hint:",
    continuationHint || "(none)",
    "",
    "Memory diagnostics:",
    memoryDiagnosticsHint || "(none)",
    "",
    "Clarification answers provided by the user:",
    formatClarificationAnswers(request.clarificationAnswers),
    "",
    "User goal:",
    request.goal,
    "",
    "Initial workspace tree (depth 2):",
    initialTree || "(empty)",
    "",
    "Start with the best next action.",
  ].join("\n");
}

function formatMemoryDiagnosticsForPrompt(
  diagnostics: MemoryRetrievalDiagnostics | undefined
): string {
  if (!diagnostics) return "(none)";
  if (diagnostics.conflictCount === 0) {
    return "No contradictory memory pairs detected.";
  }
  const lines = [
    `Conflict count: ${diagnostics.conflictCount}`,
    ...diagnostics.conflicts.slice(0, 5).map((conflict, index) => {
      return `${index + 1}. ${conflict.reason} topic=${conflict.topicTokens.join(",") || "(unspecified)"} ids=${conflict.firstEntryId} vs ${conflict.secondEntryId}`;
    }),
    ...diagnostics.guidance.map((line) => `- ${line}`),
  ];
  return lines.join("\n");
}

function isMutationAction(action: AgentAction): boolean {
  return (
    action.type === "write_file" ||
    action.type === "append_file" ||
    action.type === "delete_file"
  );
}

function goalLikelyRequiresCodeMutation(goal: string): boolean {
  return /(?:create|write|implement|build|fix|refactor|add|generate|code|project|file|backend|frontend)/i.test(
    goal
  );
}

function summarizeActionForStagnation(action: AgentAction): string {
  switch (action.type) {
    case "read_file":
      return `read_file:${action.path}`;
    case "read_many_files":
      return `read_many_files:${action.paths.slice(0, 4).join(",")}`;
    case "search_files":
      return `search_files:${action.pattern}:${action.glob || "*"}`;
    case "run_command":
      return `run_command:${stringifyCommand({
        program: action.program,
        args: action.args || [],
        cwd: action.cwd,
      })}`;
    case "write_file":
    case "append_file":
    case "delete_file":
      return `${action.type}:${action.path}`;
    case "list_tree":
      return `list_tree:${String(action.maxDepth ?? 4)}`;
    case "web_search":
      return `web_search:${action.query}`;
    case "final":
      return "final";
    default:
      return "unknown_action";
  }
}

function buildMutationStagnationMessage(streak: number): string {
  return [
    `Stagnation guard: ${streak} consecutive non-mutation iterations on a coding goal.`,
    "Stop exploring loops and execute one concrete file mutation now (write_file/append_file/delete_file) that directly advances the requested outcome.",
    "Then continue verification.",
  ].join("\n");
}

function buildRepeatedActionStagnationMessage(signature: string, streak: number): string {
  return [
    `Stagnation guard: repeated action pattern detected (${streak}x): ${signature}`,
    "Do not repeat this same action again unless new evidence is required.",
    "Choose a different high-leverage next action that changes state or verifies a new hypothesis.",
  ].join("\n");
}

function isEvidenceAction(action: AgentAction): boolean {
  return (
    action.type === "read_file" ||
    action.type === "read_many_files" ||
    action.type === "run_command" ||
    action.type === "search_files"
  );
}

function findLastEvidenceIteration(steps: AgentStep[]): number {
  let last = 0;
  for (const step of steps) {
    if (step.ok && isEvidenceAction(step.action)) {
      last = Math.max(last, step.iteration);
    }
  }
  return last;
}

function buildIterationPrompt(iteration: number, maxIterations: number): string {
  return `Iteration ${iteration}/${formatIterationBudget(
    maxIterations
  )}. Return only one valid action JSON.`;
}

function buildToolFeedback(result: ToolResult, context: ToolContext): string {
  return [
    "Tool execution result:",
    `ok: ${result.ok}`,
    `summary: ${result.summary}`,
    "output:",
    truncate(result.output, MODEL_OUTPUT_LIMIT),
    "",
    `budget usage: fileWrites=${context.fileWriteCount}/${context.request.maxFileWrites}, commandRuns=${context.commandRunCount}/${context.request.maxCommandRuns}`,
    "",
    "Choose the next action. If the task is complete and quality gates are expected to pass, use action.type='final'.",
  ].join("\n");
}

function buildVerificationFailureFeedback(
  attempt: number,
  checks: VerificationCheckResult[]
): string {
  const lines = checks.map((check, index) => {
    const status = check.ok ? "PASS" : "FAIL";
    return [
      `${index + 1}. ${status} ${stringifyCommand(check.command)}`,
      truncate(check.output, 1500),
    ].join("\n");
  });

  return [
    `Quality gate attempt ${attempt} failed. Fix root causes and continue.`,
    "Do not finalize yet.",
    "",
    ...lines,
  ].join("\n\n");
}

async function getDecision(
  history: ModelMessage[],
  iteration: number,
  maxIterations: number,
  modelOverride: string | undefined,
  modelConfig: Partial<ModelConfig> | undefined,
  memorySummary: string,
  signal?: AbortSignal
): Promise<{
  raw: string;
  decision: AgentDecision;
  contextDiagnostics: {
    degradeLevel: number;
    droppedMessages: number;
    tokenEstimate: number;
  };
}> {
  let correction = "";
  let degradeLevel = 0;
  let lastRawContent = "";
  let lastParseError = "";
  let lastDroppedMessages = 0;
  let lastTokenEstimate = 0;

  for (let attempt = 1; attempt <= 8; attempt += 1) {
    throwIfAborted(signal);

    const prompt = correction || buildIterationPrompt(iteration, maxIterations);
    const budgetedInput = buildBudgetedModelInput({
      history,
      prompt,
      memorySummary,
      degradeLevel,
    });
    lastDroppedMessages = budgetedInput.droppedMessages;
    lastTokenEstimate = budgetedInput.tokenEstimate;

    let content: string;
    try {
      ({ content } = await completeModel(budgetedInput.messages, {
        model: modelOverride,
        temperature: 0.1,
        maxTokens: 1600,
        modelConfig,
        signal,
      }));
      lastRawContent = content;
    } catch (err) {
      if (signal?.aborted) {
        throw new RunCanceledError("Run canceled by user");
      }

      if (!isRetryableModelError(err)) {
        throw err;
      }

      const canDegrade = degradeLevel < CONTEXT_WINDOW_TOKEN_LEVELS.length - 1;
      if (canDegrade) {
        degradeLevel += 1;
      }

      const backoffMs = Math.min(6500, 250 * 2 ** (attempt - 1));
      await sleep(backoffMs);
      correction =
        "The previous model request failed at the transport/provider layer. Continue from existing context and return the next valid action JSON.";
      continue;
    }

    try {
      const decision = parseDecision(content);
      return {
        raw: content,
        decision,
        contextDiagnostics: {
          degradeLevel,
          droppedMessages: budgetedInput.droppedMessages,
          tokenEstimate: budgetedInput.tokenEstimate,
        },
      };
    } catch (err) {
      lastParseError = err instanceof Error ? err.message : "parse error";
      correction = `Your previous output was invalid (${err instanceof Error ? err.message : "parse error"}). Return exactly one valid JSON object with the required schema.`;
      if (degradeLevel < CONTEXT_WINDOW_TOKEN_LEVELS.length - 1) {
        degradeLevel += 1;
      }
    }
  }

  const fallbackDecision: AgentDecision = {
    thinking: `Model output remained invalid after retries (${lastParseError || "unknown parse error"}). Falling back to safe discovery action.`,
    action: {
      type: "list_tree",
      maxDepth: 4,
    },
  };

  return {
    raw:
      lastRawContent ||
      JSON.stringify({
        thinking: fallbackDecision.thinking,
        action: fallbackDecision.action,
      }),
    decision: fallbackDecision,
    contextDiagnostics: {
      degradeLevel,
      droppedMessages: lastDroppedMessages,
      tokenEstimate: lastTokenEstimate || estimateMessagesTokens(history),
    },
  };
}

async function runVerificationSuite(
  iteration: number,
  attempt: number,
  commands: AgentCommand[],
  context: ToolContext,
  steps: AgentStep[],
  hooks?: AgentRunHooks
): Promise<VerificationOutcome> {
  const checks: VerificationCheckResult[] = [];

  for (const command of commands) {
    const startedAt = Date.now();
    const result = await runCommand(command, context);
    const durationMs = Date.now() - startedAt;

    const check: VerificationCheckResult = {
      attempt,
      command,
      ok: result.ok,
      output: truncate(result.output, RESPONSE_OUTPUT_LIMIT),
      durationMs,
    };

    checks.push(check);

    const step: AgentStep = {
      iteration,
      phase: "verification",
      thinking: `Run quality gate check (attempt ${attempt})`,
      action: {
        type: "run_command",
        program: command.program,
        args: command.args,
        cwd: command.cwd,
      },
      ok: result.ok,
      summary: result.summary,
      output: result.output,
      durationMs,
    };

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

  return {
    passed,
    checks,
    feedback: buildVerificationFailureFeedback(attempt, checks),
  };
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

function finalizeResult(
  base: Omit<
    AgentRunResult,
    | "status"
    | "summary"
    | "finishedAt"
    | "iterationsUsed"
    | "error"
    | "verificationPassed"
    | "verificationAttempts"
    | "verificationChecks"
    | "verification"
    | "remainingWork"
    | "steps"
    | "filesChanged"
    | "commandsRun"
    | "fileWriteCount"
    | "commandRunCount"
    | "rollbackApplied"
    | "rollbackSummary"
    | "changeJournal"
    | "preflightPassed"
    | "preflightChecks"
    | "clarificationRequired"
    | "clarificationQuestions"
    | "clarificationAnswersUsed"
    | "projectDigest"
    | "projectIntelligence"
    | "zeroKnownIssues"
  >,
  params: {
    status: AgentRunStatus;
    summary: string;
    error?: string;
    verification: string[];
    remainingWork: string[];
    verificationPassed: boolean | null;
    verificationAttempts: number;
    verificationChecks: VerificationCheckResult[];
    steps: AgentStep[];
    filesChanged: Set<string>;
    commandsRun: string[];
    fileWriteCount: number;
    commandRunCount: number;
    rollbackApplied: boolean;
    rollbackSummary: string[];
    changeJournal: ChangeJournalEntry[];
    preflightPassed: boolean | null;
    preflightChecks: VerificationCheckResult[];
    clarificationRequired: boolean;
    clarificationQuestions: ClarificationQuestion[];
    clarificationAnswersUsed: Record<string, string>;
    projectDigest: ProjectDigest;
    projectIntelligence: ProjectIntelligence;
  }
): AgentRunResult {
  const highestIteration = params.steps.reduce(
    (max, step) => Math.max(max, step.iteration),
    0
  );
  const iterationsUsed = isUnboundedIterationMode(base.maxIterations)
    ? highestIteration
    : Math.min(base.maxIterations, highestIteration);
  const hasHighRiskSignals = params.projectIntelligence.signals.some(
    (signal) => signal.severity === "high" && signal.count > 0
  );
  const zeroKnownIssues =
    params.status === "completed" &&
    (params.preflightPassed === null || params.preflightPassed || params.preflightChecks.length === 0) &&
    (params.verificationPassed === null || params.verificationPassed) &&
    params.remainingWork.length === 0 &&
    !hasHighRiskSignals;

  return {
    ...base,
    status: params.status,
    summary: params.summary,
    error: params.error,
    verification: params.verification,
    remainingWork: params.remainingWork,
    finishedAt: new Date().toISOString(),
    iterationsUsed,
    verificationPassed: params.verificationPassed,
    verificationAttempts: params.verificationAttempts,
    verificationChecks: params.verificationChecks,
    steps: params.steps,
    filesChanged: Array.from(params.filesChanged),
    commandsRun: params.commandsRun,
    fileWriteCount: params.fileWriteCount,
    commandRunCount: params.commandRunCount,
    rollbackApplied: params.rollbackApplied,
    rollbackSummary: params.rollbackSummary,
    changeJournal: params.changeJournal,
    preflightPassed: params.preflightPassed,
    preflightChecks: params.preflightChecks,
    clarificationRequired: params.clarificationRequired,
    clarificationQuestions: params.clarificationQuestions,
    clarificationAnswersUsed: params.clarificationAnswersUsed,
    projectDigest: params.projectDigest,
    projectIntelligence: params.projectIntelligence,
    zeroKnownIssues,
  };
}

export async function runAutonomousAgent(
  request: AgentRunRequest,
  hooks?: AgentRunHooks
): Promise<AgentRunResult> {
  const startedAt = new Date().toISOString();
  const workspace = await resolveWorkspacePath(request.workspacePath);
  let persistence: RunPersistenceContext | null = null;
  let resumeCheckpoint: RunCheckpointRecord | null = null;

  try {
    const initialized = await initializeRunPersistence({
      workspace,
      goal: request.goal,
      startedAt,
      resumeRunId: request.resumeRunId,
      resumeFromLastCheckpoint: request.resumeFromLastCheckpoint,
    });
    persistence = initialized.persistence;
    resumeCheckpoint = initialized.resumeCheckpoint;
  } catch (err) {
    emit(hooks, {
      type: "status",
      data: {
        message: `Run-state persistence unavailable: ${
          err instanceof Error ? err.message : "unknown storage error"
        }`,
      },
    });
  }

  const config = resolveModelConfig(request.modelConfig);
  const verificationCommands = await resolveVerificationCommands(request, workspace);
  const teamRoster = buildTeamRoster(request.teamSize);
  const requestedSkillFiles =
    request.skillFiles.length > 0
      ? request.skillFiles
      : resumeCheckpoint?.skillFiles || [];

  let effectiveRequest: AgentRunRequest = {
    ...request,
    skillFiles: requestedSkillFiles,
    verificationCommands,
    clarificationAnswers: {
      ...(resumeCheckpoint?.clarificationAnswers || {}),
      ...(request.clarificationAnswers || {}),
    },
  };
  let activeSkillDocuments: SkillDocument[] = [];
  if (effectiveRequest.skillFiles.length > 0) {
    try {
      activeSkillDocuments = await loadSkillDocuments(
        workspace,
        effectiveRequest.skillFiles,
        MAX_ACTIVE_SKILLS
      );
    } catch {
      activeSkillDocuments = [];
    }

    const loadedSkillFiles = activeSkillDocuments.map((skill) => skill.id);
    effectiveRequest = {
      ...effectiveRequest,
      skillFiles: loadedSkillFiles,
    };
  }
  const runId = persistence?.runId || randomUUID();
  const resumedFromRunId = persistence?.resumedFromRunId;

  const base = {
    runId,
    resumedFromRunId,
    executionMode: "single" as AgentExecutionMode,
    goal: request.goal,
    startedAt,
    model: request.modelOverride || config.model,
    maxIterations: request.maxIterations,
    strictVerification: request.strictVerification,
    autoFixVerification: request.autoFixVerification,
    dryRun: request.dryRun,
    rollbackOnFailure: request.rollbackOnFailure,
    verificationCommands,
    teamSize: request.teamSize,
    teamRoster,
    runPreflightChecks: request.runPreflightChecks,
  };

  const changedFiles = new Set<string>();
  const commandsRun: string[] = [];
  const steps: AgentStep[] = [];
  const verificationChecks: VerificationCheckResult[] = [];
  const preflightChecks: VerificationCheckResult[] = [];
  let preflightPassed: boolean | null = null;
  let projectDigest: ProjectDigest = {
    workspace,
    keyDirectories: [],
    packageScripts: [],
    languageHints: [],
    hasTests: false,
    treePreview: "",
  };
  let projectIntelligence: ProjectIntelligence = createEmptyProjectIntelligence(workspace);
  let clarificationQuestions: ClarificationQuestion[] = [];
  let compactionState = createInitialCompactionState();
  let history: ModelMessage[] = [];

  const toolContext: ToolContext = {
    workspace,
    request: {
      ...effectiveRequest,
    },
    changedFiles,
    commandsRun,
    fileWriteCount: 0,
    commandRunCount: 0,
    changeSnapshots: new Map<string, FileSnapshot>(),
    changeJournal: [],
  };

  emit(hooks, {
    type: "started",
    data: {
      goal: request.goal,
      maxIterations: request.maxIterations,
      model: request.modelOverride || config.model,
      strictVerification: request.strictVerification,
      autoFixVerification: request.autoFixVerification,
      dryRun: request.dryRun,
      rollbackOnFailure: request.rollbackOnFailure,
      teamSize: request.teamSize,
      runPreflightChecks: request.runPreflightChecks,
      requireClarificationBeforeEdits: request.requireClarificationBeforeEdits,
      executionMode: "single",
    },
  });

  if (requestedSkillFiles.length > 0) {
    emit(hooks, {
      type: "status",
      data: {
        message:
          activeSkillDocuments.length > 0
            ? `Loaded ${activeSkillDocuments.length}/${requestedSkillFiles.length} active skill file(s).`
            : "No active skill files could be loaded from the selected workspace.",
      },
    });
  }

  const safeAppendEvent = async (type: string, payload: Record<string, unknown>) => {
    if (!persistence) return;
    try {
      await appendRunEvent(persistence, type, payload);
    } catch {
      persistence = null;
    }
  };

  const safePersistCheckpoint = async (
    status: AgentRunStatus | "in_progress",
    lastIteration: number,
    summary: string,
    verification: string[],
    remainingWork: string[],
    verificationAttempts: number,
    verificationPassed: boolean | null,
    rollbackApplied: boolean,
    rollbackSummary: string[],
    history: ModelMessage[]
  ) => {
    if (!persistence) return;

    const checkpoint: RunCheckpointRecord = {
      version: RUN_CHECKPOINT_VERSION,
      runId,
      resumeKey: persistence.resumeKey,
      workspace,
      goal: request.goal,
      skillFiles: effectiveRequest.skillFiles,
      startedAt,
      updatedAt: new Date().toISOString(),
      status,
      resumedFromRunId,
      lastIteration,
      history,
      compaction: compactionState,
      steps,
      changedFiles: Array.from(changedFiles),
      commandsRun,
      fileWriteCount: toolContext.fileWriteCount,
      commandRunCount: toolContext.commandRunCount,
      verificationChecks,
      preflightChecks,
      preflightPassed,
      verificationAttempts,
      verificationPassed,
      verification,
      remainingWork,
      summary,
      rollbackApplied,
      rollbackSummary,
      changeJournal: toolContext.changeJournal,
      clarificationAnswers: effectiveRequest.clarificationAnswers,
      clarificationQuestions,
      projectDigest,
      projectIntelligence,
    };

    try {
      await persistRunCheckpoint(persistence, checkpoint);
    } catch {
      persistence = null;
    }
  };

  let longTermMemoryBlock = "(no long-term memory retrieved)";
  let continuationHint = "(none)";
  let memoryDiagnosticsHint = "(none)";
  let requiresMemoryEvidenceBeforeMutation = false;
  let lastEvidenceIteration = 0;
  const mutationGoal = goalLikelyRequiresCodeMutation(request.goal);
  let noMutationStreak = 0;
  let repeatedActionStreak = 0;
  let lastActionSignature = "";
  let stagnationInterventions = 0;

  try {
    throwIfAborted(hooks?.signal);
    [projectDigest, projectIntelligence] = await Promise.all([
      buildProjectDigest(workspace),
      collectProjectIntelligence(workspace).catch(() => createEmptyProjectIntelligence(workspace)),
    ]);
    const retrievedMemory = await retrieveMemoryContext({
      workspace,
      query: request.goal,
      limit: 10,
      maxChars: 5000,
      includePinned: true,
      types: [
        "bug_pattern",
        "fix_pattern",
        "verification_rule",
        "project_convention",
        "continuation",
      ],
    }).catch(() => undefined);
    if (retrievedMemory) {
      longTermMemoryBlock = retrievedMemory.contextBlock;
      memoryDiagnosticsHint = formatMemoryDiagnosticsForPrompt(
        retrievedMemory.diagnostics
      );
      requiresMemoryEvidenceBeforeMutation =
        retrievedMemory.diagnostics.requiresVerificationBeforeMutation;
      if (retrievedMemory.latestContinuation) {
        continuationHint = [
          `Latest continuation run: ${retrievedMemory.latestContinuation.runId}`,
          `Summary: ${retrievedMemory.latestContinuation.summary}`,
          `Pending: ${retrievedMemory.latestContinuation.pendingWork.join("; ") || "(none)"}`,
          `Next: ${retrievedMemory.latestContinuation.nextActions.join("; ") || "(none)"}`,
        ].join("\n");
      }
      if (requiresMemoryEvidenceBeforeMutation) {
        emit(hooks, {
          type: "status",
          data: {
            message:
              "Memory conflicts detected; mutation actions now require recent evidence steps.",
          },
        });
      }
    }
    clarificationQuestions = buildClarificationQuestions(
      effectiveRequest,
      projectDigest,
      projectIntelligence
    );
    const requiredClarificationQuestions = clarificationQuestions.filter(
      (question) => question.required
    );

    emit(hooks, {
      type: "status",
      data: {
        message: `Project intelligence ready: ${projectIntelligence.summary}`,
      },
    });

    if (requiredClarificationQuestions.length > 0) {
      emit(hooks, {
        type: "status",
        data: {
          message: "Clarification required before edits; awaiting answers.",
        },
      });

      const result = finalizeResult(base, {
        status: "needs_clarification",
        summary:
          "Clarification is required before modifying files. Provide answers and rerun the autonomous task.",
        verification: [],
        remainingWork: [
          "Answer all required clarification questions.",
          "Rerun with clarificationAnswers to begin planning and code changes.",
        ],
        verificationPassed: null,
        verificationAttempts: 0,
        verificationChecks,
        steps,
        filesChanged: changedFiles,
        commandsRun,
        fileWriteCount: toolContext.fileWriteCount,
        commandRunCount: toolContext.commandRunCount,
        rollbackApplied: false,
        rollbackSummary: ["No rollback needed (no edits were applied)."],
        changeJournal: toolContext.changeJournal,
        preflightPassed,
        preflightChecks,
        clarificationRequired: true,
        clarificationQuestions,
        clarificationAnswersUsed: effectiveRequest.clarificationAnswers,
        projectDigest,
        projectIntelligence,
      });

      await safePersistCheckpoint(
        "needs_clarification",
        0,
        result.summary,
        result.verification,
        result.remainingWork,
        0,
        null,
        false,
        ["No rollback needed (no edits were applied)."],
        []
      );
      await safeAppendEvent("needs_clarification", {
        questions: requiredClarificationQuestions.length,
      });
      await saveContinuationPacket(
        workspace,
        buildSingleAgentContinuationPacket({
          runId,
          goal: request.goal,
          status: "needs_clarification",
          summary: result.summary,
          remainingWork: result.remainingWork,
          steps,
          nextIterationHint: 1,
        })
      ).catch(() => undefined);
      await addMemoryEntries(
        workspace,
        buildSingleAgentMemoryCandidates({
          goal: request.goal,
          runId,
          status: "needs_clarification",
          summary: result.summary,
          dryRun: request.dryRun,
          verificationPassed: null,
          verificationCommands,
          verificationChecks,
          changedFiles: Array.from(changedFiles),
          steps,
          clarificationAnswers: effectiveRequest.clarificationAnswers,
        })
      ).catch(() => undefined);
      return result;
    }

    let nextIteration = 1;
    let status: AgentRunStatus = "max_iterations";
    let finalSummary = "";
    let remainingWork: string[] = [];
    let verification: string[] = [];
    let verificationAttempts = 0;
    let verificationPassed: boolean | null = null;
    const activeSkillsInstruction = buildActiveSkillsInstruction(activeSkillDocuments);

    if (resumeCheckpoint && Array.isArray(resumeCheckpoint.history) && resumeCheckpoint.history.length > 0) {
      history = resumeCheckpoint.history;
      compactionState = resumeCheckpoint.compaction || createInitialCompactionState();
      for (const filePath of resumeCheckpoint.changedFiles || []) {
        changedFiles.add(filePath);
      }
      commandsRun.push(...(resumeCheckpoint.commandsRun || []));
      steps.push(...(resumeCheckpoint.steps || []));
      verificationChecks.push(...(resumeCheckpoint.verificationChecks || []));
      preflightChecks.push(...(resumeCheckpoint.preflightChecks || []));
      preflightPassed = resumeCheckpoint.preflightPassed ?? null;
      verificationAttempts = resumeCheckpoint.verificationAttempts || 0;
      verificationPassed =
        typeof resumeCheckpoint.verificationPassed === "boolean"
          ? resumeCheckpoint.verificationPassed
          : null;
      verification = resumeCheckpoint.verification || [];
      remainingWork = resumeCheckpoint.remainingWork || [];
      finalSummary = resumeCheckpoint.summary || "";
      toolContext.fileWriteCount = resumeCheckpoint.fileWriteCount || 0;
      toolContext.commandRunCount = resumeCheckpoint.commandRunCount || 0;
      toolContext.changeJournal.push(...(resumeCheckpoint.changeJournal || []));
      nextIteration = Math.max(
        1,
        (resumeCheckpoint.lastIteration || 0) + 1
      );

      emit(hooks, {
        type: "status",
        data: {
          message: `Resumed from previous checkpoint (${resumeCheckpoint.runId}) at iteration ${nextIteration}.`,
        },
      });
      await safeAppendEvent("resumed_from_checkpoint", {
        resumedFromRunId: resumeCheckpoint.runId,
        nextIteration,
      });
      if (activeSkillsInstruction) {
        history.push({
          role: "user",
          content: activeSkillsInstruction,
        });
      }
    } else {
      const initialTree = treeToString(await buildTree(workspace, workspace, 0, 2));
      history = [
        {
          role: "system",
          content: buildSystemPrompt(),
        },
        {
          role: "user",
          content: buildInitialMessage(
            {
              ...effectiveRequest,
              verificationCommands,
            },
            workspace,
            truncate(initialTree, 6000),
            teamRoster,
            projectDigest,
            projectIntelligence,
            longTermMemoryBlock,
            continuationHint,
            memoryDiagnosticsHint
          ),
        },
      ];
      if (activeSkillsInstruction) {
        history.push({
          role: "user",
          content: activeSkillsInstruction,
        });
      }

      if (request.runPreflightChecks) {
        if (verificationCommands.length > 0) {
          emit(hooks, {
            type: "status",
            data: {
              message: "Running preflight quality checks before planning edits.",
            },
          });

          const preflightOutcome = await runVerificationSuite(
            0,
            0,
            verificationCommands,
            toolContext,
            steps,
            hooks
          );
          preflightChecks.push(...preflightOutcome.checks);
          preflightPassed = preflightOutcome.passed;

          const checkLines = preflightOutcome.checks
            .map((check, index) => {
              const statusLabel = check.ok ? "PASS" : "FAIL";
              return `${index + 1}. ${statusLabel} ${stringifyCommand(check.command)}\n${truncate(
                check.output,
                1200
              )}`;
            })
            .join("\n\n");

          history.push({
            role: "user",
            content: [
              "Preflight baseline checks completed before code modifications.",
              `Result: ${preflightOutcome.passed ? "PASS" : "FAIL"}`,
              "",
              "Use this as baseline context and fix any relevant failures as part of the task.",
              "",
              checkLines || "(no output)",
            ].join("\n"),
          });
        } else {
          preflightPassed = null;
        }
      }
    }

    lastEvidenceIteration = findLastEvidenceIteration(steps);

    await safePersistCheckpoint(
      "in_progress",
      nextIteration - 1,
      finalSummary,
      verification,
      remainingWork,
      verificationAttempts,
      verificationPassed,
      false,
      [],
      history
    );

    for (
      let iteration = nextIteration;
      hasIterationBudgetRemaining(iteration, request.maxIterations);
      iteration += 1
    ) {
      throwIfAborted(hooks?.signal);

      const iterationStarted = Date.now();
      const memorySummary = buildOperationalMemorySummary({
        goal: request.goal,
        iteration,
        maxIterations: request.maxIterations,
        steps,
        changedFiles,
        verificationChecks,
        preflightChecks,
        compaction: compactionState,
      });
      const compacted = compactConversationHistory(
        history,
        compactionState,
        iteration,
        memorySummary
      );
      history = compacted.history;
      compactionState = compacted.compaction;

      if (compacted.compacted) {
        emit(hooks, {
          type: "status",
          data: {
            message: `Conversation compacted at iteration ${iteration} to preserve context reliability.`,
          },
        });
        await safeAppendEvent("history_compacted", {
          iteration,
          droppedMessages: compactionState.droppedMessages,
        });
        await saveContinuationPacket(
          workspace,
          buildSingleAgentContinuationPacket({
            runId,
            goal: request.goal,
            status: "in_progress",
            summary: `History compacted at iteration ${iteration}.`,
            remainingWork,
            steps,
            nextIterationHint: iteration + 1,
          })
        ).catch(() => undefined);
      }

      if (
        mutationGoal &&
        !request.dryRun &&
        toolContext.fileWriteCount === 0 &&
        noMutationStreak >= STAGNATION_NO_MUTATION_ITERATIONS &&
        stagnationInterventions < MAX_STAGNATION_INTERVENTIONS
      ) {
        const guardMessage = buildMutationStagnationMessage(noMutationStreak);
        history.push({
          role: "user",
          content: guardMessage,
        });
        emit(hooks, {
          type: "status",
          data: {
            message:
              "Stagnation guard engaged: forcing concrete file mutation on coding goal.",
          },
        });
        await safeAppendEvent("stagnation_guard_triggered", {
          iteration,
          reason: "no_mutation_progress",
          noMutationStreak,
          fileWriteCount: toolContext.fileWriteCount,
        });
        noMutationStreak = 0;
        repeatedActionStreak = 0;
        stagnationInterventions += 1;
      } else if (
        repeatedActionStreak >= STAGNATION_REPEAT_ACTION_ITERATIONS &&
        stagnationInterventions < MAX_STAGNATION_INTERVENTIONS
      ) {
        const guardMessage = buildRepeatedActionStagnationMessage(
          lastActionSignature || "(unknown)",
          repeatedActionStreak
        );
        history.push({
          role: "user",
          content: guardMessage,
        });
        emit(hooks, {
          type: "status",
          data: {
            message:
              "Stagnation guard engaged: repeated action loop detected, forcing strategy change.",
          },
        });
        await safeAppendEvent("stagnation_guard_triggered", {
          iteration,
          reason: "repeated_action_loop",
          repeatedActionStreak,
          lastActionSignature,
        });
        repeatedActionStreak = 0;
        stagnationInterventions += 1;
      }

      emit(hooks, {
        type: "status",
        data: {
          message: `Iteration ${iteration}: requesting next action from model...`,
        },
      });

      const decisionStartedAt = Date.now();
      const heartbeatId = setInterval(() => {
        const elapsedSeconds = Math.max(
          1,
          Math.floor((Date.now() - decisionStartedAt) / 1000)
        );
        emit(hooks, {
          type: "status",
          data: {
            message: `Iteration ${iteration}: still waiting for model response (${elapsedSeconds}s)...`,
          },
        });
      }, DECISION_HEARTBEAT_INTERVAL_MS);

      let decisionOutput: Awaited<ReturnType<typeof getDecision>>;
      try {
        decisionOutput = await getDecision(
          history,
          iteration,
          request.maxIterations,
          request.modelOverride,
          request.modelConfig,
          memorySummary,
          hooks?.signal
        );
      } finally {
        clearInterval(heartbeatId);
      }
      const { raw, decision, contextDiagnostics } = decisionOutput;

      history.push({ role: "assistant", content: raw });
      await safeAppendEvent("decision_generated", {
        iteration,
        actionType: decision.action.type,
        degradeLevel: contextDiagnostics.degradeLevel,
        droppedMessages: contextDiagnostics.droppedMessages,
        tokenEstimate: contextDiagnostics.tokenEstimate,
      });

      if (
        decision.action.type === "final" &&
        !request.dryRun &&
        mutationGoal &&
        toolContext.fileWriteCount === 0
      ) {
        const guardMessage =
          "Finalization rejected: this goal requires code/file changes, but no file mutations have been applied yet.";
        const guardStep: AgentStep = {
          iteration,
          phase: "action",
          thinking: decision.thinking,
          action: decision.action,
          ok: false,
          summary: "Premature final blocked before any file writes",
          output: guardMessage,
          durationMs: Date.now() - iterationStarted,
        };
        steps.push(guardStep);
        emit(hooks, { type: "step", data: { step: guardStep } });
        history.push({
          role: "user",
          content:
            "Do not finalize yet. Perform at least one concrete file mutation (write/append/delete) that advances the goal, then continue.",
        });
        await safeAppendEvent("final_blocked_no_mutation", {
          iteration,
          goal: request.goal,
        });
        noMutationStreak += 1;
        const signature = summarizeActionForStagnation(decision.action);
        if (signature === lastActionSignature) {
          repeatedActionStreak += 1;
        } else {
          repeatedActionStreak = 1;
          lastActionSignature = signature;
        }
        continue;
      }

      if (decision.action.type === "final") {
        finalSummary = decision.action.summary;
        verification = decision.action.verification || [];
        remainingWork = decision.action.remainingWork || [];

        if (request.strictVerification && verificationCommands.length > 0) {
          verificationAttempts += 1;

          emit(hooks, {
            type: "status",
            data: {
              message: `Running quality gates (attempt ${verificationAttempts})`,
            },
          });

          const verificationOutcome = await runVerificationSuite(
            iteration,
            verificationAttempts,
            verificationCommands,
            toolContext,
            steps,
            hooks
          );

          verificationChecks.push(...verificationOutcome.checks);

          const gateResults = verificationOutcome.checks.map((check) => {
            const prefix = check.ok ? "PASS" : "FAIL";
            return `${prefix} ${stringifyCommand(check.command)}`;
          });

          verification = [...verification, ...gateResults];

          if (verificationOutcome.passed) {
            verificationPassed = true;
            status = "completed";
            await safePersistCheckpoint(
              "in_progress",
              iteration,
              finalSummary,
              verification,
              remainingWork,
              verificationAttempts,
              verificationPassed,
              false,
              [],
              history
            );
            break;
          }

          verificationPassed = false;

          const failedFinalStep: AgentStep = {
            iteration,
            phase: "verification",
            thinking: decision.thinking,
            action: decision.action,
            ok: false,
            summary: "Agent attempted completion but quality gates failed",
            output: truncate(verificationOutcome.feedback, RESPONSE_OUTPUT_LIMIT),
            durationMs: Date.now() - iterationStarted,
          };

          steps.push(failedFinalStep);
          emit(hooks, { type: "step", data: { step: failedFinalStep } });

          if (
            request.autoFixVerification &&
            hasFollowupIteration(iteration, request.maxIterations)
          ) {
            history.push({
              role: "user",
              content: verificationOutcome.feedback,
            });

            emit(hooks, {
              type: "status",
              data: {
                message: "Quality gates failed. Continuing autonomous repair loop.",
              },
            });

            await safePersistCheckpoint(
              "in_progress",
              iteration,
              finalSummary,
              verification,
              remainingWork,
              verificationAttempts,
              verificationPassed,
              false,
              [],
              history
            );
            continue;
          }

          status = "verification_failed";
          finalSummary =
            "Quality gates failed after the agent attempted to finalize. Review verification output and continue with additional repair iterations.";
          break;
        }

        if (request.strictVerification && verificationCommands.length === 0) {
          verificationPassed = null;
          verification.push("No verification commands detected in workspace.");
        }

        status = "completed";
        await safePersistCheckpoint(
          "in_progress",
          iteration,
          finalSummary,
          verification,
          remainingWork,
          verificationAttempts,
          verificationPassed,
          false,
          [],
          history
        );
        break;
      }

      let toolResult: ToolResult;
      if (
        requiresMemoryEvidenceBeforeMutation &&
        isMutationAction(decision.action) &&
        lastEvidenceIteration < Math.max(1, iteration - 2)
      ) {
        toolResult = {
          ok: false,
          summary: "Memory evidence gate blocked mutation action",
          output: [
            "Conflicting long-term memory signals are active for this goal.",
            "Before mutating files, gather fresh evidence with read_file/read_many_files/search_files/run_command.",
            `Last evidence iteration: ${lastEvidenceIteration || 0}`,
          ].join("\n"),
        };
      } else {
        toolResult = await executeAction(decision.action, toolContext);
      }
      const step: AgentStep = {
        iteration,
        phase: "action",
        thinking: decision.thinking,
        action: decision.action,
        ok: toolResult.ok,
        summary: toolResult.summary,
        output: truncate(toolResult.output, RESPONSE_OUTPUT_LIMIT),
        durationMs: Date.now() - iterationStarted,
      };

      steps.push(step);
      emit(hooks, { type: "step", data: { step } });

      if (step.ok && isEvidenceAction(decision.action)) {
        lastEvidenceIteration = iteration;
      }

      const currentActionSignature = summarizeActionForStagnation(decision.action);
      if (currentActionSignature === lastActionSignature) {
        repeatedActionStreak += 1;
      } else {
        repeatedActionStreak = 1;
        lastActionSignature = currentActionSignature;
      }

      if (mutationGoal && !request.dryRun && toolContext.fileWriteCount === 0) {
        if (step.ok && isMutationAction(decision.action)) {
          noMutationStreak = 0;
        } else {
          noMutationStreak += 1;
        }
      } else {
        noMutationStreak = 0;
      }

      history.push({
        role: "user",
        content: buildToolFeedback(toolResult, toolContext),
      });

      if (iteration % CHECKPOINT_INTERVAL === 0) {
        await safePersistCheckpoint(
          "in_progress",
          iteration,
          finalSummary,
          verification,
          remainingWork,
          verificationAttempts,
          verificationPassed,
          false,
          [],
          history
        );
      }
    }

    if (!finalSummary) {
      finalSummary = isUnboundedIterationMode(request.maxIterations)
        ? "Run ended before the agent could safely declare completion. Review step logs and continue from the latest checkpoint."
        : "Iteration limit reached before the agent could safely declare completion. Review step logs and rerun with refined goals or higher budgets.";
      if (isUnboundedIterationMode(request.maxIterations) && status === "max_iterations") {
        status = "failed";
      }
    }

    let rollbackApplied = false;
    let rollbackSummary: string[] = [];

    if (request.rollbackOnFailure && status !== "completed") {
      const rollback = await rollbackChanges(toolContext, hooks);
      rollbackApplied = rollback.applied;
      rollbackSummary = rollback.summary;
    }

    const result = finalizeResult(base, {
      status,
      summary: finalSummary,
      verification,
      remainingWork,
      verificationPassed,
      verificationAttempts,
      verificationChecks,
      steps,
      filesChanged: changedFiles,
      commandsRun,
      fileWriteCount: toolContext.fileWriteCount,
      commandRunCount: toolContext.commandRunCount,
      rollbackApplied,
      rollbackSummary,
      changeJournal: toolContext.changeJournal,
      preflightPassed,
      preflightChecks,
      clarificationRequired: false,
      clarificationQuestions,
      clarificationAnswersUsed: effectiveRequest.clarificationAnswers,
      projectDigest,
      projectIntelligence,
    });
    await safePersistCheckpoint(
      status,
      normalizeCheckpointIteration(result.iterationsUsed, request.maxIterations),
      result.summary,
      result.verification,
      result.remainingWork,
      result.verificationAttempts,
      result.verificationPassed,
      result.rollbackApplied,
      result.rollbackSummary,
      history
    );
    await safeAppendEvent("run_finished", {
      status: result.status,
      iterationsUsed: result.iterationsUsed,
      filesChanged: result.filesChanged.length,
      commandsRun: result.commandsRun.length,
      verificationPassed: result.verificationPassed,
    });
    await saveContinuationPacket(
      workspace,
      buildSingleAgentContinuationPacket({
        runId,
        goal: request.goal,
        status: result.status,
        summary: result.summary,
        remainingWork: result.remainingWork,
        steps: result.steps,
      })
    ).catch(() => undefined);
    await addMemoryEntries(
      workspace,
      buildSingleAgentMemoryCandidates({
        goal: request.goal,
        runId,
        status: result.status,
        summary: result.summary,
        dryRun: request.dryRun,
        verificationPassed: result.verificationPassed,
        verificationCommands,
        verificationChecks: result.verificationChecks,
        changedFiles: result.filesChanged,
        steps: result.steps,
        clarificationAnswers: effectiveRequest.clarificationAnswers,
      })
    ).catch(() => undefined);
    return result;
  } catch (err) {
    const isCanceled = err instanceof RunCanceledError;
    const message = toErrorMessage(err, "Agent run failed");

    let rollbackApplied = false;
    let rollbackSummary: string[] = [];

    if (request.rollbackOnFailure) {
      const rollback = await rollbackChanges(toolContext, hooks);
      rollbackApplied = rollback.applied;
      rollbackSummary = rollback.summary;
    }

    const failedResult = finalizeResult(base, {
      status: isCanceled ? "canceled" : "failed",
      summary: isCanceled ? "Run canceled by user." : "Agent run failed.",
      error: message,
      verification: [],
      remainingWork: [],
      verificationPassed: null,
      verificationAttempts: 0,
      verificationChecks,
      steps,
      filesChanged: changedFiles,
      commandsRun,
      fileWriteCount: toolContext.fileWriteCount,
      commandRunCount: toolContext.commandRunCount,
      rollbackApplied,
      rollbackSummary,
      changeJournal: toolContext.changeJournal,
      preflightPassed,
      preflightChecks,
      clarificationRequired: false,
      clarificationQuestions,
      clarificationAnswersUsed: effectiveRequest.clarificationAnswers,
      projectDigest,
      projectIntelligence,
    });
    await safePersistCheckpoint(
      failedResult.status,
      normalizeCheckpointIteration(failedResult.iterationsUsed, request.maxIterations),
      failedResult.summary,
      failedResult.verification,
      failedResult.remainingWork,
      failedResult.verificationAttempts,
      failedResult.verificationPassed,
      failedResult.rollbackApplied,
      failedResult.rollbackSummary,
      history
    );
    await safeAppendEvent("run_failed", {
      status: failedResult.status,
      error: failedResult.error || "unknown error",
      iterationsUsed: failedResult.iterationsUsed,
    });
    await saveContinuationPacket(
      workspace,
      buildSingleAgentContinuationPacket({
        runId,
        goal: request.goal,
        status: failedResult.status,
        summary: failedResult.error || failedResult.summary,
        remainingWork: failedResult.remainingWork,
        steps: failedResult.steps,
      })
    ).catch(() => undefined);
    await addMemoryEntries(
      workspace,
      buildSingleAgentMemoryCandidates({
        goal: request.goal,
        runId,
        status: failedResult.status,
        summary: failedResult.error || failedResult.summary,
        dryRun: request.dryRun,
        verificationPassed: failedResult.verificationPassed,
        verificationCommands,
        verificationChecks: failedResult.verificationChecks,
        changedFiles: failedResult.filesChanged,
        steps: failedResult.steps,
        clarificationAnswers: effectiveRequest.clarificationAnswers,
      })
    ).catch(() => undefined);
    return failedResult;
  }
}

function parseCommandObject(value: unknown, field: string): AgentCommand {
  if (!value || typeof value !== "object") {
    throw new Error(`${field} must be an object`);
  }

  const obj = value as {
    program?: unknown;
    args?: unknown;
    cwd?: unknown;
  };

  const program = ensureString(obj.program, `${field}.program`);
  let args: string[] = [];

  if (obj.args !== undefined) {
    if (!Array.isArray(obj.args) || obj.args.some((item) => typeof item !== "string")) {
      throw new Error(`${field}.args must be an array of strings`);
    }
    args = obj.args;
  }

  const cwd = typeof obj.cwd === "string" ? obj.cwd : undefined;

  return normalizeCommand(program, args, cwd);
}

function parseBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  return fallback;
}

function parseNumber(value: unknown): number | undefined {
  if (typeof value === "number") return value;
  return undefined;
}

function clampDecimal(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  if (value === undefined || Number.isNaN(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function normalizeSkillFileReference(value: string): string {
  return value.trim().replace(/\\/g, "/");
}

export function normalizeAgentRunRequest(body: unknown): {
  request?: AgentRunRequest;
  error?: string;
} {
  if (!body || typeof body !== "object") {
    return { error: "Request body must be a JSON object" };
  }

  const data = body as {
    goal?: unknown;
    workspacePath?: unknown;
    executionMode?: unknown;
    resumeRunId?: unknown;
    resumeFromLastCheckpoint?: unknown;
    maxIterations?: unknown;
    model?: unknown;
    modelConfig?: unknown;
    skillFiles?: unknown;
    teamSize?: unknown;
    runPreflightChecks?: unknown;
    requireClarificationBeforeEdits?: unknown;
    clarificationAnswers?: unknown;
    strictVerification?: unknown;
    autoFixVerification?: unknown;
    dryRun?: unknown;
    rollbackOnFailure?: unknown;
    verificationCommands?: unknown;
    maxFileWrites?: unknown;
    maxCommandRuns?: unknown;
    maxParallelWorkUnits?: unknown;
    criticPassThreshold?: unknown;
  };

  const goal = typeof data.goal === "string" ? data.goal.trim() : "";
  if (!goal) {
    return { error: "Goal is required and must be a non-empty string" };
  }
  const mutationGoal = goalLikelyRequiresCodeMutation(goal);

  const workspacePath =
    typeof data.workspacePath === "string" && data.workspacePath.trim().length > 0
      ? data.workspacePath.trim()
      : undefined;
  const resumeRunId =
    typeof data.resumeRunId === "string" && data.resumeRunId.trim().length > 0
      ? data.resumeRunId.trim()
      : undefined;
  const executionMode = data.executionMode === "single" ? "single" : "multi";

  const requestedMaxIterations = parseNumber(data.maxIterations);
  const maxIterations =
    requestedMaxIterations === UNBOUNDED_MAX_ITERATIONS
      ? UNBOUNDED_MAX_ITERATIONS
      : clampNumber(
          requestedMaxIterations,
          DEFAULT_MAX_ITERATIONS,
          2,
          MAX_ITERATIONS_LIMIT
        );

  const maxFileWrites = clampNumber(
    parseNumber(data.maxFileWrites),
    DEFAULT_MAX_FILE_WRITES,
    1,
    120
  );

  const maxCommandRuns = clampNumber(
    parseNumber(data.maxCommandRuns),
    DEFAULT_MAX_COMMAND_RUNS,
    1,
    140
  );
  const maxParallelWorkUnits = clampNumber(
    parseNumber(data.maxParallelWorkUnits),
    3,
    1,
    8
  );
  const criticPassThreshold = clampDecimal(
    parseNumber(data.criticPassThreshold),
    0.72,
    0.2,
    0.95
  );

  const teamSize = clampNumber(
    parseNumber(data.teamSize),
    DEFAULT_TEAM_SIZE,
    1,
    MAX_TEAM_SIZE
  );

  const strictVerification = parseBoolean(data.strictVerification, mutationGoal ? false : true);
  const autoFixVerification = parseBoolean(data.autoFixVerification, true);
  const dryRun = parseBoolean(data.dryRun, false);
  const rollbackOnFailure = parseBoolean(data.rollbackOnFailure, mutationGoal ? false : true);
  const runPreflightChecks = parseBoolean(data.runPreflightChecks, mutationGoal ? false : true);
  const requireClarificationBeforeEdits = parseBoolean(
    data.requireClarificationBeforeEdits,
    false
  );
  const resumeFromLastCheckpoint = parseBoolean(data.resumeFromLastCheckpoint, false);

  let clarificationAnswers: Record<string, string> = {};
  if (data.clarificationAnswers !== undefined) {
    if (
      !data.clarificationAnswers ||
      typeof data.clarificationAnswers !== "object" ||
      Array.isArray(data.clarificationAnswers)
    ) {
      return {
        error: "clarificationAnswers must be an object map of question ids to answers",
      };
    }

    clarificationAnswers = Object.fromEntries(
      Object.entries(data.clarificationAnswers as Record<string, unknown>)
        .filter(([key]) => key.trim().length > 0)
        .map(([key, value]) => [key, typeof value === "string" ? value : String(value)])
    );
  }

  let skillFiles: string[] = [];
  if (data.skillFiles !== undefined) {
    if (!Array.isArray(data.skillFiles)) {
      return {
        error: "skillFiles must be an array of relative file paths",
      };
    }

    if (data.skillFiles.some((value) => typeof value !== "string")) {
      return {
        error: "skillFiles must only contain string file paths",
      };
    }

    const dedupe = new Set<string>();
    for (const rawValue of data.skillFiles as string[]) {
      const normalized = normalizeSkillFileReference(rawValue);
      if (!normalized) continue;
      dedupe.add(normalized);
      if (dedupe.size >= MAX_SKILL_FILES) break;
    }
    skillFiles = Array.from(dedupe);
  }

  let verificationCommands: AgentCommand[] = [];
  if (data.verificationCommands !== undefined) {
    if (!Array.isArray(data.verificationCommands)) {
      return {
        error: "verificationCommands must be an array of command objects",
      };
    }

    try {
      verificationCommands = data.verificationCommands.map((value, index) =>
        parseCommandObject(value, `verificationCommands[${index}]`)
      );
    } catch (err) {
      return {
        error:
          err instanceof Error
            ? err.message
            : "Invalid verification command in verificationCommands",
      };
    }
  }

  const modelOverride =
    typeof data.model === "string" && data.model.trim().length > 0
      ? data.model.trim()
      : undefined;

  let modelConfig: Partial<ModelConfig> | undefined;
  try {
    modelConfig = parseModelConfigInput(data.modelConfig);
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Invalid modelConfig",
    };
  }

  return {
    request: {
      goal,
      workspacePath,
      executionMode,
      skillFiles,
      resumeRunId,
      resumeFromLastCheckpoint,
      maxIterations,
      modelOverride,
      modelConfig,
      strictVerification,
      autoFixVerification,
      dryRun,
      rollbackOnFailure,
      teamSize,
      runPreflightChecks,
      requireClarificationBeforeEdits,
      clarificationAnswers,
      verificationCommands,
      maxFileWrites,
      maxCommandRuns,
      maxParallelWorkUnits,
      criticPassThreshold,
    },
  };
}
