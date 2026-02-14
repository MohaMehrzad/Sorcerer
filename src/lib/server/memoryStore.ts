import { createHash, randomUUID } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { normalizePathForWorkspace } from "@/lib/server/workspace";

export type MemoryEntryType =
  | "bug_pattern"
  | "fix_pattern"
  | "verification_rule"
  | "project_convention"
  | "continuation";

export type MemoryEvidenceType =
  | "command_output"
  | "file_excerpt"
  | "verification_result"
  | "human_feedback"
  | "run_summary"
  | "external_source";

export interface MemoryEvidence {
  type: MemoryEvidenceType;
  source: string;
  summary: string;
  createdAt: string;
}

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
  confidenceScore: number;
  evidence: MemoryEvidence[];
  lastValidatedAt?: string;
  invalidatedAt?: string;
  supersedes: string[];
  contradictedBy: string[];
  dedupeKey: string;
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

export interface MemoryStoreData {
  version: number;
  updatedAt: string;
  entries: LongTermMemoryEntry[];
  latestContinuation?: ContinuationPacket;
}

export interface RetrievedMemoryEntry {
  entry: LongTermMemoryEntry;
  score: number;
}

export interface MemoryConflict {
  firstEntryId: string;
  secondEntryId: string;
  topicTokens: string[];
  reason: string;
}

export interface MemoryRetrievalDiagnostics {
  conflictCount: number;
  conflicts: MemoryConflict[];
  requiresVerificationBeforeMutation: boolean;
  guidance: string[];
}

interface AddMemoryEntryInput {
  type: MemoryEntryType;
  title: string;
  content: string;
  tags?: string[];
  pinned?: boolean;
  successScore?: number;
  confidenceScore?: number;
  evidence?: MemoryEvidence[];
  lastValidatedAt?: string;
  invalidatedAt?: string;
  supersedes?: string[];
  contradictedBy?: string[];
  sourceRunId?: string;
  sourceGoal?: string;
}

interface RetrieveMemoryParams {
  workspace: string;
  query: string;
  limit?: number;
  maxChars?: number;
  types?: MemoryEntryType[];
  includePinned?: boolean;
}

const STORE_VERSION = 1;
const DEFAULT_LIMIT = 10;
const DEFAULT_MAX_CONTEXT_CHARS = 4200;
const MAX_ENTRY_CONTENT_CHARS = 2800;
const MAX_ENTRY_TITLE_CHARS = 160;
const MAX_TAGS_PER_ENTRY = 14;
const MAX_STORE_ENTRIES = 2200;
const MAX_EVIDENCE_PER_ENTRY = 10;
const MAX_EVIDENCE_SOURCE_CHARS = 220;
const MAX_EVIDENCE_SUMMARY_CHARS = 420;
const MAX_RELATION_IDS = 16;

const NEGATIVE_POLARITY_MARKERS = [
  "do not",
  "don't",
  "never",
  "must not",
  "should not",
  "forbid",
  "forbidden",
  "disable",
  "disabled",
  "avoid",
  "deny",
  "off",
  "false",
];

const POSITIVE_POLARITY_MARKERS = [
  "must",
  "required",
  "always",
  "enable",
  "enabled",
  "allow",
  "allowed",
  "use",
  "recommended",
  "on",
  "true",
];

const TOKEN_STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "if",
  "then",
  "else",
  "for",
  "from",
  "with",
  "without",
  "into",
  "onto",
  "when",
  "where",
  "while",
  "before",
  "after",
  "this",
  "that",
  "these",
  "those",
  "should",
  "must",
  "use",
  "avoid",
  "always",
  "never",
  "rule",
  "pattern",
  "summary",
  "entry",
  "work",
  "goal",
  "run",
]);

function getStorePath(workspace: string): string {
  return normalizePathForWorkspace(
    path.join(".tmp", "agent-memory", "memory-store.json"),
    workspace
  );
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_\-\s]+/g, " ")
    .split(/\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeTags(tags: string[] | undefined): string[] {
  if (!tags) return [];
  return tags
    .filter((tag) => typeof tag === "string")
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, MAX_TAGS_PER_ENTRY);
}

