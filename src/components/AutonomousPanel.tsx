"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "@/lib/client/apiFetch";
import ActivitySection from "@/components/autonomous/ActivitySection";
import ClarificationSection from "@/components/autonomous/ClarificationSection";
import GoalSection from "@/components/autonomous/GoalSection";
import MemorySection from "@/components/autonomous/MemorySection";
import PanelHeader from "@/components/autonomous/PanelHeader";
import ProjectIntelligenceSection from "@/components/autonomous/ProjectIntelligenceSection";
import RecentRunsSection from "@/components/autonomous/RecentRunsSection";
import RunSummarySection from "@/components/autonomous/RunSummarySection";
import WorkspaceDiagnosticsSection from "@/components/autonomous/WorkspaceDiagnosticsSection";
import {
  buildTelemetryExport,
  DEFAULT_SETTINGS,
  flattenTreeFiles,
  HISTORY_STORAGE_KEY,
  listActionPaths,
  looksLikeMutationGoal,
  MAX_HISTORY_ITEMS,
  normalizeAgentSettings,
  normalizeRunResult,
  parseStoredJson,
  parseVerificationCommands,
  resolveAgentStreamEndpoint,
  SETTINGS_STORAGE_KEY,
  statusBadgeClass,
  toSafeFileToken,
  UI_MODE_STORAGE_KEY,
} from "@/components/autonomous/helpers";
import {
  AgentCommand,
  AgentRunResult,
  AgentSettings,
  AgentStep,
  AgentStreamEvent,
  AutonomousPanelProps,
  ContinuationPacket,
  FileTreeNode,
  LongTermMemoryEntry,
  MemoryRetrievalDiagnostics,
  VerificationCheckResult,
} from "@/components/autonomous/types";

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
  const [expertMode, setExpertMode] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [runDetailsOpen, setRunDetailsOpen] = useState(false);
  const [projectOpen, setProjectOpen] = useState(false);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(true);
  const [memoryOpen, setMemoryOpen] = useState(false);

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
  const [memoryEntries, setMemoryEntries] = useState<LongTermMemoryEntry[]>([]);
  const [latestContinuation, setLatestContinuation] = useState<ContinuationPacket | null>(null);
  const [memoryQuery, setMemoryQuery] = useState("");
  const [memoryContextBlock, setMemoryContextBlock] = useState("");
  const [memoryDiagnostics, setMemoryDiagnostics] =
    useState<MemoryRetrievalDiagnostics | null>(null);
  const [memoryLoading, setMemoryLoading] = useState(false);
  const [memoryRetrieveLoading, setMemoryRetrieveLoading] = useState(false);
  const [memoryError, setMemoryError] = useState<string | null>(null);
  const [memoryImportMode, setMemoryImportMode] = useState<"merge" | "replace">("merge");

  const controllerRef = useRef<AbortController | null>(null);
  const memoryImportInputRef = useRef<HTMLInputElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const lastFocusedRef = useRef<HTMLElement | null>(null);

  const agentStreamEndpoint = useMemo(() => resolveAgentStreamEndpoint(), []);
  const steps: AgentStep[] = result ? result.steps : liveSteps;
  const hasFailedStep = steps.some((step) => !step.ok);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const savedSettings = parseStoredJson<AgentSettings | null>(
      localStorage.getItem(SETTINGS_STORAGE_KEY),
      null
    );

    if (savedSettings) {
      setSettings(normalizeAgentSettings(savedSettings));
    }

    const savedHistory = parseStoredJson<AgentRunResult[]>(
      localStorage.getItem(HISTORY_STORAGE_KEY),
      []
    );

    if (Array.isArray(savedHistory)) {
      setHistory(savedHistory.map(normalizeRunResult).slice(0, MAX_HISTORY_ITEMS));
    }

    const savedUiMode = localStorage.getItem(UI_MODE_STORAGE_KEY);
    if (savedUiMode === "advanced") {
      setExpertMode(true);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history.slice(0, MAX_HISTORY_ITEMS)));
  }, [history]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(UI_MODE_STORAGE_KEY, expertMode ? "advanced" : "simple");
  }, [expertMode]);

  useEffect(() => {
    if (expertMode) {
      setActivityOpen(true);
      setRunDetailsOpen(true);
      setProjectOpen(true);
      setWorkspaceOpen(true);
      setMemoryOpen(true);
    }
  }, [expertMode]);

  useEffect(() => {
    if (running || hasFailedStep) {
      setActivityOpen(true);
    }
  }, [running, hasFailedStep]);

  useEffect(() => {
    if (!open) return;

    const controller = new AbortController();
    setWorkspaceLoading(true);
    setWorkspaceError(null);

    apiFetch("/api/files", {
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
  const effectiveVerificationChecks = result ? result.verificationChecks : liveChecks;

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

  const unitTimelineMetrics = useMemo(() => {
    const metrics = result?.multiAgentReport?.observability?.unitMetrics || [];
    if (metrics.length === 0) {
      return [];
    }

    const sorted = [...metrics].sort((first, second) => second.durationMs - first.durationMs);
    const maxDuration = Math.max(1, ...sorted.map((metric) => metric.durationMs || 0));
    return sorted.map((metric) => ({
      ...metric,
      widthPercent: Math.max(
        3,
        Math.min(100, Math.round(((metric.durationMs || 0) / maxDuration) * 100))
      ),
    }));
  }, [result]);

  function downloadTelemetryJson(run: AgentRunResult) {
    if (typeof window === "undefined") return;
    const payload = buildTelemetryExport(run);
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    const runToken = toSafeFileToken(run.runId || run.finishedAt || "run");
    anchor.href = url;
    anchor.download = `sorcerer-telemetry-${runToken}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }

  const callMemoryApi = useCallback(
    async <T,>(payload: Record<string, unknown>): Promise<T> => {
      const response = await apiFetch("/api/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...payload,
          workspacePath,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as T & { error?: string };
      if (!response.ok) {
        throw new Error(data.error || `Memory API failed (${response.status})`);
      }
      return data;
    },
    [workspacePath]
  );

  const refreshMemoryList = useCallback(async () => {
    setMemoryLoading(true);
    setMemoryError(null);
    try {
      const data = await callMemoryApi<{
        entries?: LongTermMemoryEntry[];
        latestContinuation?: ContinuationPacket | null;
      }>({
        action: "list",
      });
      setMemoryEntries(Array.isArray(data.entries) ? data.entries : []);
      setLatestContinuation(data.latestContinuation || null);
    } catch (err) {
      setMemoryError(err instanceof Error ? err.message : "Failed to load memory");
    } finally {
      setMemoryLoading(false);
    }
  }, [callMemoryApi]);

  async function retrieveMemoryContextForQuery() {
    const query = memoryQuery.trim();
    if (!query) return;
    setMemoryRetrieveLoading(true);
    setMemoryError(null);
    try {
      const data = await callMemoryApi<{
        contextBlock?: string;
        diagnostics?: MemoryRetrievalDiagnostics;
        latestContinuation?: ContinuationPacket | null;
      }>({
        action: "retrieve",
        query,
        limit: 8,
        maxChars: 2600,
        includePinned: true,
      });
      setMemoryContextBlock(
        typeof data.contextBlock === "string" && data.contextBlock.length > 0
          ? data.contextBlock
          : "(no memory context returned)"
      );
      setMemoryDiagnostics(data.diagnostics || null);
      setLatestContinuation(data.latestContinuation || null);
    } catch (err) {
      setMemoryError(err instanceof Error ? err.message : "Memory retrieval failed");
    } finally {
      setMemoryRetrieveLoading(false);
    }
  }

  async function toggleMemoryPin(entry: LongTermMemoryEntry) {
    setMemoryError(null);
    try {
      await callMemoryApi<{ updated: boolean }>({
        action: "pin",
        memoryId: entry.id,
        pinned: !entry.pinned,
      });
      setMemoryEntries((prev) =>
        prev.map((candidate) =>
          candidate.id === entry.id
            ? {
                ...candidate,
                pinned: !entry.pinned,
              }
            : candidate
        )
      );
    } catch (err) {
      setMemoryError(err instanceof Error ? err.message : "Failed to toggle pin");
    }
  }

  async function forgetMemory(entry: LongTermMemoryEntry) {
    setMemoryError(null);
    if (typeof window !== "undefined") {
      const confirmed = window.confirm(
        `Forget memory "${entry.title}"?\n\nThis permanently removes it from local memory storage.`
      );
      if (!confirmed) return;
    }
    try {
      await callMemoryApi<{ removed: boolean }>({
        action: "forget",
        memoryId: entry.id,
      });
      setMemoryEntries((prev) => prev.filter((candidate) => candidate.id !== entry.id));
    } catch (err) {
      setMemoryError(err instanceof Error ? err.message : "Failed to remove memory");
    }
  }

  function clearHistory() {
    if (typeof window !== "undefined") {
      const confirmed = window.confirm(
        "Clear all run history?\n\nThis only removes local history from this browser."
      );
      if (!confirmed) return;
    }
    setHistory([]);
    setStatusMessage("Cleared local run history.");
  }

  async function exportMemoryJson() {
    if (typeof window === "undefined") return;
    setMemoryError(null);
    try {
      const data = await callMemoryApi<{ store?: unknown }>({
        action: "export",
      });
      const payload = JSON.stringify(data.store || {}, null, 2);
      const blob = new Blob([payload], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `sorcerer-memory-${toSafeFileToken(
        result?.runId || new Date().toISOString()
      )}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
    } catch (err) {
      setMemoryError(err instanceof Error ? err.message : "Failed to export memory");
    }
  }

  async function importMemoryJson(file: File, mode: "merge" | "replace") {
    setMemoryError(null);
    try {
      const raw = await file.text();
      const payload = JSON.parse(raw);
      await callMemoryApi<{ imported: number; replaced: boolean }>({
        action: "import",
        mode,
        payload,
      });
      await refreshMemoryList();
      setMemoryContextBlock("");
      setMemoryDiagnostics(null);
    } catch (err) {
      setMemoryError(err instanceof Error ? err.message : "Failed to import memory");
    }
  }

  useEffect(() => {
    if (!open) return;
    void refreshMemoryList();
  }, [open, refreshMemoryList]);

  useEffect(() => {
    if (embedded || !open) return;

    lastFocusedRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const timer = window.setTimeout(() => {
      panelRef.current?.focus();
    }, 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && onClose) {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", onKeyDown);
      lastFocusedRef.current?.focus();
    };
  }, [embedded, onClose, open]);

  useEffect(() => {
    if (!result?.finishedAt) return;
    void refreshMemoryList();
  }, [result?.finishedAt, refreshMemoryList]);

  function updateSettings<K extends keyof AgentSettings>(key: K, value: AgentSettings[K]) {
    setSettings((prev) => ({
      ...prev,
      [key]: value,
    }));
  }

  function applyCodingDefaults() {
    setSettings((prev) =>
      normalizeAgentSettings({
        ...DEFAULT_SETTINGS,
        executionMode: prev.executionMode,
        modelOverride: prev.modelOverride,
        customVerificationCommands: prev.customVerificationCommands,
      })
    );
    setError(null);
    setStatusMessage("Applied coding-first defaults.");
  }

  function pushHistory(run: AgentRunResult) {
    const normalized = normalizeRunResult(run);
    setHistory((prev) => [normalized, ...prev].slice(0, MAX_HISTORY_ITEMS));
  }

  function consumeStreamEvent(event: AgentStreamEvent) {
    switch (event.type) {
      case "started":
        setStatusMessage(
          `Started with model ${event.data.model}. mode=${event.data.executionMode}, teamSize=${event.data.teamSize}, strictVerification=${event.data.strictVerification}, preflight=${event.data.runPreflightChecks}, clarificationGate=${event.data.requireClarificationBeforeEdits}`
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

    if (settings.dryRun && looksLikeMutationGoal(goal)) {
      setError(
        "Dry run is enabled, so no files will be written. Disable Dry run in Advanced or click Coding Defaults."
      );
      return;
    }

    let verificationCommands: AgentCommand[] = [];
    try {
      verificationCommands = parseVerificationCommands(settings.customVerificationCommands);
    } catch (err) {
      setError(
        `Invalid verification commands: ${err instanceof Error ? err.message : "parse error"}`
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
      const response = await apiFetch(agentStreamEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          goal: goal.trim(),
          executionMode: settings.executionMode,
          model: settings.modelOverride.trim() || undefined,
          workspacePath,
          skillFiles: enabledSkillFiles.length > 0 ? enabledSkillFiles : undefined,
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
          maxParallelWorkUnits: settings.maxParallelWorkUnits,
          criticPassThreshold: settings.criticPassThreshold,
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

  const runStatusLabel = result ? result.status.replace(/_/g, " ") : running ? "running" : "idle";

  const panel = (
    <section
      ref={embedded ? undefined : panelRef}
      className={
        embedded
          ? "autonomous-panel h-full min-h-0 w-full flex flex-col"
          : "autonomous-panel fixed inset-y-0 right-0 z-50 w-full max-w-6xl border-l border-white/10 bg-neutral-950 shadow-2xl flex flex-col"
      }
      role={embedded ? undefined : "dialog"}
      aria-modal={embedded ? undefined : true}
      aria-labelledby={embedded ? undefined : "autonomous-panel-title"}
      tabIndex={embedded ? undefined : -1}
    >
      {!embedded && (
        <PanelHeader
          embedded={false}
          botName={botName}
          expertMode={expertMode}
          setExpertMode={setExpertMode}
          statusClass={currentStatusBadge}
          statusLabel={runStatusLabel}
          onClose={onClose}
        />
      )}

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-6 space-y-6">
          {embedded && (
            <PanelHeader
              embedded
              botName={botName}
              expertMode={expertMode}
              setExpertMode={setExpertMode}
              statusClass={currentStatusBadge}
              statusLabel={runStatusLabel}
            />
          )}

          <GoalSection
            workspacePath={workspacePath}
            goal={goal}
            setGoal={setGoal}
            settings={settings}
            running={running}
            canRun={canRun}
            showAdvanced={showAdvanced}
            expertMode={expertMode}
            setShowAdvanced={setShowAdvanced}
            onUpdateSettings={updateSettings}
            onApplyCodingDefaults={applyCodingDefaults}
            onRun={runAutonomousAgent}
            onCancel={cancelRun}
            statusMessage={statusMessage}
            error={error}
          />

          <div className="grid gap-6 2xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <div className="space-y-6 min-w-0">
              <RunSummarySection
                result={result}
                running={running}
                liveStepCount={liveStepCount}
                maxIterations={settings.maxIterations}
                verificationChecksCount={effectiveVerificationChecks.length}
                runDetailsOpen={runDetailsOpen}
                setRunDetailsOpen={setRunDetailsOpen}
                expertMode={expertMode}
                unitTimelineMetrics={unitTimelineMetrics}
                onPublishReport={onPublishReport}
                onDownloadTelemetry={downloadTelemetryJson}
              />

              <ClarificationSection
                questions={pendingClarificationQuestions}
                clarificationAnswers={clarificationAnswers}
                setClarificationAnswers={setClarificationAnswers}
                missingRequiredCount={missingRequiredClarificationCount}
                running={running}
                onContinue={runAutonomousAgent}
              />

              <ActivitySection
                open={activityOpen}
                onToggle={setActivityOpen}
                steps={steps}
                verificationChecks={effectiveVerificationChecks}
              />

              {expertMode && (
                <ProjectIntelligenceSection
                  open={projectOpen}
                  onToggle={setProjectOpen}
                  result={result}
                />
              )}

              {expertMode && (
                <WorkspaceDiagnosticsSection
                  open={workspaceOpen}
                  onToggle={setWorkspaceOpen}
                  workspaceLoading={workspaceLoading}
                  workspaceError={workspaceError}
                  visibleWorkspaceFiles={visibleWorkspaceFiles}
                  workspaceFiles={workspaceFiles}
                  filesAccessed={filesAccessed}
                  filesEdited={filesEdited}
                  result={result}
                />
              )}
            </div>

            <aside className="space-y-6 min-w-0 xl:sticky xl:top-6 self-start">
              <RecentRunsSection
                open={historyOpen}
                onToggle={setHistoryOpen}
                history={history}
                onClear={clearHistory}
                onLoad={loadHistoryGoal}
                onDownloadTelemetry={downloadTelemetryJson}
                onPublishReport={onPublishReport}
              />

              <MemorySection
                open={memoryOpen}
                onToggle={setMemoryOpen}
                memoryLoading={memoryLoading}
                memoryRetrieveLoading={memoryRetrieveLoading}
                memoryQuery={memoryQuery}
                setMemoryQuery={setMemoryQuery}
                memoryImportMode={memoryImportMode}
                setMemoryImportMode={setMemoryImportMode}
                memoryImportInputRef={memoryImportInputRef}
                memoryError={memoryError}
                latestContinuation={latestContinuation}
                memoryContextBlock={memoryContextBlock}
                memoryDiagnostics={memoryDiagnostics}
                memoryEntries={memoryEntries}
                onRefresh={refreshMemoryList}
                onRetrieve={retrieveMemoryContextForQuery}
                onExport={exportMemoryJson}
                onImport={importMemoryJson}
                onTogglePin={toggleMemoryPin}
                onForget={forgetMemory}
              />
            </aside>
          </div>
        </div>
      </div>
    </section>
  );

  if (embedded) {
    return panel;
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/45 z-40" onClick={onClose} aria-hidden="true" />
      {panel}
    </>
  );
}
