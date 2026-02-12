import { NextRequest, NextResponse } from "next/server";
import {
  exportMemoryStore,
  forgetMemoryEntry,
  importMemoryStore,
  listMemoryEntries,
  MemoryEntryType,
  pinMemoryEntry,
  retrieveMemoryContext,
} from "@/lib/server/memoryStore";
import { resolveWorkspacePath } from "@/lib/server/workspace";

const ALLOWED_MEMORY_TYPES: ReadonlySet<MemoryEntryType> = new Set([
  "bug_pattern",
  "fix_pattern",
  "verification_rule",
  "project_convention",
  "continuation",
]);

function normalizeMemoryTypes(value: unknown): MemoryEntryType[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const selected = value
    .filter((item): item is string => typeof item === "string")
    .filter((item): item is MemoryEntryType =>
      ALLOWED_MEMORY_TYPES.has(item as MemoryEntryType)
    );
  return selected.length > 0 ? selected : undefined;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function readNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

export async function POST(req: NextRequest) {
  let body: {
    action?: unknown;
    workspacePath?: unknown;
    query?: unknown;
    limit?: unknown;
    maxChars?: unknown;
    includePinned?: unknown;
    types?: unknown;
    memoryId?: unknown;
    pinned?: unknown;
    payload?: unknown;
    mode?: unknown;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const action = typeof body.action === "string" ? body.action.trim() : "";
  if (!action) {
    return NextResponse.json({ error: "Action is required" }, { status: 400 });
  }

  try {
    const workspace = await resolveWorkspacePath(
      typeof body.workspacePath === "string" ? body.workspacePath : undefined
    );

    if (action === "list") {
      const result = await listMemoryEntries(workspace);
      return NextResponse.json({
        workspace,
        entries: result.entries,
        latestContinuation: result.latestContinuation || null,
      });
    }

    if (action === "retrieve") {
      const query =
        typeof body.query === "string" && body.query.trim().length > 0
          ? body.query.trim()
          : "";
      if (!query) {
        return NextResponse.json({ error: "query is required for retrieve" }, { status: 400 });
      }
      const limit = readNumber(body.limit, 10, 1, 30);
      const maxChars = readNumber(body.maxChars, 4200, 300, 12000);
      const includePinned = readBoolean(body.includePinned, true);
      const types = normalizeMemoryTypes(body.types);
      const result = await retrieveMemoryContext({
        workspace,
        query,
        limit,
        maxChars,
        includePinned,
        types,
      });
      return NextResponse.json({
        workspace,
        entries: result.entries,
        contextBlock: result.contextBlock,
        diagnostics: result.diagnostics,
        latestContinuation: result.latestContinuation || null,
      });
    }

    if (action === "pin") {
      const memoryId =
        typeof body.memoryId === "string" && body.memoryId.trim().length > 0
          ? body.memoryId.trim()
          : "";
      if (!memoryId) {
        return NextResponse.json({ error: "memoryId is required for pin" }, { status: 400 });
      }
      const pinned = readBoolean(body.pinned, true);
      const result = await pinMemoryEntry(workspace, memoryId, pinned);
      return NextResponse.json({
        workspace,
        updated: result.updated,
      });
    }

    if (action === "forget") {
      const memoryId =
        typeof body.memoryId === "string" && body.memoryId.trim().length > 0
          ? body.memoryId.trim()
          : "";
      if (!memoryId) {
        return NextResponse.json(
          { error: "memoryId is required for forget" },
          { status: 400 }
        );
      }
      const result = await forgetMemoryEntry(workspace, memoryId);
      return NextResponse.json({
        workspace,
        removed: result.removed,
      });
    }

    if (action === "export") {
      const store = await exportMemoryStore(workspace);
      return NextResponse.json({
        workspace,
        store,
      });
    }

    if (action === "import") {
      const mode = body.mode === "replace" ? "replace" : "merge";
      const importResult = await importMemoryStore(workspace, body.payload, mode);
      return NextResponse.json({
        workspace,
        imported: importResult.imported,
        replaced: importResult.replaced,
      });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Memory operation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