function normalizeRelationIds(ids: string[] | undefined): string[] {
  if (!ids) return [];
  return Array.from(
    new Set(
      ids
        .filter((id) => typeof id === "string")
        .map((id) => id.trim())
        .filter((id) => id.length > 0)
        .slice(0, MAX_RELATION_IDS)
    )
  );
}

function isMemoryEvidenceType(value: unknown): value is MemoryEvidenceType {
  return (
    value === "command_output" ||
    value === "file_excerpt" ||
    value === "verification_result" ||
    value === "human_feedback" ||
    value === "run_summary" ||
    value === "external_source"
  );
}

function normalizeEvidence(evidence: MemoryEvidence[] | undefined): MemoryEvidence[] {
  if (!evidence) return [];
  const normalized: MemoryEvidence[] = [];
  const seen = new Set<string>();
  for (const item of evidence) {
    if (!item || typeof item !== "object") continue;
    if (!isMemoryEvidenceType(item.type)) continue;
    const source =
      typeof item.source === "string" ? item.source.trim().slice(0, MAX_EVIDENCE_SOURCE_CHARS) : "";
    const summary =
      typeof item.summary === "string"
        ? item.summary.trim().slice(0, MAX_EVIDENCE_SUMMARY_CHARS)
        : "";
    if (!source || !summary) continue;
    const createdAt =
      typeof item.createdAt === "string" && item.createdAt.trim().length > 0
        ? item.createdAt
        : nowIso();
    const signature = hashText([item.type, source, summary].join("\n"));
    if (seen.has(signature)) continue;
    seen.add(signature);
    normalized.push({
      type: item.type,
      source,
      summary,
      createdAt,
    });
    if (normalized.length >= MAX_EVIDENCE_PER_ENTRY) break;
  }
  return normalized;
}

function mergeEvidence(existing: MemoryEvidence[], incoming: MemoryEvidence[]): MemoryEvidence[] {
  return normalizeEvidence([...existing, ...incoming]).slice(0, MAX_EVIDENCE_PER_ENTRY);
}

function createDedupeKey(input: {
  workspace: string;
  type: MemoryEntryType;
  title: string;
  content: string;
}): string {
  return hashText(
    [input.workspace, input.type, input.title.trim().toLowerCase(), input.content.trim()].join(
      "\n"
    )
  );
}

function buildDefaultStore(): MemoryStoreData {
  return {
    version: STORE_VERSION,
    updatedAt: nowIso(),
    entries: [],
  };
}

