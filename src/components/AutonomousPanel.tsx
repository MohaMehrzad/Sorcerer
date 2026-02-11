"use client";

import { useEffect, useMemo, useRef, useState } from "react";

interface AgentCommand {
  program: string;
  args?: string[];
  cwd?: string;
}

interface AgentAction {
  type: string;
  [key: string]: unknown;
}

interface AgentStep {
  iteration: number;
  phase: "action" | "verification";
  thinking: string;
  action: AgentAction;
  ok: boolean;
  summary: string;
  output: string;
  durationMs: number;
}

interface VerificationCheckResult {
  attempt: number;
  command: AgentCommand;
  ok: boolean;
  output: string;
  durationMs: number;
}

interface IntelligenceSignal {
  key: string;
  label: string;
  count: number;
  severity: "low" | "medium" | "high";
  samples: string[];
}

interface FileHotspot {
  path: string;
  lines: number;
}

interface ModuleEdge {
  from: string;
  to: string;
}

interface ClarificationOption {
  id: string;
  label: string;
  value: string;
  description?: string;
  recommended?: boolean;
}

interface ClarificationQuestion {
  id: string;
  question: string;
  rationale: string;
  required: boolean;
  options?: ClarificationOption[];
  allowCustomAnswer?: boolean;
}

interface FileTreeNode {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: FileTreeNode[];
}

