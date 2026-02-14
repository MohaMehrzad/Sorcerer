import {
  AgentRunHooks,
  AgentRunRequest,
  AgentRunResult,
  runAutonomousAgent,
} from "@/lib/server/agentRunner";
import { runMultiAgentAutonomous } from "@/lib/server/multiAgentRunner";

const FALLBACK_TRIGGER_STATUSES = new Set<AgentRunResult["status"]>([
  "failed",
  "max_iterations",
  "verification_failed",
]);

const SUPERVISOR_RETRYABLE_STATUSES = new Set<AgentRunResult["status"]>([
  "failed",
  "max_iterations",
  "verification_failed",
]);

const SUPERVISOR_MAX_CYCLES = 6;
const SUPERVISOR_MAX_RUNTIME_MS = 20 * 60 * 1000;
const SUPERVISOR_MAX_NO_PROGRESS_CYCLES = 2;
const MAX_CONTRACT_CRITERIA = 6;

const CONTRACT_STOP_WORDS = new Set([
  "the",
  "and",
  "with",
  "from",
  "that",
  "this",
  "your",
  "into",
  "over",
  "under",
  "after",
  "before",
  "then",
  "when",
  "while",
  "must",
  "should",
  "need",
  "needs",
  "make",
  "real",
  "fully",
  "complete",
  "project",
  "autonomous",
]);

function goalLikelyRequiresCodeMutation(goal: string): boolean {
  return /(?:create|write|implement|build|fix|refactor|add|generate|code|project|file|backend|frontend)/i.test(
    goal
  );
}

function shouldFallbackToSingle(
  request: AgentRunRequest,
  primaryResult: AgentRunResult
): boolean {
  if (request.executionMode !== "multi") return false;
  if (request.dryRun) return false;
  if (primaryResult.status === "canceled") return false;
  if (!goalLikelyRequiresCodeMutation(request.goal)) return false;
  if (primaryResult.fileWriteCount > 0) return false;
  if (primaryResult.executionMode !== "multi") return false;

  return (
    FALLBACK_TRIGGER_STATUSES.has(primaryResult.status) ||
    primaryResult.status === "completed"
  );
}

function buildSingleFallbackRequest(request: AgentRunRequest): AgentRunRequest {
  const fallbackIterations =
    request.maxIterations === 0
      ? 0
      : Math.max(6, Math.min(request.maxIterations, 24));
  return {
    ...request,
    executionMode: "single",
    resumeRunId: undefined,
    resumeFromLastCheckpoint: false,
    runPreflightChecks: false,
    strictVerification: false,
    rollbackOnFailure: false,
    requireClarificationBeforeEdits: false,
    maxIterations: fallbackIterations,
  };
}

function dedupeLines(items: string[]): string[] {
  return Array.from(new Set(items.filter((item) => item.trim().length > 0)));
}

function attachContextLine(
  result: AgentRunResult,
  contextLine: string,
  includeRemainingWorkWhenCompleted = false
): AgentRunResult {
  return {
    ...result,
    summary: `${contextLine}\n${result.summary}`.trim(),
    verification: dedupeLines([...result.verification, contextLine]),
    remainingWork:
      result.status === "completed" && !includeRemainingWorkWhenCompleted
        ? result.remainingWork
        : dedupeLines([...result.remainingWork, contextLine]),
  };
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message.trim();
  }
  return "multi-agent runtime error";
}

interface RunCycleResult {
  result: AgentRunResult;
  fallbackUsed: boolean;
  primaryResult?: AgentRunResult;
}

async function runCycle(
  request: AgentRunRequest,
  hooks?: AgentRunHooks
): Promise<RunCycleResult> {
  if (request.executionMode !== "multi") {
    const result = await runAutonomousAgent(request, hooks);
    return {
      result,
      fallbackUsed: false,
    };
  }

  let primaryResult: AgentRunResult;
  try {
    primaryResult = await runMultiAgentAutonomous(request, hooks);
  } catch (error) {
    if (hooks?.signal?.aborted || request.dryRun || !goalLikelyRequiresCodeMutation(request.goal)) {
      throw error;
    }
    const fallbackMessage = `Auto-fallback triggered: multi-agent error=${toErrorMessage(error)}. Retrying with single-agent mode.`;
    hooks?.onEvent?.({
      type: "status",
      data: {
        message: fallbackMessage,
      },
    });
    const fallbackResult = await runAutonomousAgent(
      buildSingleFallbackRequest(request),
      hooks
    );
    return {
      result: attachContextLine(fallbackResult, fallbackMessage),
      fallbackUsed: true,
    };
  }

  if (!shouldFallbackToSingle(request, primaryResult)) {
    return {
      result: primaryResult,
      fallbackUsed: false,
    };
  }

  const fallbackMessage = `Auto-fallback triggered: multi-agent status=${primaryResult.status}, fileWrites=${primaryResult.fileWriteCount}. Retrying with single-agent mode.`;
  hooks?.onEvent?.({
    type: "status",
    data: {
      message: fallbackMessage,
    },
  });

  const fallbackResult = await runAutonomousAgent(
    buildSingleFallbackRequest(request),
    hooks
  );

  return {
    result: attachContextLine(fallbackResult, fallbackMessage),
    fallbackUsed: true,
    primaryResult,
  };
}