function sanitizeEntry(entry: unknown): LongTermMemoryEntry | null {
  if (!entry || typeof entry !== "object") return null;
  const typed = entry as Record<string, unknown>;

  const type = typed.type;
  if (
    type !== "bug_pattern" &&
    type !== "fix_pattern" &&
    type !== "verification_rule" &&
    type !== "project_convention" &&
    type !== "continuation"
  ) {
    return null;
  }

  const title = typeof typed.title === "string" ? typed.title.trim() : "";
  const content = typeof typed.content === "string" ? typed.content.trim() : "";
  if (!title || !content) return null;

  const workspace =
    typeof typed.workspace === "string" && typed.workspace.trim().length > 0
      ? typed.workspace.trim()
      : "";
  const createdAt =
    typeof typed.createdAt === "string" && typed.createdAt.trim().length > 0
      ? typed.createdAt
      : nowIso();
  const updatedAt =
    typeof typed.updatedAt === "string" && typed.updatedAt.trim().length > 0
      ? typed.updatedAt
      : createdAt;
  const lastUsedAt =
    typeof typed.lastUsedAt === "string" && typed.lastUsedAt.trim().length > 0
      ? typed.lastUsedAt
      : undefined;
  const id =
    typeof typed.id === "string" && typed.id.trim().length > 0
      ? typed.id
      : randomUUID();
  const dedupeKey =
    typeof typed.dedupeKey === "string" && typed.dedupeKey.trim().length > 0
      ? typed.dedupeKey
      : createDedupeKey({
          workspace,
          type,
          title,
          content,
        });
  const tags = Array.isArray(typed.tags)
    ? normalizeTags(typed.tags.filter((tag): tag is string => typeof tag === "string"))
    : [];
  const useCount =
    typeof typed.useCount === "number" && Number.isFinite(typed.useCount)
      ? Math.max(0, Math.floor(typed.useCount))
      : 0;
  const successScore =
    typeof typed.successScore === "number" && Number.isFinite(typed.successScore)
      ? clamp(typed.successScore, 0, 1)
      : 0.5;
  const confidenceScore =
    typeof typed.confidenceScore === "number" && Number.isFinite(typed.confidenceScore)
      ? clamp(typed.confidenceScore, 0, 1)
      : successScore;
  const evidence = Array.isArray(typed.evidence)
    ? normalizeEvidence(typed.evidence as MemoryEvidence[])
    : [];
  const lastValidatedAt =
    typeof typed.lastValidatedAt === "string" && typed.lastValidatedAt.trim().length > 0
      ? typed.lastValidatedAt
      : undefined;
  const invalidatedAt =
    typeof typed.invalidatedAt === "string" && typed.invalidatedAt.trim().length > 0
      ? typed.invalidatedAt
      : undefined;
  const supersedes = Array.isArray(typed.supersedes)
    ? normalizeRelationIds(typed.supersedes.filter((item): item is string => typeof item === "string"))
    : [];
  const contradictedBy = Array.isArray(typed.contradictedBy)
    ? normalizeRelationIds(
        typed.contradictedBy.filter((item): item is string => typeof item === "string")
      )
    : [];

  return {
    id,
    workspace,
    type,
    title: title.slice(0, MAX_ENTRY_TITLE_CHARS),
    content: content.slice(0, MAX_ENTRY_CONTENT_CHARS),
    tags,
    pinned: Boolean(typed.pinned),
    successScore,
    useCount,
    createdAt,
    updatedAt,
    lastUsedAt,
    sourceRunId: typeof typed.sourceRunId === "string" ? typed.sourceRunId : undefined,
    sourceGoal: typeof typed.sourceGoal === "string" ? typed.sourceGoal : undefined,
    confidenceScore,
    evidence,
    lastValidatedAt,
    invalidatedAt,
    supersedes,
    contradictedBy,
    dedupeKey,
  };
}

function sanitizeContinuation(value: unknown): ContinuationPacket | undefined {
  if (!value || typeof value !== "object") return undefined;
  const typed = value as Record<string, unknown>;
  if (typeof typed.runId !== "string" || !typed.runId.trim()) return undefined;
  const executionMode = typed.executionMode === "single" ? "single" : "multi";
  const goal = typeof typed.goal === "string" ? typed.goal.trim() : "";
  if (!goal) return undefined;
  const summary = typeof typed.summary === "string" ? typed.summary.trim() : "";
  const pendingWork = Array.isArray(typed.pendingWork)
    ? typed.pendingWork.filter((item): item is string => typeof item === "string")
    : [];
  const nextActions = Array.isArray(typed.nextActions)
    ? typed.nextActions.filter((item): item is string => typeof item === "string")
    : [];
  const createdAt =
    typeof typed.createdAt === "string" && typed.createdAt.trim().length > 0
      ? typed.createdAt
      : nowIso();

  return {
    runId: typed.runId,
    executionMode,
    goal: goal.slice(0, 400),
    summary: summary.slice(0, 1400),
    pendingWork: pendingWork.slice(0, 30),
    nextActions: nextActions.slice(0, 30),
    createdAt,
  };
}

async function loadStore(workspace: string): Promise<MemoryStoreData> {
  const filePath = getStorePath(workspace);
  try {
    const raw = await readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw) as {
      version?: unknown;
      updatedAt?: unknown;
      entries?: unknown;
      latestContinuation?: unknown;
    };
    const entries = Array.isArray(parsed.entries)
      ? parsed.entries
          .map((entry) => sanitizeEntry(entry))
          .filter((entry): entry is LongTermMemoryEntry => entry !== null)
      : [];
    return {
      version: STORE_VERSION,
      updatedAt:
        typeof parsed.updatedAt === "string" && parsed.updatedAt.trim().length > 0
          ? parsed.updatedAt
          : nowIso(),
      entries,
      latestContinuation: sanitizeContinuation(parsed.latestContinuation),
    };
  } catch {
    return buildDefaultStore();
  }
}

