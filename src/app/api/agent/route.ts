import { NextRequest, NextResponse } from "next/server";
import {
  normalizeAgentRunRequest,
} from "@/lib/server/agentRunner";
import { runAgentWithAutoFallback } from "@/lib/server/agentExecution";
import { buildCorsHeaders, enforceApiAccess } from "@/lib/server/accessGuard";

export const maxDuration = 1800;

function corsHeaders(req: NextRequest): Record<string, string> {
  return buildCorsHeaders(req, "POST, OPTIONS");
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(req),
  });
}

export async function POST(req: NextRequest) {
  const denied = enforceApiAccess(req, {
    includeCorsHeaders: true,
    methods: "POST, OPTIONS",
  });
  if (denied) return denied;

  let body: unknown;

  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400, headers: corsHeaders(req) }
    );
  }

  const normalized = normalizeAgentRunRequest(body);
  if (!normalized.request) {
    return NextResponse.json(
      { error: normalized.error || "Invalid request" },
      { status: 400, headers: corsHeaders(req) }
    );
  }

  const { result } = await runAgentWithAutoFallback(normalized.request, {
    signal: req.signal,
  });

  const isFailed = result.status === "failed";
  const status = isFailed ? 500 : 200;

  return NextResponse.json(result, {
    status,
    headers: corsHeaders(req),
  });
}
