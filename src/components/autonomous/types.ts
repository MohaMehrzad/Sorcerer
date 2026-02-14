export interface AgentCommand {
  program: string;
  args?: string[];
  cwd?: string;
}

export interface AgentAction {
  type: string;
  [key: string]: unknown;
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

export interface IntelligenceSignal {
  key: string;
  label: string;
  count: number;
  severity: "low" | "medium" | "high";
  samples: string[];
}

export interface FileHotspot {
  path: string;
  lines: number;
}

export interface ModuleEdge {
  from: string;
  to: string;
}

export type AgentExecutionMode = "single" | "multi";

export interface ClarificationOption {
  id: string;
  label: string;
  value: string;
  description?: string;
  recommended?: boolean;
}

export interface ClarificationQuestion {
  id: string;
  question: string;
  rationale: string;
  required: boolean;
  options?: ClarificationOption[];
  allowCustomAnswer?: boolean;
}

export interface FileTreeNode {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: FileTreeNode[];
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

export type MemoryEntryType =
  | "bug_pattern"
  | "fix_pattern"
  | "verification_rule"
  | "project_convention"
  | "continuation";

export interface LongTermMemoryEntry {
  id: string;
  workspace: string;
  type: MemoryEntryType;
  title: string;
  content: string;
  tags: string[];
  pinned: boolean;
  successScore: number;
  useCount: number;
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
  sourceRunId?: string;
  sourceGoal?: string;
  confidenceScore?: number;
  lastValidatedAt?: string;
  invalidatedAt?: string;
  evidence?: Array<{
    type: string;
    source: string;
    summary: string;
    createdAt: string;
  }>;
}

export interface ContinuationPacket {
  runId: string;
  executionMode: "single" | "multi";
  goal: string;
  summary: string;
  pendingWork: string[];
  nextActions: string[];
  createdAt: string;
}

export interface MemoryRetrievalDiagnostics {
  conflictCount: number;
  requiresVerificationBeforeMutation: boolean;
  guidance: string[];
}

export type AgentRunStatus =
  | "completed"
  | "max_iterations"
  | "verification_failed"
  | "needs_clarification"
  | "failed"
  | "canceled";

export interface AgentRunResult {
  status: AgentRunStatus;
  runId?: string;
  resumedFromRunId?: string;
  executionMode: AgentExecutionMode;
  goal: string;
  summary: string;
  error?: string;
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
  teamSize: number;
  teamRoster: string[];
  runPreflightChecks: boolean;
  preflightPassed: boolean | null;
  preflightChecks: VerificationCheckResult[];
  clarificationRequired: boolean;
  clarificationQuestions: ClarificationQuestion[];
  clarificationAnswersUsed: Record<string, string>;
  projectDigest: {
    workspace: string;
    keyDirectories: string[];
    packageScripts: string[];
    languageHints: string[];
    hasTests: boolean;
    treePreview: string;
  };
  projectIntelligence: ProjectIntelligence;
  zeroKnownIssues: boolean;
  verificationAttempts: number;
  verificationPassed: boolean | null;
  verificationCommands: AgentCommand[];
  verificationChecks: VerificationCheckResult[];
  rollbackApplied: boolean;
  rollbackSummary: string[];
  changeJournal: Array<{
    op: "write" | "append" | "delete";
    path: string;
    timestamp: string;
    details: string;
  }>;
  iterationsUsed: number;
  maxIterations: number;
  steps: AgentStep[];
  startedAt: string;
  finishedAt: string;
  model: string;
  multiAgentReport?: {
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
  };
}

export type AgentStreamEvent =
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
    }
  | {
      type: "completed";
      data: {
        result: AgentRunResult;
      };
    }
  | {
      type: "failed";
      data: {
        result?: AgentRunResult;
        error?: string;
      };
    };

export interface AgentSettings {
  executionMode: AgentExecutionMode;
  maxIterations: number;
  maxParallelWorkUnits: number;
  criticPassThreshold: number;
  teamSize: number;
  runPreflightChecks: boolean;
  resumeFromLastCheckpoint: boolean;
  requireClarificationBeforeEdits: boolean;
  strictVerification: boolean;
  autoFixVerification: boolean;
  dryRun: boolean;
  rollbackOnFailure: boolean;
  maxFileWrites: number;
  maxCommandRuns: number;
  modelOverride: string;
  customVerificationCommands: string;
}

export interface RuntimeModelConfig {
  apiUrl: string;
  apiKey: string;
  model: string;
}

export interface AutonomousPanelProps {
  open?: boolean;
  onClose?: () => void;
  onPublishReport?: (report: string) => void;
  botName?: string;
  workspacePath?: string;
  enabledSkillFiles?: string[];
  modelConfig?: RuntimeModelConfig;
  embedded?: boolean;
}
