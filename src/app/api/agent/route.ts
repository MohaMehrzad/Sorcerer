import { NextRequest, NextResponse } from "next/server";
import {
  normalizeAgentRunRequest,
  runAutonomousAgent,
} from "@/lib/server/agentRunner";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  let body: unknown;

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const normalized = normalizeAgentRunRequest(body);
  if (!normalized.request) {
    return NextResponse.json(
      { error: normalized.error || "Invalid request" },
      { status: 400 }
    );
  }

  const result = await runAutonomousAgent(normalized.request, {
    signal: req.signal,
  });

  const isFailed = result.status === "failed";
  const status = isFailed ? 500 : 200;

  return NextResponse.json(result, { status });
}