async function saveStore(workspace: string, store: MemoryStoreData): Promise<void> {
  const filePath = getStorePath(workspace);
  const normalizedEntries = [...store.entries]
    .sort((first, second) => {
      const firstPinned = first.pinned ? 1 : 0;
      const secondPinned = second.pinned ? 1 : 0;
      if (firstPinned !== secondPinned) return secondPinned - firstPinned;
      const firstTime = Date.parse(first.updatedAt);
      const secondTime = Date.parse(second.updatedAt);
      return secondTime - firstTime;
    })
    .slice(0, MAX_STORE_ENTRIES);
  const payload: MemoryStoreData = {
    version: STORE_VERSION,
    updatedAt: nowIso(),
    entries: normalizedEntries,
    latestContinuation: store.latestContinuation,
  };
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(payload, null, 2), "utf-8");
}

function scoreMemoryEntry(
  entry: LongTermMemoryEntry,
  queryTokens: Set<string>,
  nowMs: number
): number {
  const text = `${entry.title}\n${entry.content}\n${entry.tags.join(" ")}`.toLowerCase();
  const entryTokens = new Set(tokenize(text));
  let overlapCount = 0;
  for (const token of queryTokens) {
    if (entryTokens.has(token)) overlapCount += 1;
  }
  const overlapScore =
    queryTokens.size > 0 ? overlapCount / Math.max(1, queryTokens.size) : 0;

  const ageMs = Math.max(0, nowMs - Date.parse(entry.updatedAt));
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  const recencyScore = Math.exp(-ageDays / 30);

  const pinnedBoost = entry.pinned ? 1 : 0;
  const usageScore = clamp(entry.useCount / 30, 0, 1);
  const confidenceScore = clamp(entry.confidenceScore, 0, 1);
  const validatedAtMs = Date.parse(entry.lastValidatedAt || entry.updatedAt);
  const validationAgeMs = Math.max(0, nowMs - (Number.isFinite(validatedAtMs) ? validatedAtMs : nowMs));
  const validationAgeDays = validationAgeMs / (1000 * 60 * 60 * 24);
  const validationRecencyScore = Math.exp(-validationAgeDays / 45);
  const invalidationPenalty = entry.invalidatedAt ? 0.18 : 1;

  return (
    (overlapScore * 0.48 +
      recencyScore * 0.1 +
      clamp(entry.successScore, 0, 1) * 0.14 +
      confidenceScore * 0.2 +
      validationRecencyScore * 0.06 +
      pinnedBoost * 0.02 +
      usageScore * 0.02) *
    invalidationPenalty
  );
}

function polarityScore(text: string): number {
  const normalized = text.toLowerCase();
  let score = 0;
  for (const marker of POSITIVE_POLARITY_MARKERS) {
    if (normalized.includes(marker)) score += 1;
  }
  for (const marker of NEGATIVE_POLARITY_MARKERS) {
    if (normalized.includes(marker)) score -= 1;
  }
  return score;
}

function extractTopicTokens(entry: LongTermMemoryEntry): string[] {
  const line = `${entry.title} ${entry.content.split("\n")[0]}`;
  return tokenize(line)
    .filter((token) => !TOKEN_STOPWORDS.has(token))
    .slice(0, 12);
}

function detectMemoryConflicts(entries: RetrievedMemoryEntry[]): MemoryConflict[] {
  const conflicts: MemoryConflict[] = [];
  for (let firstIndex = 0; firstIndex < entries.length; firstIndex += 1) {
    const first = entries[firstIndex];
    const firstText = `${first.entry.title}\n${first.entry.content}`;
    const firstPolarity = polarityScore(firstText);
    const firstTokens = new Set(extractTopicTokens(first.entry));
    if (firstTokens.size === 0) continue;

    for (let secondIndex = firstIndex + 1; secondIndex < entries.length; secondIndex += 1) {
      const second = entries[secondIndex];
      if (first.entry.contradictedBy.includes(second.entry.id)) continue;
      if (second.entry.contradictedBy.includes(first.entry.id)) continue;
      if (first.entry.supersedes.includes(second.entry.id)) continue;
      if (second.entry.supersedes.includes(first.entry.id)) continue;

      const secondText = `${second.entry.title}\n${second.entry.content}`;
      const secondPolarity = polarityScore(secondText);
      if (firstPolarity === 0 || secondPolarity === 0) continue;
      if (Math.sign(firstPolarity) === Math.sign(secondPolarity)) continue;

      const secondTokens = new Set(extractTopicTokens(second.entry));
      const overlap = Array.from(firstTokens).filter((token) => secondTokens.has(token));
      if (overlap.length < 2) continue;

      conflicts.push({
        firstEntryId: first.entry.id,
        secondEntryId: second.entry.id,
        topicTokens: overlap.slice(0, 6),
        reason:
          "Potentially contradictory memory guidance detected on the same topic with opposite polarity.",
      });
    }
  }
  return conflicts.slice(0, 20);
}