interface ProjectIntelligence {
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

type AgentRunStatus =
  | "completed"
  | "max_iterations"
  | "verification_failed"
  | "needs_clarification"
  | "failed"
  | "canceled";

interface AgentRunResult {
  status: AgentRunStatus;
  runId?: string;
  resumedFromRunId?: string;
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
}

type AgentStreamEvent =
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

interface AgentSettings {
  maxIterations: number;
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

interface RuntimeModelConfig {
  apiUrl: string;
  apiKey: string;
  model: string;
}

interface AutonomousPanelProps {
  open?: boolean;
  onClose?: () => void;
  onPublishReport?: (report: string) => void;
  botName?: string;
  workspacePath?: string;
  enabledSkillFiles?: string[];
  modelConfig?: RuntimeModelConfig;
  embedded?: boolean;
}

const SETTINGS_STORAGE_KEY = "autonomous-agent-settings-v1";
const HISTORY_STORAGE_KEY = "autonomous-agent-history-v1";
const MAX_HISTORY_ITEMS = 12;

const DEFAULT_SETTINGS: AgentSettings = {
  maxIterations: 18,
  teamSize: 8,
  runPreflightChecks: true,
  resumeFromLastCheckpoint: true,
  requireClarificationBeforeEdits: true,
  strictVerification: true,
  autoFixVerification: true,
  dryRun: false,
  rollbackOnFailure: true,
  maxFileWrites: 24,
  maxCommandRuns: 36,
  modelOverride: "",
  customVerificationCommands: "",
};

function commandToString(command: AgentCommand): string {
  const args = command.args || [];
  return `${command.program}${args.length > 0 ? ` ${args.join(" ")}` : ""}`;
}

function actionSummary(action: AgentAction): string {
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

function statusBadgeClass(status: AgentRunStatus): string {
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

function signalBadgeClass(severity: IntelligenceSignal["severity"]): string {
  if (severity === "high") {
    return "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300";
  }
  if (severity === "medium") {
    return "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300";
  }
  return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300";
}

function formatRunReport(result: AgentRunResult): string {
  const lines: string[] = [
    "## Autonomous Run Report",
    `- Run ID: ${result.runId || "(unknown)"}`,
    `- Resumed from run: ${result.resumedFromRunId || "(fresh run)"}`,
    `- Status: ${result.status}`,
    `- Model: ${result.model}`,
    `- Iterations: ${result.iterationsUsed}/${result.maxIterations}`,
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

  return lines.join("\n");
}

function parseStoredJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;

  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function normalizeRunResult(run: AgentRunResult): AgentRunResult {
  return {
    ...run,
    runId: typeof run.runId === "string" ? run.runId : undefined,
    resumedFromRunId:
      typeof run.resumedFromRunId === "string" ? run.resumedFromRunId : undefined,
    verification: Array.isArray(run.verification) ? run.verification : [],
    remainingWork: Array.isArray(run.remainingWork) ? run.remainingWork : [],
    filesChanged: Array.isArray(run.filesChanged) ? run.filesChanged : [],
    commandsRun: Array.isArray(run.commandsRun) ? run.commandsRun : [],
    verificationCommands: Array.isArray(run.verificationCommands)
      ? run.verificationCommands
      : [],
    verificationChecks: Array.isArray(run.verificationChecks)
      ? run.verificationChecks
      : [],
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
                      typeof typedOption.label === "string"
                        ? typedOption.label.trim()
                        : "";
                    const optionValue =
                      typeof typedOption.value === "string"
                        ? typedOption.value.trim()
                        : "";
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
                typeof typedQuestion.rationale === "string"
                  ? typedQuestion.rationale
                  : "",
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
        : {
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
          },
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

function parseVerificationCommands(text: string): AgentCommand[] {
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

function listActionPaths(action: AgentAction): string[] {
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

function flattenTreeFiles(nodes: FileTreeNode[]): string[] {
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

export default function AutonomousPanel({
  open = true,
  onClose,
  onPublishReport,
  botName,
  workspacePath,
  enabledSkillFiles = [],
  modelConfig,
  embedded = false,
}: AutonomousPanelProps) {
  const [goal, setGoal] = useState("");
  const [settings, setSettings] = useState<AgentSettings>(DEFAULT_SETTINGS);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [running, setRunning] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AgentRunResult | null>(null);

  const [liveSteps, setLiveSteps] = useState<AgentStep[]>([]);
  const [liveChecks, setLiveChecks] = useState<VerificationCheckResult[]>([]);
  const [clarificationAnswers, setClarificationAnswers] = useState<Record<string, string>>({});

  const [history, setHistory] = useState<AgentRunResult[]>([]);
  const [workspaceFiles, setWorkspaceFiles] = useState<string[]>([]);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);

  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const savedSettings = parseStoredJson<AgentSettings | null>(
      localStorage.getItem(SETTINGS_STORAGE_KEY),
      null
    );

    if (savedSettings) {
      setSettings({
        ...DEFAULT_SETTINGS,
        ...savedSettings,
      });
    }

    const savedHistory = parseStoredJson<AgentRunResult[]>(
      localStorage.getItem(HISTORY_STORAGE_KEY),
      []
    );

    if (Array.isArray(savedHistory)) {
      setHistory(savedHistory.map(normalizeRunResult).slice(0, MAX_HISTORY_ITEMS));
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(
      HISTORY_STORAGE_KEY,
      JSON.stringify(history.slice(0, MAX_HISTORY_ITEMS))
    );
  }, [history]);

  useEffect(() => {
    if (!open) return;

    const controller = new AbortController();
    setWorkspaceLoading(true);
    setWorkspaceError(null);

    fetch("/api/files", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "tree",
        maxDepth: 4,
        workspacePath,
      }),
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Workspace scan failed (${response.status})`);
        }
        return response.json() as Promise<{ tree?: FileTreeNode[] }>;
      })
      .then((data) => {
        const tree = Array.isArray(data.tree) ? data.tree : [];
        const files = flattenTreeFiles(tree).sort();
        setWorkspaceFiles(files);
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setWorkspaceError(err instanceof Error ? err.message : "Workspace scan failed");
        setWorkspaceFiles([]);
      })
      .finally(() => {
        setWorkspaceLoading(false);
      });

    return () => controller.abort();
  }, [open, workspacePath]);

  const canRun = goal.trim().length > 0 && !running;

  const liveStepCount = result ? result.steps.length : liveSteps.length;
  const effectiveSteps = result ? result.steps : liveSteps;

  const effectiveVerificationChecks = result
    ? result.verificationChecks
    : liveChecks;

  const filesAccessed = useMemo(() => {
    const accessSet = new Set<string>();

    for (const step of effectiveSteps) {
      for (const filePath of listActionPaths(step.action)) {
        accessSet.add(filePath);
      }
    }

    return Array.from(accessSet).sort();
  }, [effectiveSteps]);

  const filesEdited = useMemo(() => {
    const editedSet = new Set<string>();

    if (result) {
      for (const filePath of result.filesChanged) {
        if (typeof filePath === "string" && filePath.trim().length > 0) {
          editedSet.add(filePath.trim());
        }
      }
    }

    for (const step of effectiveSteps) {
      if (
        step.action.type !== "write_file" &&
        step.action.type !== "append_file" &&
        step.action.type !== "delete_file"
      ) {
        continue;
      }

      for (const filePath of listActionPaths(step.action)) {
        editedSet.add(filePath);
      }
    }

    return Array.from(editedSet).sort();
  }, [effectiveSteps, result]);

  const visibleWorkspaceFiles = useMemo(() => workspaceFiles.slice(0, 220), [workspaceFiles]);

  const currentStatusBadge = useMemo(() => {
    if (result) return statusBadgeClass(result.status);
    if (running) {
      return "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300";
    }
    return "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300";
  }, [result, running]);

  const pendingClarificationQuestions =
    result?.status === "needs_clarification" ? result.clarificationQuestions : [];
  const missingRequiredClarificationCount = pendingClarificationQuestions.filter(
    (question) => question.required && !(clarificationAnswers[question.id] || "").trim()
  ).length;

  function updateSettings<K extends keyof AgentSettings>(key: K, value: AgentSettings[K]) {
    setSettings((prev) => ({
      ...prev,
      [key]: value,
    }));
  }

  function pushHistory(run: AgentRunResult) {
    const normalized = normalizeRunResult(run);
    setHistory((prev) => [normalized, ...prev].slice(0, MAX_HISTORY_ITEMS));
  }

  function consumeStreamEvent(event: AgentStreamEvent) {
    switch (event.type) {
      case "started":
        setStatusMessage(
          `Started with model ${event.data.model}. teamSize=${event.data.teamSize}, strictVerification=${event.data.strictVerification}, preflight=${event.data.runPreflightChecks}, clarificationGate=${event.data.requireClarificationBeforeEdits}`
        );
        break;
      case "status":
        setStatusMessage(event.data.message);
        break;
      case "step":
        setLiveSteps((prev) => [...prev, event.data.step]);
        break;
      case "verification":
        setLiveChecks((prev) => [...prev, ...event.data.checks]);
        setStatusMessage(
          event.data.passed
            ? `Quality gates passed on attempt ${event.data.attempt}`
            : `Quality gates failed on attempt ${event.data.attempt}`
        );
        break;
      case "completed":
        setResult(normalizeRunResult(event.data.result));
        if (event.data.result.clarificationQuestions?.length) {
          const seeded = Object.fromEntries(
            event.data.result.clarificationQuestions.map((question) => [
              question.id,
              event.data.result.clarificationAnswersUsed?.[question.id] || "",
            ])
          );
          setClarificationAnswers(seeded);
        }
        pushHistory(event.data.result);
        break;
      case "failed":
        if (event.data.result) {
          const failedResult = event.data.result;
          setResult(normalizeRunResult(failedResult));
          if (failedResult.clarificationQuestions?.length) {
            const seeded = Object.fromEntries(
              failedResult.clarificationQuestions.map((question) => [
                question.id,
                failedResult.clarificationAnswersUsed?.[question.id] || "",
              ])
            );
            setClarificationAnswers(seeded);
          }
          pushHistory(failedResult);
          setError(failedResult.error || "Autonomous run failed");
        } else {
          setError(event.data.error || "Autonomous run failed");
        }
        break;
      default:
        break;
    }
  }

  async function runAutonomousAgent() {
    if (!goal.trim()) return;

    let verificationCommands: AgentCommand[] = [];
    try {
      verificationCommands = parseVerificationCommands(settings.customVerificationCommands);
    } catch (err) {
      setError(
        `Invalid verification commands: ${
          err instanceof Error ? err.message : "parse error"
        }`
      );
      return;
    }

    setRunning(true);
    setError(null);
    setStatusMessage("Starting autonomous run...");
    setResult(null);
    setLiveSteps([]);
    setLiveChecks([]);

    const controller = new AbortController();
    controllerRef.current = controller;

    try {
      const response = await fetch("/api/agent/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          goal: goal.trim(),
          model: settings.modelOverride.trim() || undefined,
          workspacePath,
          skillFiles:
            enabledSkillFiles.length > 0 ? enabledSkillFiles : undefined,
          modelConfig,
          resumeFromLastCheckpoint: settings.resumeFromLastCheckpoint,
          maxIterations: settings.maxIterations,
          teamSize: settings.teamSize,
          runPreflightChecks: settings.runPreflightChecks,
          requireClarificationBeforeEdits: settings.requireClarificationBeforeEdits,
          clarificationAnswers,
          strictVerification: settings.strictVerification,
          autoFixVerification: settings.autoFixVerification,
          dryRun: settings.dryRun,
          rollbackOnFailure: settings.rollbackOnFailure,
          verificationCommands: verificationCommands.length > 0 ? verificationCommands : undefined,
          maxFileWrites: settings.maxFileWrites,
          maxCommandRuns: settings.maxCommandRuns,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || `Agent run failed (${response.status})`);
      }

      if (!response.body) {
        throw new Error("Streaming response body is unavailable");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          try {
            const event = JSON.parse(trimmed) as AgentStreamEvent;
            consumeStreamEvent(event);
          } catch {
            // Ignore malformed chunks.
          }
        }
      }

      if (buffer.trim()) {
        try {
          const event = JSON.parse(buffer.trim()) as AgentStreamEvent;
          consumeStreamEvent(event);
        } catch {
          // Ignore final malformed chunk.
        }
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setError("Run canceled.");
        setStatusMessage("Canceled.");
      } else {
        setError(err instanceof Error ? err.message : "Failed to run autonomous agent");
      }
    } finally {
      setRunning(false);
      controllerRef.current = null;
    }
  }

  function cancelRun() {
    controllerRef.current?.abort();
  }

  function loadHistoryGoal(run: AgentRunResult) {
    setGoal(run.goal);
    const normalized = normalizeRunResult(run);
    setResult(normalized);
    setLiveSteps([]);
    setLiveChecks([]);
    if (normalized.clarificationQuestions.length > 0) {
      const seeded = Object.fromEntries(
        normalized.clarificationQuestions.map((question) => [
          question.id,
          normalized.clarificationAnswersUsed?.[question.id] || "",
        ])
      );
      setClarificationAnswers(seeded);
    } else {
      setClarificationAnswers({});
    }
    setStatusMessage(`Loaded historical run from ${run.finishedAt}`);
    setError(null);
  }

  if (!open) return null;

  const panel = (
    <section
      className={
        embedded
          ? "h-dvh w-full bg-white dark:bg-neutral-950 flex flex-col"
          : "fixed inset-y-0 right-0 z-50 w-full max-w-5xl bg-white dark:bg-neutral-950 border-l border-neutral-200 dark:border-neutral-800 shadow-2xl flex flex-col"
      }
    >
        <header className="px-5 py-4 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold">
              {(botName || "Assistant").trim()} Autonomous Programming Agent
            </h2>
            <p className="text-xs text-neutral-500 mt-1">
              Live planning, code edits, quality gates, and completion tracking.
            </p>
          </div>
          {!embedded && onClose && (
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors cursor-pointer"
              title="Close"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </header>

        <div className="px-5 py-4 border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900/40 space-y-3">
          <label className="block text-xs font-medium text-neutral-500">Goal</label>
          <p className="text-[11px] text-neutral-500 font-mono">
            Workspace: {workspacePath?.trim() || "(default workspace)"}
          </p>
          <textarea
            value={goal}
            onChange={(event) => setGoal(event.target.value)}
            placeholder="Example: Implement JWT auth, migrate DB schema, add tests, run lint/typecheck/build, and resolve all failures."
            className="w-full min-h-[120px] max-h-64 resize-y rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={running}
          />

          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-neutral-500">
              <span>Max iterations</span>
              <input
                type="number"
                min={2}
                max={40}
                value={settings.maxIterations}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  if (!Number.isFinite(value)) return;
                  updateSettings("maxIterations", clamp(value, 2, 40));
                }}
                className="w-20 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 py-1 text-sm"
                disabled={running}
              />
            </label>
            <label className="flex items-center gap-2 text-xs text-neutral-500">
              <span>Team size</span>
              <input
                type="number"
                min={1}
                max={100}
                value={settings.teamSize}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  if (!Number.isFinite(value)) return;
                  updateSettings("teamSize", clamp(value, 1, 100));
                }}
                className="w-20 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 py-1 text-sm"
                disabled={running}
              />
            </label>

            <button
              onClick={() => setShowAdvanced((value) => !value)}
              className="text-xs px-2.5 py-1.5 rounded-lg border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors cursor-pointer"
              type="button"
            >
              {showAdvanced ? "Hide Advanced" : "Show Advanced"}
            </button>

            <button
              onClick={runAutonomousAgent}
              disabled={!canRun}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
            >
              {running ? (
                <>
                  <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                    <path d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" fill="currentColor" className="opacity-75" />
                  </svg>
                  Running...
                </>
              ) : (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="5 3 19 12 5 21 5 3" />
                  </svg>
                  Start Autonomous Run
                </>
              )}
            </button>

            {running && (
              <button
                onClick={cancelRun}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-neutral-300 dark:border-neutral-700 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors cursor-pointer"
              >
                Cancel
              </button>
            )}

            <span className={`inline-flex items-center px-2 py-1 rounded-md text-xs font-medium ${currentStatusBadge}`}>
              {result ? result.status.replace("_", " ") : running ? "running" : "idle"}
            </span>
          </div>

          {showAdvanced && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 rounded-xl border border-neutral-200 dark:border-neutral-800 p-3 bg-white dark:bg-neutral-950">
              <label className="flex items-center justify-between gap-2 text-xs md:col-span-1">
                <span>Run preflight checks</span>
                <input
                  type="checkbox"
                  checked={settings.runPreflightChecks}
                  onChange={(event) =>
                    updateSettings("runPreflightChecks", event.target.checked)
                  }
                  disabled={running}
                />
              </label>
              <label className="flex items-center justify-between gap-2 text-xs md:col-span-1">
                <span>Resume from latest checkpoint</span>
                <input
                  type="checkbox"
                  checked={settings.resumeFromLastCheckpoint}
                  onChange={(event) =>
                    updateSettings("resumeFromLastCheckpoint", event.target.checked)
                  }
                  disabled={running}
                />
              </label>
              <label className="flex items-center justify-between gap-2 text-xs md:col-span-1">
                <span>Require clarification before edits</span>
                <input
                  type="checkbox"
                  checked={settings.requireClarificationBeforeEdits}
                  onChange={(event) =>
                    updateSettings("requireClarificationBeforeEdits", event.target.checked)
                  }
                  disabled={running}
                />
              </label>
              <label className="flex items-center justify-between gap-2 text-xs md:col-span-1">
                <span>Strict verification</span>
                <input
                  type="checkbox"
                  checked={settings.strictVerification}
                  onChange={(event) => updateSettings("strictVerification", event.target.checked)}
                  disabled={running}
                />
              </label>
              <label className="flex items-center justify-between gap-2 text-xs md:col-span-1">
                <span>Auto-fix on failed gates</span>
                <input
                  type="checkbox"
                  checked={settings.autoFixVerification}
                  onChange={(event) => updateSettings("autoFixVerification", event.target.checked)}
                  disabled={running}
                />
              </label>
              <label className="flex items-center justify-between gap-2 text-xs md:col-span-1">
                <span>Dry run (no writes/deletes)</span>
                <input
                  type="checkbox"
                  checked={settings.dryRun}
                  onChange={(event) => updateSettings("dryRun", event.target.checked)}
                  disabled={running}
                />
              </label>
              <label className="flex items-center justify-between gap-2 text-xs md:col-span-1">
                <span>Rollback on failure</span>
                <input
                  type="checkbox"
                  checked={settings.rollbackOnFailure}
                  onChange={(event) =>
                    updateSettings("rollbackOnFailure", event.target.checked)
                  }
                  disabled={running}
                />
              </label>

              <label className="flex items-center justify-between gap-2 text-xs md:col-span-1">
                <span>Max file writes</span>
                <input
                  type="number"
                  min={1}
                  max={120}
                  value={settings.maxFileWrites}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    if (!Number.isFinite(value)) return;
                    updateSettings("maxFileWrites", clamp(value, 1, 120));
                  }}
                  className="w-20 rounded border border-neutral-300 dark:border-neutral-700 px-2 py-1 bg-white dark:bg-neutral-900"
                  disabled={running}
                />
              </label>

              <label className="flex items-center justify-between gap-2 text-xs md:col-span-1">
                <span>Max command runs</span>
                <input
                  type="number"
                  min={1}
                  max={140}
                  value={settings.maxCommandRuns}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    if (!Number.isFinite(value)) return;
                    updateSettings("maxCommandRuns", clamp(value, 1, 140));
                  }}
                  className="w-20 rounded border border-neutral-300 dark:border-neutral-700 px-2 py-1 bg-white dark:bg-neutral-900"
                  disabled={running}
                />
              </label>

              <label className="flex flex-col gap-1 text-xs md:col-span-2">
                <span className="text-neutral-500">Model override (optional)</span>
                <input
                  type="text"
                  value={settings.modelOverride}
                  onChange={(event) => updateSettings("modelOverride", event.target.value)}
                  className="w-full rounded border border-neutral-300 dark:border-neutral-700 px-2 py-1.5 bg-white dark:bg-neutral-900"
                  placeholder="e.g. qwen3:30b-128k"
                  disabled={running}
                />
              </label>

              <label className="flex flex-col gap-1 text-xs md:col-span-2">
                <span className="text-neutral-500">
                  Custom verification commands (one per line, optional)
                </span>
                <textarea
                  value={settings.customVerificationCommands}
                  onChange={(event) =>
                    updateSettings("customVerificationCommands", event.target.value)
                  }
                  className="w-full min-h-[96px] rounded border border-neutral-300 dark:border-neutral-700 px-2 py-1.5 bg-white dark:bg-neutral-900 font-mono text-[11px]"
                  placeholder={"pnpm -s lint\npnpm -s exec tsc --noEmit\npnpm -s build"}
                  disabled={running}
                />
              </label>
            </div>
          )}

          {statusMessage && <p className="text-xs text-neutral-500">{statusMessage}</p>}
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        </div>

        <div className="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-[2fr_1fr] gap-0">
          <div className="min-h-0 overflow-y-auto p-5 space-y-4 border-r border-neutral-200 dark:border-neutral-800">
            <>
                <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 p-4 bg-white dark:bg-neutral-900/60">
                  <h3 className="text-sm font-semibold mb-2">Run Summary</h3>
                  <p className="text-sm whitespace-pre-wrap">
                    {result
                      ? result.summary || result.error || "No summary returned."
                      : running
                        ? "Autonomous run in progress..."
                        : "No run yet. Set a goal and start an autonomous run."}
                  </p>

                  <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs text-neutral-500">
                    <div>
                      Iterations: <span className="font-mono">{result ? `${result.iterationsUsed}/${result.maxIterations}` : `${liveStepCount}/${settings.maxIterations}`}</span>
                    </div>
                    <div>
                      Files changed: <span className="font-mono">{result ? result.filesChanged.length : "..."}</span>
                    </div>
                    <div>
                      Verification checks: <span className="font-mono">{effectiveVerificationChecks.length}</span>
                    </div>
                  </div>

                  {result && (
                    <div className="mt-3 text-xs text-neutral-500 space-y-1">
                      <div>Run ID: <span className="font-mono">{result.runId || "(unknown)"}</span></div>
                      <div>Resumed from: <span className="font-mono">{result.resumedFromRunId || "(fresh run)"}</span></div>
                      <div>Team size: <span className="font-mono">{result.teamSize}</span></div>
                      <div>Run preflight checks: <span className="font-mono">{String(result.runPreflightChecks)}</span></div>
                      <div>Preflight passed: <span className="font-mono">{String(result.preflightPassed)}</span></div>
                      <div>Zero known issues: <span className="font-mono">{String(result.zeroKnownIssues)}</span></div>
                      <div>Intelligence summary: <span className="font-mono">{result.projectIntelligence.summary || "(none)"}</span></div>
                      <div>File writes: <span className="font-mono">{result.fileWriteCount}</span></div>
                      <div>Command runs: <span className="font-mono">{result.commandRunCount}</span></div>
                      <div>Verification attempts: <span className="font-mono">{result.verificationAttempts}</span></div>
                      <div>Verification passed: <span className="font-mono">{String(result.verificationPassed)}</span></div>
                      <div>Rollback on failure: <span className="font-mono">{String(result.rollbackOnFailure)}</span></div>
                      <div>Rollback applied: <span className="font-mono">{String(result.rollbackApplied)}</span></div>
                    </div>
                  )}

                  {result?.verificationCommands.length ? (
                    <div className="mt-3">
                      <div className="text-xs font-semibold uppercase tracking-wider text-neutral-500 mb-1">
                        Quality Gates
                      </div>
                      <ul className="space-y-1 text-xs font-mono">
                        {result.verificationCommands.map((command, index) => (
                          <li key={`${commandToString(command)}-${index}`}>
                            {commandToString(command)}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {onPublishReport && result && (
                    <button
                      onClick={() => onPublishReport(formatRunReport(result))}
                      className="mt-4 px-3 py-2 rounded-lg border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-sm transition-colors cursor-pointer"
                    >
                      Publish Report To Chat
                    </button>
                  )}
                </div>

                {result?.status === "needs_clarification" && (
                  <div className="rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 p-4 space-y-3">
                    <div>
                      <h3 className="text-sm font-semibold text-amber-800 dark:text-amber-200">
                        Clarification Required Before Editing
                      </h3>
                      <p className="text-xs mt-1 text-amber-700 dark:text-amber-300">
                        Answer the questions below. The agent will use these answers before writing or editing files.
                      </p>
                    </div>

                    <div className="space-y-3">
                      {pendingClarificationQuestions.map((question) => (
                        <div key={question.id} className="rounded-lg border border-amber-200 dark:border-amber-800 p-3 bg-white dark:bg-neutral-950">
                          <div className="flex items-center gap-2 text-xs">
                            <span className="font-mono text-amber-700 dark:text-amber-300">{question.id}</span>
                            {question.required && (
                              <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">
                                required
                              </span>
                            )}
                          </div>
                          <p className="text-sm mt-1">{question.question}</p>
                          <p className="text-xs text-neutral-500 mt-1">{question.rationale}</p>
                          {question.options && question.options.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-2">
                              {question.options.map((option) => {
                                const selected =
                                  (clarificationAnswers[question.id] || "").trim() ===
                                  option.value;

                                return (
                                  <button
                                    key={`${question.id}-${option.id}`}
                                    type="button"
                                    onClick={() =>
                                      setClarificationAnswers((prev) => ({
                                        ...prev,
                                        [question.id]: option.value,
                                      }))
                                    }
                                    className={`px-2.5 py-1.5 rounded-lg border text-xs transition-colors cursor-pointer ${
                                      selected
                                        ? "border-amber-500 bg-amber-100 text-amber-900 dark:border-amber-600 dark:bg-amber-900/40 dark:text-amber-200"
                                        : "border-neutral-300 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-900"
                                    }`}
                                    title={option.description || option.value}
                                    disabled={running}
                                  >
                                    <span>{option.label}</span>
                                    {option.recommended && (
                                      <span className="ml-1 text-[10px] uppercase tracking-wide opacity-80">
                                        recommended
                                      </span>
                                    )}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                          <textarea
                            value={clarificationAnswers[question.id] || ""}
                            onChange={(event) =>
                              setClarificationAnswers((prev) => ({
                                ...prev,
                                [question.id]: event.target.value,
                              }))
                            }
                            className="mt-2 w-full min-h-[72px] rounded border border-neutral-300 dark:border-neutral-700 px-2 py-1.5 text-sm bg-white dark:bg-neutral-900"
                            placeholder={
                              question.options && question.options.length > 0
                                ? "Pick an option above or type a custom answer..."
                                : "Your answer..."
                            }
                            disabled={running || question.allowCustomAnswer === false}
                          />
                        </div>
                      ))}
                    </div>

                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs text-amber-700 dark:text-amber-300">
                        Missing required answers: {missingRequiredClarificationCount}
                      </p>
                      <button
                        onClick={runAutonomousAgent}
                        disabled={running || missingRequiredClarificationCount > 0}
                        className="px-3 py-2 rounded-lg bg-amber-600 text-white text-sm hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
                      >
                        Continue With Answers
                      </button>
                    </div>
                  </div>
                )}

                {result && (
                  <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 overflow-hidden">
                    <div className="px-4 py-3 border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900/40">
                      <h3 className="text-sm font-semibold">Project Digest</h3>
                    </div>
                    <div className="p-4 space-y-2 text-xs">
                      <div>Workspace: <span className="font-mono">{result.projectDigest.workspace}</span></div>
                      <div>Language hints: <span className="font-mono">{result.projectDigest.languageHints.join(", ") || "(none)"}</span></div>
                      <div>Has tests: <span className="font-mono">{String(result.projectDigest.hasTests)}</span></div>
                      <div>Key directories: <span className="font-mono">{result.projectDigest.keyDirectories.join(", ") || "(none)"}</span></div>
                      <details>
                        <summary className="cursor-pointer text-xs text-neutral-500">Tree preview</summary>
                        <pre className="mt-2 text-[11px] rounded bg-neutral-100 dark:bg-neutral-900 p-3 max-h-56 overflow-auto whitespace-pre-wrap">{result.projectDigest.treePreview || "(none)"}</pre>
                      </details>
                    </div>
                  </div>
                )}

                {result && (
                  <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 overflow-hidden">
                    <div className="px-4 py-3 border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900/40">
                      <h3 className="text-sm font-semibold">Project Intelligence</h3>
                    </div>
                    <div className="p-4 space-y-3 text-xs">
                      <div>Generated: <span className="font-mono">{result.projectIntelligence.generatedAt || "(unknown)"}</span></div>
                      <div>Workspace: <span className="font-mono">{result.projectIntelligence.workspace || result.projectDigest.workspace}</span></div>
                      <div>Summary: <span className="font-mono">{result.projectIntelligence.summary || "(none)"}</span></div>
                      <div>Stack: <span className="font-mono">{result.projectIntelligence.stack.join(", ") || "(none)"}</span></div>
                      <div>Top directories: <span className="font-mono">{result.projectIntelligence.topDirectories.join(", ") || "(none)"}</span></div>
                      <div>Detected test files: <span className="font-mono">{result.projectIntelligence.testFileCount}</span></div>

                      <details open>
                        <summary className="cursor-pointer text-xs text-neutral-500">Risk signals</summary>
                        <div className="mt-2 space-y-2">
                          {result.projectIntelligence.signals.length === 0 ? (
                            <p className="text-[11px] text-neutral-500">(none)</p>
                          ) : (
                            result.projectIntelligence.signals.map((signal) => (
                              <div
                                key={signal.key}
                                className="rounded border border-neutral-200 dark:border-neutral-800 p-2 bg-white dark:bg-neutral-900"
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <div className="font-medium">{signal.label}</div>
                                  <span className={`px-1.5 py-0.5 rounded text-[11px] ${signalBadgeClass(signal.severity)}`}>
                                    {signal.severity} • {signal.count}
                                  </span>
                                </div>
                                {signal.samples.length > 0 && (
                                  <details className="mt-1">
                                    <summary className="cursor-pointer text-[11px] text-neutral-500">
                                      samples ({signal.samples.length})
                                    </summary>
                                    <pre className="mt-1 text-[11px] rounded bg-neutral-100 dark:bg-neutral-900 p-2 max-h-48 overflow-auto whitespace-pre-wrap">
                                      {signal.samples.join("\n")}
                                    </pre>
                                  </details>
                                )}
                              </div>
                            ))
                          )}
                        </div>
                      </details>

                      <details>
                        <summary className="cursor-pointer text-xs text-neutral-500">Top hotspots</summary>
                        <div className="mt-2 space-y-1">
                          {result.projectIntelligence.hotspots.length === 0 ? (
                            <p className="text-[11px] text-neutral-500">(none)</p>
                          ) : (
                            result.projectIntelligence.hotspots.slice(0, 20).map((hotspot) => (
                              <div
                                key={hotspot.path}
                                className="flex items-center justify-between gap-2 rounded border border-neutral-200 dark:border-neutral-800 px-2 py-1 bg-white dark:bg-neutral-900"
                              >
                                <span className="font-mono truncate">{hotspot.path}</span>
                                <span className="font-mono">{hotspot.lines} lines</span>
                              </div>
                            ))
                          )}
                        </div>
                      </details>

                      <details>
                        <summary className="cursor-pointer text-xs text-neutral-500">
                          Module edges ({result.projectIntelligence.moduleEdges.length})
                        </summary>
                        <pre className="mt-2 text-[11px] rounded bg-neutral-100 dark:bg-neutral-900 p-3 max-h-56 overflow-auto whitespace-pre-wrap">
                          {result.projectIntelligence.moduleEdges.length > 0
                            ? result.projectIntelligence.moduleEdges
                                .slice(0, 80)
                                .map((edge) => `${edge.from} -> ${edge.to}`)
                                .join("\n")
                            : "(none)"}
                        </pre>
                      </details>
                    </div>
                  </div>
                )}

                {result && result.teamRoster.length > 0 && (
                  <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 overflow-hidden">
                    <div className="px-4 py-3 border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900/40">
                      <h3 className="text-sm font-semibold">Virtual Team Roster ({result.teamRoster.length})</h3>
                    </div>
                    <div className="p-4">
                      <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 text-xs">
                        {result.teamRoster.map((role, index) => (
                          <li key={`${role}-${index}`} className="rounded border border-neutral-200 dark:border-neutral-800 px-2 py-1.5 bg-white dark:bg-neutral-900">
                            {index + 1}. {role}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}

                {result && result.preflightChecks.length > 0 && (
                  <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 overflow-hidden">
                    <div className="px-4 py-3 border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900/40">
                      <h3 className="text-sm font-semibold">Preflight Checks</h3>
                    </div>
                    <div className="divide-y divide-neutral-200 dark:divide-neutral-800">
                      {result.preflightChecks.map((check, index) => (
                        <details key={`${check.attempt}-preflight-${index}`}>
                          <summary className="list-none cursor-pointer px-4 py-3 hover:bg-neutral-50 dark:hover:bg-neutral-900/40 transition-colors">
                            <div className="flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <div className="text-xs text-neutral-500">Preflight</div>
                                <div className="text-sm font-mono truncate">{commandToString(check.command)}</div>
                              </div>
                              <span
                                className={`shrink-0 px-2 py-1 rounded text-xs font-medium ${
                                  check.ok
                                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                                    : "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
                                }`}
                              >
                                {check.ok ? "pass" : "fail"}
                              </span>
                            </div>
                          </summary>
                          <div className="px-4 pb-4">
                            <pre className="text-xs rounded-lg bg-neutral-100 dark:bg-neutral-900 p-3 overflow-auto max-h-56 whitespace-pre-wrap">
                              {check.output || "(no output)"}
                            </pre>
                          </div>
                        </details>
                      ))}
                    </div>
                  </div>
                )}

                <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 overflow-hidden">
                  <div className="px-4 py-3 border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900/40">
                    <h3 className="text-sm font-semibold">Workspace Access Scope</h3>
                  </div>
                  <div className="p-4 space-y-2">
                    <div className="text-xs text-neutral-500">
                      Files visible to the agent before execution.
                    </div>
                    {workspaceLoading ? (
                      <p className="text-xs text-neutral-500">Loading workspace files...</p>
                    ) : workspaceError ? (
                      <p className="text-xs text-red-600 dark:text-red-400">{workspaceError}</p>
                    ) : visibleWorkspaceFiles.length === 0 ? (
                      <p className="text-xs text-neutral-500">(no files discovered)</p>
                    ) : (
                      <>
                        <ul className="space-y-1 max-h-60 overflow-auto pr-1">
                          {visibleWorkspaceFiles.map((filePath) => (
                            <li
                              key={`scope-${filePath}`}
                              className="text-xs font-mono rounded border border-neutral-200 dark:border-neutral-800 px-2 py-1 bg-white dark:bg-neutral-900"
                            >
                              {filePath}
                            </li>
                          ))}
                        </ul>
                        {workspaceFiles.length > visibleWorkspaceFiles.length && (
                          <p className="text-[11px] text-neutral-500">
                            Showing first {visibleWorkspaceFiles.length} of {workspaceFiles.length} files.
                          </p>
                        )}
                      </>
                    )}
                  </div>
                </div>

                <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 overflow-hidden">
                  <div className="px-4 py-3 border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900/40">
                    <h3 className="text-sm font-semibold">File Activity</h3>
                  </div>
                  <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wider text-neutral-500 mb-2">
                        Files Accessed ({filesAccessed.length})
                      </div>
                      {filesAccessed.length === 0 ? (
                        <p className="text-xs text-neutral-500">(none yet)</p>
                      ) : (
                        <ul className="space-y-1 max-h-60 overflow-auto pr-1">
                          {filesAccessed.map((filePath) => (
                            <li
                              key={`access-${filePath}`}
                              className="text-xs font-mono rounded border border-neutral-200 dark:border-neutral-800 px-2 py-1 bg-white dark:bg-neutral-900"
                            >
                              {filePath}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wider text-neutral-500 mb-2">
                        Files Edited ({filesEdited.length})
                      </div>
                      {filesEdited.length === 0 ? (
                        <p className="text-xs text-neutral-500">(none yet)</p>
                      ) : (
                        <ul className="space-y-1 max-h-60 overflow-auto pr-1">
                          {filesEdited.map((filePath) => (
                            <li
                              key={`edited-${filePath}`}
                              className="text-xs font-mono rounded border border-neutral-200 dark:border-neutral-800 px-2 py-1 bg-white dark:bg-neutral-900"
                            >
                              {filePath}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 overflow-hidden">
                  <div className="px-4 py-3 border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900/40">
                    <h3 className="text-sm font-semibold">Step Log</h3>
                  </div>

                  <div className="divide-y divide-neutral-200 dark:divide-neutral-800">
                    {(result ? result.steps : liveSteps).map((step, index) => (
                      <details key={`${step.iteration}-${step.phase}-${index}`} className="group" open={!step.ok}>
                        <summary className="list-none cursor-pointer px-4 py-3 hover:bg-neutral-50 dark:hover:bg-neutral-900/40 transition-colors">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 text-xs text-neutral-500">
                                <span>Step {step.iteration}</span>
                                <span>•</span>
                                <span>{step.phase}</span>
                                <span>•</span>
                                <span>{step.durationMs} ms</span>
                              </div>
                              <div className="text-sm font-medium mt-0.5 truncate">
                                {actionSummary(step.action)}
                              </div>
                              <p className="text-xs text-neutral-500 mt-1 line-clamp-2">{step.summary}</p>
                            </div>
                            <span
                              className={`shrink-0 mt-0.5 px-2 py-1 rounded text-xs font-medium ${
                                step.ok
                                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                                  : "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
                              }`}
                            >
                              {step.ok ? "ok" : "failed"}
                            </span>
                          </div>
                        </summary>
                        <div className="px-4 pb-4 space-y-3">
                          <div>
                            <div className="text-xs font-semibold uppercase tracking-wider text-neutral-500 mb-1">Thinking</div>
                            <p className="text-sm whitespace-pre-wrap">{step.thinking}</p>
                          </div>
                          <div>
                            <div className="text-xs font-semibold uppercase tracking-wider text-neutral-500 mb-1">Action JSON</div>
                            <pre className="text-xs rounded-lg bg-neutral-100 dark:bg-neutral-900 p-3 overflow-x-auto">
                              {JSON.stringify(step.action, null, 2)}
                            </pre>
                          </div>
                          <div>
                            <div className="text-xs font-semibold uppercase tracking-wider text-neutral-500 mb-1">Tool Output</div>
                            <pre className="text-xs rounded-lg bg-neutral-100 dark:bg-neutral-900 p-3 overflow-auto max-h-56 whitespace-pre-wrap">
                              {step.output || "(no output)"}
                            </pre>
                          </div>
                        </div>
                      </details>
                    ))}
                  </div>
                </div>

                {effectiveVerificationChecks.length > 0 && (
                  <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 overflow-hidden">
                    <div className="px-4 py-3 border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900/40">
                      <h3 className="text-sm font-semibold">Verification Checks</h3>
                    </div>
                    <div className="divide-y divide-neutral-200 dark:divide-neutral-800">
                      {effectiveVerificationChecks.map((check, index) => (
                        <details key={`${check.attempt}-${index}`}>
                          <summary className="list-none cursor-pointer px-4 py-3 hover:bg-neutral-50 dark:hover:bg-neutral-900/40 transition-colors">
                            <div className="flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <div className="text-xs text-neutral-500">Attempt {check.attempt}</div>
                                <div className="text-sm font-mono truncate">{commandToString(check.command)}</div>
                              </div>
                              <span
                                className={`shrink-0 px-2 py-1 rounded text-xs font-medium ${
                                  check.ok
                                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                                    : "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
                                }`}
                              >
                                {check.ok ? "pass" : "fail"}
                              </span>
                            </div>
                          </summary>
                          <div className="px-4 pb-4">
                            <pre className="text-xs rounded-lg bg-neutral-100 dark:bg-neutral-900 p-3 overflow-auto max-h-56 whitespace-pre-wrap">
                              {check.output || "(no output)"}
                            </pre>
                          </div>
                        </details>
                      ))}
                    </div>
                  </div>
                )}

                {result && result.rollbackSummary.length > 0 && (
                  <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 overflow-hidden">
                    <div className="px-4 py-3 border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900/40">
                      <h3 className="text-sm font-semibold">Rollback Summary</h3>
                    </div>
                    <ul className="p-4 text-xs space-y-1">
                      {result.rollbackSummary.map((line, index) => (
                        <li key={index}>{line}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {result && result.changeJournal.length > 0 && (
                  <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 overflow-hidden">
                    <div className="px-4 py-3 border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900/40">
                      <h3 className="text-sm font-semibold">Change Journal</h3>
                    </div>
                    <div className="divide-y divide-neutral-200 dark:divide-neutral-800">
                      {result.changeJournal.map((entry, index) => (
                        <div key={`${entry.timestamp}-${entry.path}-${index}`} className="px-4 py-3">
                          <div className="text-xs text-neutral-500">
                            {entry.timestamp}
                          </div>
                          <div className="text-sm font-mono">
                            [{entry.op}] {entry.path}
                          </div>
                          <div className="text-xs mt-1 whitespace-pre-wrap">{entry.details}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
            </>
          </div>

          <aside className="min-h-0 overflow-y-auto p-5 space-y-3 bg-neutral-50 dark:bg-neutral-900/30">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Recent Runs</h3>
              {history.length > 0 && (
                <button
                  onClick={() => setHistory([])}
                  className="text-xs text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300 cursor-pointer"
                >
                  Clear
                </button>
              )}
            </div>

            {history.length === 0 ? (
              <p className="text-xs text-neutral-400">No run history yet.</p>
            ) : (
              <div className="space-y-2">
                {history.map((item, index) => (
                  <div
                    key={`${item.finishedAt}-${index}`}
                    className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className={`px-2 py-0.5 rounded text-[11px] font-medium ${statusBadgeClass(item.status)}`}>
                        {item.status.replace("_", " ")}
                      </span>
                      <span className="text-[11px] text-neutral-500">
                        {new Date(item.finishedAt).toLocaleString()}
                      </span>
                    </div>

                    <p className="mt-2 text-xs text-neutral-700 dark:text-neutral-300 line-clamp-3">
                      {item.goal}
                    </p>

                    <div className="mt-2 flex items-center gap-2">
                      <button
                        onClick={() => loadHistoryGoal(item)}
                        className="text-xs px-2 py-1 rounded border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors cursor-pointer"
                      >
                        Load
                      </button>
                      {onPublishReport && (
                        <button
                          onClick={() => onPublishReport(formatRunReport(item))}
                          className="text-xs px-2 py-1 rounded border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors cursor-pointer"
                        >
                          Publish
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </aside>
        </div>
    </section>
  );

  if (embedded) {
    return panel;
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/45 z-40" onClick={onClose} />
      {panel}
    </>
  );
}
