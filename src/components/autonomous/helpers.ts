import {
  AgentAction,
  AgentCommand,
  AgentRunResult,
  AgentRunStatus,
  AgentSettings,
  ClarificationOption,
  ClarificationQuestion,
  FileTreeNode,
  IntelligenceSignal,
  MemoryRetrievalDiagnostics,
  ProjectIntelligence,
  VerificationCheckResult,
} from "@/components/autonomous/types";

export const SETTINGS_STORAGE_KEY = "autonomous-agent-settings-v2";
export const HISTORY_STORAGE_KEY = "autonomous-agent-history-v1";
export const UI_MODE_STORAGE_KEY = "autonomous-agent-ui-mode-v1";
export const MAX_HISTORY_ITEMS = 12;

export const DEFAULT_SETTINGS: AgentSettings = {
  executionMode: "multi",
  maxIterations: 0,
  maxParallelWorkUnits: 3,
  criticPassThreshold: 0.62,
  teamSize: 8,
  runPreflightChecks: false,
  resumeFromLastCheckpoint: false,
  requireClarificationBeforeEdits: false,
  strictVerification: false,
  autoFixVerification: true,
  dryRun: false,
  rollbackOnFailure: false,
  maxFileWrites: 40,
  maxCommandRuns: 48,
  modelOverride: "",
  customVerificationCommands: "",
};

export function commandToString(command: AgentCommand): string {
  const args = command.args || [];
  return `${command.program}${args.length > 0 ? ` ${args.join(" ")}` : ""}`;
}

export function actionSummary(action: AgentAction): string {
  switch (action.type) {
    case "list_tree":
      return `List tree (depth ${String(action.maxDepth ?? 4)})`;
    case "search_files":
      return `Search files: ${String(action.pattern ?? "")}`;
    case "read_file":
      return `Read file: ${String(action.path ?? "")}`;
    case "read_many_files":
      return `Read many files (${Array.isArray(action.paths) ? action.paths.length : 0})`;
    case "write_file":
      return `Write file: ${String(action.path ?? "")}`;
    case "append_file":
      return `Append file: ${String(action.path ?? "")}`;
    case "delete_file":
      return `Delete file: ${String(action.path ?? "")}`;
    case "run_command": {
      const args = Array.isArray(action.args) ? action.args.join(" ") : "";
      return `Run: ${String(action.program ?? "")} ${args}`.trim();
    }
    case "web_search":
      return `Web search: ${String(action.query ?? "")}`;
    case "final":
      return "Finalize";
    default:
      return action.type;
  }
}

export function statusBadgeClass(status: AgentRunStatus): string {
  if (status === "completed") {
    return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300";
  }

  if (status === "failed" || status === "verification_failed") {
    return "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300";
  }

  if (status === "canceled") {
    return "bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300";
  }

  return "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300";
}

export function signalBadgeClass(severity: IntelligenceSignal["severity"]): string {
  if (severity === "high") {
    return "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300";
  }
  if (severity === "medium") {
    return "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300";
  }
  return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300";
}