function buildDiagnostics(entries: RetrievedMemoryEntry[]): MemoryRetrievalDiagnostics {
  const conflicts = detectMemoryConflicts(entries);
  const requiresVerificationBeforeMutation = conflicts.length > 0;
  const guidance: string[] = [];
  if (requiresVerificationBeforeMutation) {
    guidance.push(
      "Conflicting memory signals found. Gather fresh evidence (read files/tests/commands) before mutating files."
    );
    guidance.push(
      "Prefer the most recently validated evidence-backed memory entry; treat others as hypotheses."
    );
  }
  return {
    conflictCount: conflicts.length,
    conflicts,
    requiresVerificationBeforeMutation,
    guidance: guidance.slice(0, 6),
  };
}

function minimumConfidenceForType(type: MemoryEntryType): number {
  switch (type) {
    case "bug_pattern":
      return 0.7;
    case "project_convention":
      return 0.6;
    case "verification_rule":
      return 0.55;
    case "fix_pattern":
      return 0.55;
    case "continuation":
      return 0.5;
    default:
      return 0.55;
  }
}

function entryToContextLine(entry: LongTermMemoryEntry): string {
  const tags = entry.tags.length > 0 ? ` tags=${entry.tags.join(",")}` : "";
  const pinMark = entry.pinned ? " pinned=true" : "";
  const confidenceMark = ` confidence=${entry.confidenceScore.toFixed(2)}`;
  const validatedMark = entry.lastValidatedAt
    ? ` validatedAt=${entry.lastValidatedAt}`
    : "";
  const invalidatedMark = entry.invalidatedAt
    ? ` invalidatedAt=${entry.invalidatedAt}`
    : "";
  const evidenceMark = entry.evidence.length > 0 ? ` evidence=${entry.evidence.length}` : "";
  return [
    `- [${entry.type}] ${entry.title}${pinMark}${tags}${confidenceMark}${validatedMark}${invalidatedMark}${evidenceMark}`,
    `  ${entry.content}`,
  ].join("\n");
}

export async function listMemoryEntries(workspace: string): Promise<{
  entries: LongTermMemoryEntry[];
  latestContinuation?: ContinuationPacket;
}> {
  const store = await loadStore(workspace);
  const entries = [...store.entries].sort((first, second) => {
    if (first.pinned !== second.pinned) return first.pinned ? -1 : 1;
    const firstTime = Date.parse(first.updatedAt);
    const secondTime = Date.parse(second.updatedAt);
    return secondTime - firstTime;
  });
  return {
    entries,
    latestContinuation: store.latestContinuation,
  };
}

