import { NextRequest, NextResponse } from "next/server";
import {
  AgentRunProgressEvent,
  normalizeAgentRunRequest,
  runAutonomousAgent,
} from "@/lib/server/agentRunner";
import { runMultiAgentAutonomous } from "@/lib/server/multiAgentRunner";

export const maxDuration = 300;

function encodeEvent(event: AgentRunProgressEvent | { type: "completed" | "failed"; data: unknown }): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(event)}\n`);
}

function normalizeConfiguredOrigins(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function resolveCorsOrigin(req: NextRequest): string {
  const requestOrigin = req.headers.get("origin")?.trim();
  const configuredOrigins = normalizeConfiguredOrigins(process.env.CORS_ALLOWED_ORIGINS);
  const defaultOrigins = ["http://127.0.0.1:7777", "http://localhost:7777"];
  const allowedOrigins = configuredOrigins.length > 0 ? configuredOrigins : defaultOrigins;

  if (requestOrigin && allowedOrigins.includes(requestOrigin)) {
    return requestOrigin;
  }

  return allowedOrigins[0] || "*";
}

function corsHeaders(req: NextRequest): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": resolveCorsOrigin(req),
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(req),
  });
}

export async function POST(req: NextRequest) {
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

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (
        event: AgentRunProgressEvent | { type: "completed" | "failed"; data: unknown }
      ) => {
        controller.enqueue(encodeEvent(event));
      };
      const startedAt = Date.now();
      const heartbeat = setInterval(() => {
        const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
        send({
          type: "status",
          data: {
            message: `Run in progress (${elapsedSeconds}s elapsed)...`,
          },
        });
      }, 15000);

      try {
        const result =
          normalized.request!.executionMode === "multi"
            ? await runMultiAgentAutonomous(normalized.request!, {
                signal: req.signal,
                onEvent: (event) => send(event),
              })
            : await runAutonomousAgent(normalized.request!, {
                signal: req.signal,
                onEvent: (event) => send(event),
              });

        send({
          type: result.status === "failed" ? "failed" : "completed",
          data: { result },
        });
      } catch (err) {
        send({
          type: "failed",
          data: {
            error: err instanceof Error ? err.message : "Streaming agent failed",
          },
        });
      } finally {
        clearInterval(heartbeat);
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      ...corsHeaders(req),
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