export function formatRunReport(result: AgentRunResult): string {
  const lines: string[] = [
    "## Autonomous Run Report",
    `- Run ID: ${result.runId || "(unknown)"}`,
    `- Resumed from run: ${result.resumedFromRunId || "(fresh run)"}`,
    `- Status: ${result.status}`,
    `- Execution mode: ${result.executionMode}`,
    `- Model: ${result.model}`,
    `- Iterations: ${formatIterationProgress(result.iterationsUsed, result.maxIterations)}`,
    `- Team size: ${result.teamSize}`,
    `- File writes: ${result.fileWriteCount}`,
    `- Command runs: ${result.commandRunCount}`,
    `- Run preflight checks: ${result.runPreflightChecks}`,
    `- Preflight passed: ${String(result.preflightPassed)}`,
    `- Clarification required: ${result.clarificationRequired}`,
    `- Intelligence summary: ${result.projectIntelligence.summary}`,
    `- Strict verification: ${result.strictVerification}`,
    `- Auto-fix verification: ${result.autoFixVerification}`,
    `- Dry run: ${result.dryRun}`,
    `- Rollback on failure: ${result.rollbackOnFailure}`,
    `- Rollback applied: ${result.rollbackApplied}`,
    `- Started: ${result.startedAt}`,
    `- Finished: ${result.finishedAt}`,
    "",
    "### Goal",
    result.goal,
    "",
    "### Summary",
    result.summary || result.error || "No summary returned.",
  ];

  if (result.verificationCommands.length > 0) {
    lines.push(
      "",
      "### Quality Gates",
      ...result.verificationCommands.map((command) => `- ${commandToString(command)}`)
    );
  }

  if (result.clarificationQuestions.length > 0) {
    lines.push(
      "",
      "### Clarification Questions",
      ...result.clarificationQuestions.map((question) => `- ${question.id}: ${question.question}`)
    );
  }

  if (Object.keys(result.clarificationAnswersUsed).length > 0) {
    lines.push(
      "",
      "### Clarification Answers",
      ...Object.entries(result.clarificationAnswersUsed).map(
        ([key, value]) => `- ${key}: ${value}`
      )
    );
  }

  if (result.verification.length > 0) {
    lines.push("", "### Verification Notes", ...result.verification.map((item) => `- ${item}`));
  }

  if (result.remainingWork.length > 0) {
    lines.push("", "### Remaining Work", ...result.remainingWork.map((item) => `- ${item}`));
  }

  if (result.filesChanged.length > 0) {
    lines.push("", "### Files Changed", ...result.filesChanged.map((file) => `- ${file}`));
  }

  if (result.commandsRun.length > 0) {
    lines.push("", "### Commands Run", ...result.commandsRun.map((cmd) => `- ${cmd}`));
  }

  if (result.rollbackSummary.length > 0) {
    lines.push("", "### Rollback", ...result.rollbackSummary.map((item) => `- ${item}`));
  }

  if (result.changeJournal.length > 0) {
    lines.push(
      "",
      "### Change Journal",
      ...result.changeJournal.map(
        (entry) => `- [${entry.op}] ${entry.path} (${entry.timestamp}) — ${entry.details}`
      )
    );
  }

  if (result.teamRoster.length > 0) {
    lines.push(
      "",
      "### Team Roster",
      ...result.teamRoster.map((role, index) => `- ${index + 1}. ${role}`)
    );
  }

  if (result.projectDigest.treePreview) {
    lines.push(
      "",
      "### Project Digest",
      `- Workspace: ${result.projectDigest.workspace}`,
      `- Languages: ${result.projectDigest.languageHints.join(", ") || "(none)"}`,
      `- Has tests: ${result.projectDigest.hasTests}`,
      `- Key directories: ${result.projectDigest.keyDirectories.join(", ") || "(none)"}`,
      "",
      "```",
      result.projectDigest.treePreview,
      "```"
    );
  }

  if (result.projectIntelligence.signals.length > 0) {
    lines.push(
      "",
      "### Project Intelligence",
      `- Generated: ${result.projectIntelligence.generatedAt}`,
      `- Stack: ${result.projectIntelligence.stack.join(", ") || "(unknown)"}`,
      `- Test files: ${result.projectIntelligence.testFileCount}`,
      `- Signals: ${
        result.projectIntelligence.signals
          .map((signal) => `${signal.label}=${signal.count}`)
          .join(", ") || "(none)"
      }`
    );
  }

  if (result.multiAgentReport) {
    const observability = result.multiAgentReport.observability;
    lines.push(
      "",
      "### Multi-Agent Strategy",
      `- Strategy: ${result.multiAgentReport.strategy}`,
      `- Final checks: ${result.multiAgentReport.finalChecks.join(", ") || "(none)"}`,
      `- Flaky quarantined commands: ${result.multiAgentReport.flakyQuarantinedCommands?.join(", ") || "(none)"}`,
      `- Runtime: ${observability ? `${Math.round(observability.totalDurationMs / 1000)}s` : "n/a"}`,
      "",
      "### Work Units",
      ...result.multiAgentReport.workUnits.map(
        (unit) =>
          `- ${unit.id} [${unit.status}] attempts=${unit.attempts}, critic=${typeof unit.criticScore === "number" ? unit.criticScore.toFixed(2) : "n/a"}, verification=${String(unit.verificationPassed)}`
      )
    );

    if (observability?.modelUsage?.length) {
      lines.push(
        "",
        "### Model Usage",
        ...observability.modelUsage.map(
          (metric) =>
            `- ${metric.role}/${metric.tier}: calls=${metric.calls}, cacheHits=${metric.cacheHits}, retries=${metric.retries}, escalations=${metric.escalations}, costUnits=${metric.estimatedCostUnits.toFixed(0)}`
        )
      );
    }

    if (observability?.unitMetrics?.length) {
      const sortedMetrics = [...observability.unitMetrics].sort(
        (first, second) => second.durationMs - first.durationMs
      );
      const maxDuration = Math.max(1, ...sortedMetrics.map((metric) => metric.durationMs || 0));
      lines.push(
        "",
        "### Unit Timeline",
        ...sortedMetrics.map((metric) => {
          const sharePercent = Math.round((metric.durationMs / maxDuration) * 100);
          return `- ${metric.unitId} [${metric.status}] duration=${formatDuration(metric.durationMs)}, attempts=${metric.attempts}, share=${sharePercent}%`;
        })
      );
    }

    if (observability?.failureHeatmap?.length) {
      lines.push(
        "",
        "### Failure Heatmap",
        ...observability.failureHeatmap.map((entry) => `- ${entry.label}: ${entry.count}`)
      );
    }
  }

  return lines.join("\n");
}

