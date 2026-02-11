export interface Message {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

export interface Chat {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
}

const STORAGE_KEY = "sorcerer-history";
const BOT_PROFILE_KEY = "sorcerer-bot-profile-v1";
const WORKSPACE_STORAGE_KEY = "sorcerer-workspaces-v1";

export interface WorkspaceEntry {
  id: string;
  name: string;
  path: string;
  createdAt: number;
  updatedAt: number;
}

export interface BotProfile {
  botName: string;
  apiUrl: string;
  apiKey: string;
  model: string;
  botContext: string;
  workspacePath: string;
  enabledSkillFiles: string[];
  updatedAt: number;
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function loadChats(): Chat[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as Chat[];
  } catch {
    return [];
  }
}

export function saveChats(chats: Chat[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(chats));
}

export function createChat(): Chat {
  return {
    id: generateId(),
    title: "New Chat",
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export function generateTitle(messages: Message[]): string {
  const firstUser = messages.find((m) => m.role === "user");
  if (!firstUser) return "New Chat";
  const text = firstUser.content.trim();
  if (text.length <= 40) return text;
  return text.slice(0, 40) + "...";
}

export function loadBotProfile(): BotProfile | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(BOT_PROFILE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<BotProfile>;

    const botName = typeof parsed.botName === "string" ? parsed.botName.trim() : "";
    const apiUrl = typeof parsed.apiUrl === "string" ? parsed.apiUrl.trim() : "";
    const apiKey = typeof parsed.apiKey === "string" ? parsed.apiKey.trim() : "";
    const model = typeof parsed.model === "string" ? parsed.model.trim() : "";
    const botContext =
      typeof parsed.botContext === "string" ? parsed.botContext.trim() : "";
    const workspacePath =
      typeof parsed.workspacePath === "string" ? parsed.workspacePath.trim() : ".";
    const enabledSkillFiles = Array.isArray(parsed.enabledSkillFiles)
      ? parsed.enabledSkillFiles
          .filter((value): value is string => typeof value === "string")
          .map((value) => value.trim())
          .filter(Boolean)
      : [];

    if (!botName || !apiUrl || !apiKey || !model) {
      return null;
    }

    return {
      botName,
      apiUrl,
      apiKey,
      model,
      botContext,
      workspacePath: workspacePath || ".",
      enabledSkillFiles,
      updatedAt:
        typeof parsed.updatedAt === "number" && Number.isFinite(parsed.updatedAt)
          ? parsed.updatedAt
          : Date.now(),
    };
  } catch {
    return null;
  }
}

export function saveBotProfile(profile: BotProfile) {
  if (typeof window === "undefined") return;
  localStorage.setItem(BOT_PROFILE_KEY, JSON.stringify(profile));
}

function deriveWorkspaceName(inputPath: string): string {
  const normalized = inputPath.replace(/[\\/]+$/, "");
  const segments = normalized.split(/[\\/]/).filter(Boolean);
  if (segments.length === 0) {
    return "Workspace";
  }
  return segments[segments.length - 1];
}

export function createWorkspaceEntry(path: string, name?: string): WorkspaceEntry {
  const normalizedPath = path.trim();
  const now = Date.now();

  return {
    id: generateId(),
    name: (name || "").trim() || deriveWorkspaceName(normalizedPath),
    path: normalizedPath,
    createdAt: now,
    updatedAt: now,
  };
}

export function loadWorkspaces(): WorkspaceEntry[] {
  if (typeof window === "undefined") return [];

  try {
    const raw = localStorage.getItem(WORKSPACE_STORAGE_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];

    const dedupe = new Map<string, WorkspaceEntry>();

    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;

      const record = item as Partial<WorkspaceEntry>;
      const path = typeof record.path === "string" ? record.path.trim() : "";
      if (!path) continue;

      const name =
        typeof record.name === "string" && record.name.trim().length > 0
          ? record.name.trim()
          : deriveWorkspaceName(path);

      const createdAt =
        typeof record.createdAt === "number" && Number.isFinite(record.createdAt)
          ? record.createdAt
          : Date.now();
      const updatedAt =
        typeof record.updatedAt === "number" && Number.isFinite(record.updatedAt)
          ? record.updatedAt
          : createdAt;

      const existing = dedupe.get(path);
      if (existing) {
        if (updatedAt > existing.updatedAt) {
          dedupe.set(path, {
            ...existing,
            id:
              typeof record.id === "string" && record.id.trim().length > 0
                ? record.id.trim()
                : existing.id,
            name,
            updatedAt,
          });
        }
        continue;
      }

      dedupe.set(path, {
        id:
          typeof record.id === "string" && record.id.trim().length > 0
            ? record.id.trim()
            : generateId(),
        name,
        path,
        createdAt,
        updatedAt,
      });
    }

    return Array.from(dedupe.values()).sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

export function saveWorkspaces(workspaces: WorkspaceEntry[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(workspaces));
}

export function upsertWorkspaceEntry(
  workspaces: WorkspaceEntry[],
  path: string,
  name?: string
): {
  workspaces: WorkspaceEntry[];
  entry: WorkspaceEntry;
} {
  const normalizedPath = path.trim();
  const now = Date.now();
  const existingIndex = workspaces.findIndex(
    (workspace) => workspace.path === normalizedPath
  );

  if (existingIndex >= 0) {
    const current = workspaces[existingIndex];
    const next: WorkspaceEntry = {
      ...current,
      name: (name || "").trim() || current.name || deriveWorkspaceName(normalizedPath),
      updatedAt: now,
    };

    const nextList = workspaces.slice();
    nextList[existingIndex] = next;
    nextList.sort((a, b) => b.updatedAt - a.updatedAt);

    return {
      workspaces: nextList,
      entry: next,
    };
  }

  const created: WorkspaceEntry = {
    ...createWorkspaceEntry(normalizedPath, name),
    updatedAt: now,
  };

  const nextList = [created, ...workspaces].sort((a, b) => b.updatedAt - a.updatedAt);
  return {
    workspaces: nextList,
    entry: created,
  };
}
