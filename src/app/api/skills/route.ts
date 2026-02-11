import { NextRequest, NextResponse } from "next/server";
import { parseModelConfigInput } from "@/lib/server/model";
import {
  createSkillFromPrompt,
  getGlobalSkillsDirectory,
  listSkillMetas,
  migrateWorkspaceSkillsToGlobal,
} from "@/lib/server/skills";
import { resolveWorkspacePath } from "@/lib/server/workspace";

interface SkillsRequestBody {
  action?: unknown;
  workspacePath?: unknown;
  prompt?: unknown;
  modelConfig?: unknown;
}

export async function POST(req: NextRequest) {
  let body: SkillsRequestBody;
  try {
    body = (await req.json()) as SkillsRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const action = typeof body.action === "string" ? body.action.trim() : "";
  if (!action) {
    return NextResponse.json({ error: "action is required" }, { status: 400 });
  }
  const workspacePath =
    typeof body.workspacePath === "string" && body.workspacePath.trim().length > 0
      ? body.workspacePath.trim()
      : undefined;
  let resolvedWorkspacePath: string | undefined;
  if (workspacePath) {
    try {
      resolvedWorkspacePath = await resolveWorkspacePath(workspacePath);
    } catch {
      resolvedWorkspacePath = undefined;
    }
  }
  const skillsRoot = getGlobalSkillsDirectory();

  if (action === "list") {
    try {
      let migratedCount = 0;
      if (resolvedWorkspacePath) {
        migratedCount = await migrateWorkspaceSkillsToGlobal(resolvedWorkspacePath);
      }
      const skills = await listSkillMetas();
      return NextResponse.json({
        workspacePath,
        skillsRoot,
        migratedCount,
        skills,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to list skills";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  if (action === "create") {
    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    if (!prompt) {
      return NextResponse.json({ error: "prompt is required" }, { status: 400 });
    }

    let modelConfig;
    try {
      modelConfig = parseModelConfigInput(body.modelConfig);
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Invalid modelConfig" },
        { status: 400 }
      );
    }

    try {
      if (resolvedWorkspacePath) {
        await migrateWorkspaceSkillsToGlobal(resolvedWorkspacePath);
      }
      const created = await createSkillFromPrompt({
        prompt,
        modelConfig,
      });
      const skills = await listSkillMetas();
      return NextResponse.json({
        workspacePath,
        skillsRoot,
        created,
        skills,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create skill";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  return NextResponse.json(
    { error: `Unknown action: ${action}` },
    { status: 400 }
  );
}