export function parseStoredJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;

  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, Math.floor(value)));
}

export function normalizeMaxIterations(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_SETTINGS.maxIterations;
  }
  const floored = Math.floor(value);
  if (floored === 0) return 0;
  return clamp(floored, 2, 40);
}

export function formatIterationBudget(maxIterations: number): string {
  return maxIterations === 0 ? "unbounded" : String(maxIterations);
}

export function formatIterationProgress(iterationsUsed: number, maxIterations: number): string {
  return `${iterationsUsed}/${formatIterationBudget(maxIterations)}`;
}

export function looksLikeMutationGoal(goal: string): boolean {
  return /(?:create|write|implement|build|fix|refactor|add|generate|code|project|file|backend|frontend)/i.test(
    goal
  );
}

export function normalizeAgentSettings(
  input: Partial<AgentSettings> | null | undefined
): AgentSettings {
  const merged = {
    ...DEFAULT_SETTINGS,
    ...(input || {}),
  };

  return {
    executionMode: merged.executionMode === "single" ? "single" : "multi",
    maxIterations: normalizeMaxIterations(Number(merged.maxIterations)),
    maxParallelWorkUnits: clamp(Number(merged.maxParallelWorkUnits), 1, 8),
    criticPassThreshold: Math.max(0.2, Math.min(0.95, Number(merged.criticPassThreshold))),
    teamSize: clamp(Number(merged.teamSize), 1, 100),
    runPreflightChecks: Boolean(merged.runPreflightChecks),
    resumeFromLastCheckpoint: Boolean(merged.resumeFromLastCheckpoint),
    requireClarificationBeforeEdits: Boolean(merged.requireClarificationBeforeEdits),
    strictVerification: Boolean(merged.strictVerification),
    autoFixVerification: Boolean(merged.autoFixVerification),
    dryRun: Boolean(merged.dryRun),
    rollbackOnFailure: Boolean(merged.rollbackOnFailure),
    maxFileWrites: clamp(Number(merged.maxFileWrites), 1, 120),
    maxCommandRuns: clamp(Number(merged.maxCommandRuns), 1, 140),
    modelOverride: String(merged.modelOverride || ""),
    customVerificationCommands: String(merged.customVerificationCommands || ""),
  };
}