function extractCompletionCriteria(goal: string): string[] {
  const normalized = goal
    .replace(/\r/g, "\n")
    .split(/\n+/)
    .map((line) => line.replace(/^[-*\d.)\s]+/, "").trim())
    .filter((line) => line.length >= 12)
    .flatMap((line) => line.split(/[.;]+/).map((part) => part.trim()))
    .filter((line) => line.length >= 12)
    .slice(0, MAX_CONTRACT_CRITERIA * 2);

  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const row of normalized) {
    const key = row.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(row);
    if (deduped.length >= MAX_CONTRACT_CRITERIA) break;
  }

  if (deduped.length > 0) {
    return deduped;
  }

  return [goal.trim()].filter((value) => value.length > 0).slice(0, 1);
}

function tokenizeCriterion(criterion: string): string[] {
  const tokens = criterion
    .toLowerCase()
    .match(/[a-z0-9]{4,}/g);
  if (!tokens) return [];
  return tokens
    .filter((token) => !CONTRACT_STOP_WORDS.has(token))
    .slice(0, 10);
}

interface CompletionContractEvaluation {
  passed: boolean;
  criteria: string[];
  missingCriteria: string[];
  reasons: string[];
}

function evaluateCompletionContract(
  goal: string,
  result: AgentRunResult
): CompletionContractEvaluation {
  const criteria = extractCompletionCriteria(goal);
  const evidenceText = [
    result.summary,
    result.verification.join("\n"),
    result.filesChanged.join("\n"),
    result.commandsRun.slice(-30).join("\n"),
  ]
    .join("\n")
    .toLowerCase();

  const missingCriteria: string[] = [];
  for (const criterion of criteria) {
    const tokens = tokenizeCriterion(criterion);
    if (tokens.length === 0) continue;
    const requiredMatches = Math.min(3, Math.max(1, Math.ceil(tokens.length / 2)));
    const matches = tokens.reduce(
      (count, token) => (evidenceText.includes(token) ? count + 1 : count),
      0
    );
    if (matches < requiredMatches) {
      missingCriteria.push(criterion);
    }
  }

  const reasons: string[] = [];
  if (result.remainingWork.length > 0) {
    reasons.push("Run reported remaining work and cannot be accepted as complete.");
  }
  if (goalLikelyRequiresCodeMutation(goal) && result.fileWriteCount === 0) {
    reasons.push("Coding goal completed without file mutations.");
  }
  if (result.strictVerification && result.verificationPassed === false) {
    reasons.push("Strict verification is enabled but quality gates failed.");
  }
  if (missingCriteria.length > 0) {
    reasons.push(`Missing evidence for ${missingCriteria.length} completion criteria.`);
  }

  return {
    passed: reasons.length === 0,
    criteria,
    missingCriteria,
    reasons,
  };
}

function buildContractRepairGoal(
  baseGoal: string,
  evaluation: CompletionContractEvaluation,
  nextCycle: number
): string {
  const missingLines =
    evaluation.missingCriteria.length > 0
      ? evaluation.missingCriteria.map((item) => `- ${item}`).join("\n")
      : "- Provide explicit evidence for all required criteria.";
  return [
    baseGoal.trim(),
    "",
    `[Supervisor cycle ${nextCycle}] Completion contract gaps detected.`,
    "Do not finalize until each item below has explicit evidence in verification notes and outputs:",
    missingLines,
  ].join("\n");
}

function hasUsefulProgress(result: AgentRunResult): boolean {
  return (
    result.fileWriteCount > 0 ||
    result.commandRunCount > 0 ||
    result.filesChanged.length > 0 ||
    result.steps.length > 0 ||
    result.verificationChecks.length > 0
  );
}