export async function retrieveMemoryContext(
  params: RetrieveMemoryParams
): Promise<{
  entries: RetrievedMemoryEntry[];
  contextBlock: string;
  diagnostics: MemoryRetrievalDiagnostics;
  latestContinuation?: ContinuationPacket;
}> {
  const store = await loadStore(params.workspace);
  const queryTokens = new Set(tokenize(params.query));
  const nowMs = Date.now();
  const limit = clamp(params.limit ?? DEFAULT_LIMIT, 1, 30);
  const maxChars = clamp(params.maxChars ?? DEFAULT_MAX_CONTEXT_CHARS, 300, 12000);
  const allowedTypes = params.types ? new Set(params.types) : null;

  const scored: RetrievedMemoryEntry[] = store.entries
    .filter((entry) => {
      if (!params.includePinned && entry.pinned) return false;
      if (allowedTypes && !allowedTypes.has(entry.type)) return false;
      if (entry.invalidatedAt) return false;
      if (entry.tags.includes("dry_run") && !entry.pinned) return false;
      if (!entry.pinned && entry.confidenceScore < minimumConfidenceForType(entry.type)) {
        return false;
      }
      return true;
    })
    .map((entry) => ({
      entry,
      score: scoreMemoryEntry(entry, queryTokens, nowMs),
    }))
    .sort((first, second) => second.score - first.score)
    .slice(0, Math.max(limit * 3, 20));

  const selected: RetrievedMemoryEntry[] = [];
  let usedChars = 0;
  for (const item of scored) {
    if (selected.length >= limit) break;
    const line = entryToContextLine(item.entry);
    if (usedChars + line.length > maxChars && selected.length > 0) break;
    selected.push(item);
    usedChars += line.length + 1;
  }

  const diagnostics = buildDiagnostics(selected);
  const conflictLines =
    diagnostics.conflicts.length > 0
      ? [
          "Memory conflicts detected:",
          ...diagnostics.conflicts.slice(0, 6).map((conflict, index) => {
            return `${index + 1}. ${conflict.reason} topic=${conflict.topicTokens.join(",") || "(unspecified)"} entries=${conflict.firstEntryId} vs ${conflict.secondEntryId}`;
          }),
          ...diagnostics.guidance.map((line) => `- ${line}`),
        ]
      : [];

  const selectedIds = new Set(selected.map((item) => item.entry.id));
  let storeChanged = false;
  for (const entry of store.entries) {
    if (!selectedIds.has(entry.id)) continue;
    entry.useCount += 1;
    entry.lastUsedAt = nowIso();
    storeChanged = true;
  }
  if (storeChanged) {
    await saveStore(params.workspace, store);
  }

  return {
    entries: selected,
    contextBlock:
      selected.length > 0
        ? [selected.map((item) => entryToContextLine(item.entry)).join("\n"), ...conflictLines]
            .filter(Boolean)
            .join("\n")
        : "(no prior long-term memory retrieved)",
    diagnostics,
    latestContinuation: store.latestContinuation,
  };
}

function mergeSuccessScore(previous: number, incoming: number): number {
  return clamp(previous * 0.65 + incoming * 0.35, 0, 1);
}

function mergeConfidenceScore(previous: number, incoming: number): number {
  return clamp(previous * 0.6 + incoming * 0.4, 0, 1);
}

function mergeRelationIds(existing: string[], incoming: string[] | undefined): string[] {
  return normalizeRelationIds([...(existing || []), ...normalizeRelationIds(incoming)]);
}

function markSupersededEntries(
  store: MemoryStoreData,
  supersededIds: string[],
  replacementId: string
): void {
  if (supersededIds.length === 0) return;
  const now = nowIso();
  const superseded = new Set(supersededIds);
  for (const entry of store.entries) {
    if (!superseded.has(entry.id)) continue;
    entry.invalidatedAt = entry.invalidatedAt || now;
    entry.contradictedBy = mergeRelationIds(entry.contradictedBy, [replacementId]);
    entry.updatedAt = now;
  }
}

