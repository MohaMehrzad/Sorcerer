import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { collectProjectIntelligence } from "@/lib/server/projectIntelligence";

const WORKSPACE = process.env.WORKSPACE_DIR || process.cwd();

function resolveWorkspace(rawWorkspace: string | null): string {
  if (!rawWorkspace || rawWorkspace.trim().length === 0) {
    return WORKSPACE;
  }

  const normalizedRoot = path.resolve(WORKSPACE);
  const candidate = path.resolve(normalizedRoot, rawWorkspace.trim());
  if (candidate !== normalizedRoot && !candidate.startsWith(`${normalizedRoot}${path.sep}`)) {
    throw new Error("workspace must stay inside the configured root workspace");
  }

  return candidate;
}

export const maxDuration = 120;

export async function GET(req: NextRequest) {
  try {
    const workspace = resolveWorkspace(req.nextUrl.searchParams.get("workspace"));
    const intelligence = await collectProjectIntelligence(workspace);
    return NextResponse.json({ intelligence }, { status: 200 });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to collect project intelligence";
    const status = message.includes("workspace must stay inside") ? 400 : 500;
    return NextResponse.json(
      {
        error: message,
      },
      { status }
    );
  }
}