export function formatDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs < 0) return "0ms";
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`;
  if (durationMs < 10000) return `${(durationMs / 1000).toFixed(1)}s`;
  return `${Math.round(durationMs / 1000)}s`;
}

export function toSafeFileToken(value: string): string {
  const cleaned = value.trim().replace(/[^a-zA-Z0-9_-]+/g, "_");
  return cleaned.length > 0 ? cleaned : "run";
}

export function buildTelemetryExport(result: AgentRunResult) {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    run: {
      runId: result.runId || null,
      resumedFromRunId: result.resumedFromRunId || null,
      status: result.status,
      executionMode: result.executionMode,
      goal: result.goal,
      model: result.model,
      startedAt: result.startedAt,
      finishedAt: result.finishedAt,
      summary: result.summary,
      error: result.error || null,
    },
    budgets: {
      maxIterations: result.maxIterations,
      iterationsUsed: result.iterationsUsed,
      fileWriteCount: result.fileWriteCount,
      commandRunCount: result.commandRunCount,
      strictVerification: result.strictVerification,
      autoFixVerification: result.autoFixVerification,
      dryRun: result.dryRun,
      rollbackOnFailure: result.rollbackOnFailure,
      rollbackApplied: result.rollbackApplied,
      rollbackSummary: result.rollbackSummary,
    },
    quality: {
      verificationAttempts: result.verificationAttempts,
      verificationPassed: result.verificationPassed,
      verificationCommands: result.verificationCommands,
      verificationChecks: result.verificationChecks,
      preflightPassed: result.preflightPassed,
      preflightChecks: result.preflightChecks,
      verificationNotes: result.verification,
      remainingWork: result.remainingWork,
      zeroKnownIssues: result.zeroKnownIssues,
    },
    files: {
      filesChanged: result.filesChanged,
      filesChangedCount: result.filesChanged.length,
      commandsRun: result.commandsRun,
      changeJournal: result.changeJournal,
    },
    project: {
      digest: result.projectDigest,
      intelligence: result.projectIntelligence,
    },
    team: {
      teamSize: result.teamSize,
      teamRoster: result.teamRoster,
    },
    clarification: {
      required: result.clarificationRequired,
      questions: result.clarificationQuestions,
      answersUsed: result.clarificationAnswersUsed,
    },
    steps: result.steps,
    multiAgentReport: result.multiAgentReport || null,
  };
}

export function normalizeRunResult(run: AgentRunResult): AgentRunResult {
  return {
    ...run,
    runId: typeof run.runId === "string" ? run.runId : undefined,
    resumedFromRunId:
      typeof run.resumedFromRunId === "string" ? run.resumedFromRunId : undefined,
    executionMode: run.executionMode === "single" ? "single" : "multi",
    verification: Array.isArray(run.verification) ? run.verification : [],
    remainingWork: Array.isArray(run.remainingWork) ? run.remainingWork : [],
    filesChanged: Array.isArray(run.filesChanged) ? run.filesChanged : [],
    commandsRun: Array.isArray(run.commandsRun) ? run.commandsRun : [],
    verificationCommands: Array.isArray(run.verificationCommands)
      ? run.verificationCommands
      : [],
    verificationChecks: Array.isArray(run.verificationChecks) ? run.verificationChecks : [],
    teamRoster: Array.isArray(run.teamRoster) ? run.teamRoster : [],
    preflightChecks: Array.isArray(run.preflightChecks) ? run.preflightChecks : [],
    clarificationQuestions: Array.isArray(run.clarificationQuestions)
      ? run.clarificationQuestions
          .map((question) => {
            if (!question || typeof question !== "object") return null;
            const typedQuestion = question as Partial<ClarificationQuestion>;
            const id =
              typeof typedQuestion.id === "string" && typedQuestion.id.trim().length > 0
                ? typedQuestion.id.trim()
                : "";
            const prompt =
              typeof typedQuestion.question === "string"
                ? typedQuestion.question.trim()
                : "";
            if (!id || !prompt) return null;

            const options = Array.isArray(typedQuestion.options)
              ? typedQuestion.options
                  .map((option) => {
                    if (!option || typeof option !== "object") return null;
                    const typedOption = option as Partial<ClarificationOption>;
                    const optionId =
                      typeof typedOption.id === "string" && typedOption.id.trim().length > 0
                        ? typedOption.id.trim()
                        : "";
                    const optionLabel =
                      typeof typedOption.label === "string" ? typedOption.label.trim() : "";
                    const optionValue =
                      typeof typedOption.value === "string" ? typedOption.value.trim() : "";
                    if (!optionId || !optionLabel || !optionValue) return null;

                    return {
                      id: optionId,
                      label: optionLabel,
                      value: optionValue,
                      description:
                        typeof typedOption.description === "string"
                          ? typedOption.description
                          : undefined,
                      recommended:
                        typeof typedOption.recommended === "boolean"
                          ? typedOption.recommended
                          : undefined,
                    } as ClarificationOption;
                  })
                  .filter((option): option is ClarificationOption => option !== null)
              : [];

            return {
              id,
              question: prompt,
              rationale:
                typeof typedQuestion.rationale === "string" ? typedQuestion.rationale : "",
              required: Boolean(typedQuestion.required),
              options,
              allowCustomAnswer:
                typeof typedQuestion.allowCustomAnswer === "boolean"
                  ? typedQuestion.allowCustomAnswer
                  : true,
            } as ClarificationQuestion;
          })
          .filter((question): question is ClarificationQuestion => question !== null)
      : [],
    clarificationAnswersUsed:
      run.clarificationAnswersUsed && typeof run.clarificationAnswersUsed === "object"
        ? run.clarificationAnswersUsed
        : {},
    projectDigest:
      run.projectDigest && typeof run.projectDigest === "object"
        ? run.projectDigest
        : {
            workspace: "",
            keyDirectories: [],
            packageScripts: [],
            languageHints: [],
            hasTests: false,
            treePreview: "",
          },
    projectIntelligence:
      run.projectIntelligence && typeof run.projectIntelligence === "object"
        ? run.projectIntelligence
        : ({
            generatedAt: "",
            workspace: "",
            stack: [],
            topDirectories: [],
            packageScripts: [],
            testFileCount: 0,
            hotspots: [],
            moduleEdges: [],
            signals: [],
            summary: "",
          } as ProjectIntelligence),
    rollbackSummary: Array.isArray(run.rollbackSummary) ? run.rollbackSummary : [],
    changeJournal: Array.isArray(run.changeJournal) ? run.changeJournal : [],
    rollbackOnFailure: Boolean(run.rollbackOnFailure),
    rollbackApplied: Boolean(run.rollbackApplied),
    teamSize: Number.isFinite(run.teamSize) ? run.teamSize : 1,
    runPreflightChecks: Boolean(run.runPreflightChecks),
    preflightPassed:
      typeof run.preflightPassed === "boolean" || run.preflightPassed === null
        ? run.preflightPassed
        : null,
    clarificationRequired: Boolean(run.clarificationRequired),
    zeroKnownIssues: Boolean(run.zeroKnownIssues),
    multiAgentReport:
      run.multiAgentReport && typeof run.multiAgentReport === "object"
        ? {
            strategy:
              typeof run.multiAgentReport.strategy === "string"
                ? run.multiAgentReport.strategy
                : "",
            finalChecks: Array.isArray(run.multiAgentReport.finalChecks)
              ? run.multiAgentReport.finalChecks
              : [],
            workUnits: Array.isArray(run.multiAgentReport.workUnits)
              ? run.multiAgentReport.workUnits
              : [],
            artifacts: Array.isArray(run.multiAgentReport.artifacts)
              ? run.multiAgentReport.artifacts
              : [],
            flakyQuarantinedCommands: Array.isArray(
              run.multiAgentReport.flakyQuarantinedCommands
            )
              ? run.multiAgentReport.flakyQuarantinedCommands
              : [],
            observability:
              run.multiAgentReport.observability &&
              typeof run.multiAgentReport.observability === "object"
                ? {
                    totalDurationMs:
                      typeof run.multiAgentReport.observability.totalDurationMs === "number"
                        ? run.multiAgentReport.observability.totalDurationMs
                        : 0,
                    modelUsage: Array.isArray(run.multiAgentReport.observability.modelUsage)
                      ? run.multiAgentReport.observability.modelUsage
                      : [],
                    unitMetrics: Array.isArray(run.multiAgentReport.observability.unitMetrics)
                      ? run.multiAgentReport.observability.unitMetrics
                      : [],
                    failureHeatmap: Array.isArray(
                      run.multiAgentReport.observability.failureHeatmap
                    )
                      ? run.multiAgentReport.observability.failureHeatmap
                      : [],
                  }
                : {
                    totalDurationMs: 0,
                    modelUsage: [],
                    unitMetrics: [],
                    failureHeatmap: [],
                  },
          }
        : undefined,
  };
}

function tokenizeCommandLine(line: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaped = false;

  for (const char of line) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (escaped || quote) {
    throw new Error("Unclosed quote or trailing escape in command line");
  }

  if (current) tokens.push(current);

  return tokens;
}

export function parseVerificationCommands(text: string): AgentCommand[] {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));

  const commands: AgentCommand[] = [];

  for (const line of lines) {
    const parts = tokenizeCommandLine(line);
    if (parts.length === 0) continue;

    const [program, ...args] = parts;
    commands.push({ program, args });
  }

  return commands;
}

export function listActionPaths(action: AgentAction): string[] {
  switch (action.type) {
    case "read_file":
    case "write_file":
    case "append_file":
    case "delete_file": {
      const pathValue = action.path;
      if (typeof pathValue === "string" && pathValue.trim().length > 0) {
        return [pathValue.trim()];
      }
      return [];
    }
    case "read_many_files": {
      const raw = action.paths;
      if (!Array.isArray(raw)) return [];
      return raw
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean);
    }
    default:
      return [];
  }
}

export function resolveAgentStreamEndpoint(): string {
  const configured = process.env.NEXT_PUBLIC_BACKEND_API_ORIGIN;
  if (typeof configured !== "string" || configured.trim().length === 0) {
    return "/api/agent/stream";
  }

  const normalizedOrigin = configured.trim().replace(/\/+$/, "");
  if (!normalizedOrigin) {
    return "/api/agent/stream";
  }

  return `${normalizedOrigin}/api/agent/stream`;
}

export function flattenTreeFiles(nodes: FileTreeNode[]): string[] {
  const files: string[] = [];

  const walk = (items: FileTreeNode[]) => {
    for (const item of items) {
      if (item.type === "file") {
        if (typeof item.path === "string" && item.path.trim().length > 0) {
          files.push(item.path.trim());
        }
      } else if (Array.isArray(item.children) && item.children.length > 0) {
        walk(item.children);
      }
    }
  };

  walk(nodes);
  return files;
}

export function formatMemoryDiagnosticsForPrompt(
  diagnostics: MemoryRetrievalDiagnostics | null | undefined
): string {
  if (!diagnostics) return "(none)";
  if (diagnostics.conflictCount === 0) {
    return "No contradictory memory pairs detected.";
  }
  return [
    `Conflict count: ${diagnostics.conflictCount}`,
    ...diagnostics.guidance.map((line) => `- ${line}`),
  ].join("\n");
}

export function normalizeBoolean(value: unknown, fallback: boolean = false): boolean {
  if (typeof value === "boolean") return value;
  return fallback;
}

export function normalizeVerificationChecks(value: unknown): VerificationCheckResult[] {
  if (!Array.isArray(value)) return [];
  return value as VerificationCheckResult[];
}