export async function addMemoryEntries(
  workspace: string,
  entriesInput: AddMemoryEntryInput[]
): Promise<{ added: number; updated: number }> {
  if (!Array.isArray(entriesInput) || entriesInput.length === 0) {
    return { added: 0, updated: 0 };
  }

  const store = await loadStore(workspace);
  const byDedupe = new Map<string, LongTermMemoryEntry>();
  for (const entry of store.entries) {
    byDedupe.set(entry.dedupeKey, entry);
  }

  let added = 0;
  let updated = 0;

  for (const input of entriesInput) {
    const type = input.type;
    if (
      type !== "bug_pattern" &&
      type !== "fix_pattern" &&
      type !== "verification_rule" &&
      type !== "project_convention" &&
      type !== "continuation"
    ) {
      continue;
    }
    const title = input.title.trim();
    const content = input.content.trim();
    if (!title || !content) continue;

    const dedupeKey = createDedupeKey({
      workspace,
      type,
      title,
      content,
    });
    const existing = byDedupe.get(dedupeKey);
    const score = clamp(input.successScore ?? 0.6, 0, 1);
    const confidenceScore = clamp(input.confidenceScore ?? score, 0, 1);
    const timestamp = nowIso();
    const normalizedEvidence = normalizeEvidence(input.evidence);
    const normalizedSupersedes = normalizeRelationIds(input.supersedes);
    const normalizedContradictedBy = normalizeRelationIds(input.contradictedBy);
    const normalizedLastValidatedAt =
      typeof input.lastValidatedAt === "string" && input.lastValidatedAt.trim().length > 0
        ? input.lastValidatedAt
        : undefined;
    const normalizedInvalidatedAt =
      typeof input.invalidatedAt === "string" && input.invalidatedAt.trim().length > 0
        ? input.invalidatedAt
        : undefined;

    if (existing) {
      existing.updatedAt = timestamp;
      existing.successScore = mergeSuccessScore(existing.successScore, score);
      existing.confidenceScore = mergeConfidenceScore(
        existing.confidenceScore,
        confidenceScore
      );
      existing.pinned = existing.pinned || Boolean(input.pinned);
      existing.tags = Array.from(new Set([...existing.tags, ...normalizeTags(input.tags)]))
        .slice(0, MAX_TAGS_PER_ENTRY);
      existing.evidence = mergeEvidence(existing.evidence, normalizedEvidence);
      existing.supersedes = mergeRelationIds(existing.supersedes, normalizedSupersedes);
      existing.contradictedBy = mergeRelationIds(
        existing.contradictedBy,
        normalizedContradictedBy
      );
      if (normalizedLastValidatedAt) {
        existing.lastValidatedAt = normalizedLastValidatedAt;
      } else if (existing.evidence.length > 0 && !existing.lastValidatedAt) {
        existing.lastValidatedAt = timestamp;
      }
      if (normalizedInvalidatedAt) {
        existing.invalidatedAt = normalizedInvalidatedAt;
      }
      if (input.sourceRunId) existing.sourceRunId = input.sourceRunId;
      if (input.sourceGoal) existing.sourceGoal = input.sourceGoal;
      markSupersededEntries(store, normalizedSupersedes, existing.id);
      updated += 1;
      continue;
    }

    const entry: LongTermMemoryEntry = {
      id: randomUUID(),
      workspace,
      type,
      title: title.slice(0, MAX_ENTRY_TITLE_CHARS),
      content: content.slice(0, MAX_ENTRY_CONTENT_CHARS),
      tags: normalizeTags(input.tags),
      pinned: Boolean(input.pinned),
      successScore: score,
      confidenceScore,
      evidence: normalizedEvidence,
      useCount: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
      lastValidatedAt:
        normalizedLastValidatedAt || (normalizedEvidence.length > 0 ? timestamp : undefined),
      invalidatedAt: normalizedInvalidatedAt,
      supersedes: normalizedSupersedes,
      contradictedBy: normalizedContradictedBy,
      sourceRunId: input.sourceRunId,
      sourceGoal: input.sourceGoal,
      dedupeKey,
    };

    store.entries.push(entry);
    byDedupe.set(dedupeKey, entry);
    markSupersededEntries(store, normalizedSupersedes, entry.id);
    added += 1;
  }

  if (added > 0 || updated > 0) {
    await saveStore(workspace, store);
  }

  return { added, updated };
}

export async function pinMemoryEntry(
  workspace: string,
  memoryId: string,
  pinned: boolean
): Promise<{ updated: boolean }> {
  const store = await loadStore(workspace);
  const target = store.entries.find((entry) => entry.id === memoryId);
  if (!target) return { updated: false };
  target.pinned = pinned;
  target.updatedAt = nowIso();
  await saveStore(workspace, store);
  return { updated: true };
}

export async function forgetMemoryEntry(
  workspace: string,
  memoryId: string
): Promise<{ removed: boolean }> {
  const store = await loadStore(workspace);
  const nextEntries = store.entries.filter((entry) => entry.id !== memoryId);
  if (nextEntries.length === store.entries.length) {
    return { removed: false };
  }
  store.entries = nextEntries;
  await saveStore(workspace, store);
  return { removed: true };
}

export async function exportMemoryStore(workspace: string): Promise<MemoryStoreData> {
  return loadStore(workspace);
}