function buildRecoveryRequest(params: {
  baseRequest: AgentRunRequest;
  cycleResult: AgentRunResult;
  fallbackUsedInCycle: boolean;
  completionEvaluation: CompletionContractEvaluation | null;
  nextCycle: number;
}): AgentRunRequest {
  const { baseRequest, cycleResult, fallbackUsedInCycle, completionEvaluation, nextCycle } =
    params;
  const recoverFromCheckpoint = cycleResult.status !== "completed";
  const recoverWithSingle =
    fallbackUsedInCycle || cycleResult.executionMode === "single";

  return {
    ...baseRequest,
    goal:
      completionEvaluation && !completionEvaluation.passed
        ? buildContractRepairGoal(baseRequest.goal, completionEvaluation, nextCycle)
        : baseRequest.goal,
    executionMode: recoverWithSingle ? "single" : baseRequest.executionMode,
    resumeFromLastCheckpoint: recoverFromCheckpoint,
    resumeRunId: recoverFromCheckpoint ? cycleResult.runId : undefined,
    rollbackOnFailure: false,
    requireClarificationBeforeEdits: false,
    strictVerification: baseRequest.strictVerification || cycleResult.status === "verification_failed",
    maxIterations:
      baseRequest.maxIterations === 0 ? 0 : Math.max(baseRequest.maxIterations, 24),
    maxFileWrites: Math.min(240, Math.max(baseRequest.maxFileWrites, Math.ceil(baseRequest.maxFileWrites * 1.25))),
    maxCommandRuns: Math.min(
      320,
      Math.max(baseRequest.maxCommandRuns, Math.ceil(baseRequest.maxCommandRuns * 1.25))
    ),
  };
}

export async function runAgentWithAutoFallback(
  request: AgentRunRequest,
  hooks?: AgentRunHooks
): Promise<{
  result: AgentRunResult;
  fallbackUsed: boolean;
  primaryResult?: AgentRunResult;
}> {
  const supervisorStartedAt = Date.now();
  let cycleRequest: AgentRunRequest = { ...request };
  let fallbackUsed = false;
  let primaryResult: AgentRunResult | undefined;
  let lastResult: AgentRunResult | undefined;
  let noProgressCycles = 0;

  for (let cycle = 1; cycle <= SUPERVISOR_MAX_CYCLES; cycle += 1) {
    hooks?.onEvent?.({
      type: "status",
      data: {
        message: `Supervisor cycle ${cycle}/${SUPERVISOR_MAX_CYCLES}: mode=${cycleRequest.executionMode}, resume=${cycleRequest.resumeFromLastCheckpoint}`,
      },
    });

    const cycleOutcome = await runCycle(cycleRequest, hooks);
    fallbackUsed = fallbackUsed || cycleOutcome.fallbackUsed;
    if (!primaryResult && cycleOutcome.primaryResult) {
      primaryResult = cycleOutcome.primaryResult;
    }

    const result = cycleOutcome.result;
    lastResult = result;

    if (result.status === "needs_clarification" || result.status === "canceled") {
      return {
        result,
        fallbackUsed,
        primaryResult,
      };
    }

    const completionEvaluation =
      result.status === "completed"
        ? evaluateCompletionContract(request.goal, result)
        : null;

    if (result.status === "completed" && completionEvaluation?.passed) {
      const contractLine = `Completion contract satisfied (${completionEvaluation.criteria.length} criteria validated).`;
      return {
        result: attachContextLine(result, contractLine),
        fallbackUsed,
        primaryResult,
      };
    }

    const contractFailed =
      result.status === "completed" &&
      completionEvaluation !== null &&
      !completionEvaluation.passed;

    if (contractFailed) {
      const reasonLine = [
        "Completion contract failed:",
        ...completionEvaluation.reasons.map((reason, index) => `${index + 1}. ${reason}`),
      ].join(" ");
      hooks?.onEvent?.({
        type: "status",
        data: {
          message: reasonLine,
        },
      });
    }

    const retryable = SUPERVISOR_RETRYABLE_STATUSES.has(result.status) || contractFailed;
    if (!retryable) {
      return {
        result,
        fallbackUsed,
        primaryResult,
      };
    }

    if (
      goalLikelyRequiresCodeMutation(request.goal) &&
      !hasUsefulProgress(result)
    ) {
      noProgressCycles += 1;
    } else {
      noProgressCycles = 0;
    }

    const elapsedMs = Date.now() - supervisorStartedAt;
    if (
      cycle >= SUPERVISOR_MAX_CYCLES ||
      elapsedMs >= SUPERVISOR_MAX_RUNTIME_MS ||
      noProgressCycles >= SUPERVISOR_MAX_NO_PROGRESS_CYCLES
    ) {
      break;
    }

    cycleRequest = buildRecoveryRequest({
      baseRequest: request,
      cycleResult: result,
      fallbackUsedInCycle: cycleOutcome.fallbackUsed,
      completionEvaluation,
      nextCycle: cycle + 1,
    });
  }

  if (!lastResult) {
    throw new Error("Supervisor failed to produce any run result");
  }

  const exhaustionLine =
    "Supervisor exhausted autonomous recovery cycles before reaching acceptance criteria.";

  const exhaustedResult = attachContextLine(
    {
      ...lastResult,
      status: lastResult.status === "completed" ? "failed" : lastResult.status,
    },
    exhaustionLine,
    true
  );

  return {
    result: exhaustedResult,
    fallbackUsed,
    primaryResult,
  };
}
