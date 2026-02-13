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

function attachFallbackContext(
  fallbackResult: AgentRunResult,
  contextLine: string
): AgentRunResult {
  return {
    ...fallbackResult,
    summary: `${contextLine}\n${fallbackResult.summary}`.trim(),
    verification: dedupeLines([...fallbackResult.verification, contextLine]),
    remainingWork:
      fallbackResult.status === "completed"
        ? fallbackResult.remainingWork
        : dedupeLines([...fallbackResult.remainingWork, contextLine]),
  };
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message.trim();
  }
  return "multi-agent runtime error";
}

export async function runAgentWithAutoFallback(
  request: AgentRunRequest,
  hooks?: AgentRunHooks
): Promise<{
  result: AgentRunResult;
  fallbackUsed: boolean;
  primaryResult?: AgentRunResult;
}> {
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
      result: attachFallbackContext(fallbackResult, fallbackMessage),
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
    result: attachFallbackContext(fallbackResult, fallbackMessage),
    fallbackUsed: true,
    primaryResult,
  };
}