export async function importMemoryStore(
  workspace: string,
  payload: unknown,
  mode: "merge" | "replace" = "merge"
): Promise<{ imported: number; replaced: boolean }> {
  const parsed = payload as {
    entries?: unknown;
    latestContinuation?: unknown;
  };
  const incomingEntries = Array.isArray(parsed?.entries)
    ? parsed.entries
        .map((entry) => sanitizeEntry(entry))
        .filter((entry): entry is LongTermMemoryEntry => entry !== null)
    : [];
  const incomingContinuation = sanitizeContinuation(parsed?.latestContinuation);

  if (mode === "replace") {
    const replacement: MemoryStoreData = {
      version: STORE_VERSION,
      updatedAt: nowIso(),
      entries: incomingEntries.map((entry) => ({
        ...entry,
        workspace,
      })),
      latestContinuation: incomingContinuation,
    };
    await saveStore(workspace, replacement);
    return {
      imported: replacement.entries.length,
      replaced: true,
    };
  }

  const store = await loadStore(workspace);
  const byDedupe = new Map<string, LongTermMemoryEntry>();
  for (const entry of store.entries) {
    byDedupe.set(entry.dedupeKey, entry);
  }

  let imported = 0;
  for (const incoming of incomingEntries) {
    const normalized: LongTermMemoryEntry = {
      ...incoming,
      workspace,
      dedupeKey:
        incoming.dedupeKey ||
        createDedupeKey({
          workspace,
          type: incoming.type,
          title: incoming.title,
          content: incoming.content,
        }),
    };
    const existing = byDedupe.get(normalized.dedupeKey);
    if (existing) {
      existing.updatedAt = nowIso();
      existing.successScore = mergeSuccessScore(existing.successScore, normalized.successScore);
      existing.confidenceScore = mergeConfidenceScore(
        existing.confidenceScore,
        normalized.confidenceScore
      );
      existing.tags = Array.from(new Set([...existing.tags, ...normalized.tags])).slice(
        0,
        MAX_TAGS_PER_ENTRY
      );
      existing.pinned = existing.pinned || normalized.pinned;
      existing.evidence = mergeEvidence(existing.evidence, normalized.evidence);
      existing.supersedes = mergeRelationIds(existing.supersedes, normalized.supersedes);
      existing.contradictedBy = mergeRelationIds(
        existing.contradictedBy,
        normalized.contradictedBy
      );
      if (normalized.lastValidatedAt) {
        existing.lastValidatedAt = normalized.lastValidatedAt;
      }
      if (normalized.invalidatedAt) {
        existing.invalidatedAt = normalized.invalidatedAt;
      }
      markSupersededEntries(store, normalized.supersedes, existing.id);
      continue;
    }
    store.entries.push(normalized);
    byDedupe.set(normalized.dedupeKey, normalized);
    markSupersededEntries(store, normalized.supersedes, normalized.id);
    imported += 1;
  }

  if (incomingContinuation) {
    store.latestContinuation = incomingContinuation;
  }
  await saveStore(workspace, store);
  return {
    imported,
    replaced: false,
  };
}

export async function saveContinuationPacket(
  workspace: string,
  packet: ContinuationPacket
): Promise<void> {
  const store = await loadStore(workspace);
  store.latestContinuation = packet;
  await saveStore(workspace, store);

  await addMemoryEntries(workspace, [
    {
      type: "continuation",
      title: `Continuation ${packet.runId}`,
      content: [
        `Goal: ${packet.goal}`,
        `Summary: ${packet.summary}`,
        `Pending: ${packet.pendingWork.join("; ") || "(none)"}`,
        `Next actions: ${packet.nextActions.join("; ") || "(none)"}`,
      ].join("\n"),
      tags: ["continuation", packet.executionMode, "resume"],
      pinned: false,
      successScore: 0.5,
      confidenceScore: 0.65,
      evidence: [
        {
          type: "run_summary",
          source: `run:${packet.runId}`,
          summary: `Continuation snapshot for ${packet.executionMode} execution mode.`,
          createdAt: packet.createdAt,
        },
      ],
      lastValidatedAt: packet.createdAt,
      sourceRunId: packet.runId,
      sourceGoal: packet.goal,
    },
  ]);
}

export async function getLatestContinuationPacket(
  workspace: string
): Promise<ContinuationPacket | undefined> {
  const store = await loadStore(workspace);
  return store.latestContinuation;
}
