import { NextRequest, NextResponse } from "next/server";
import {
  AgentRunProgressEvent,
  normalizeAgentRunRequest,
  runAutonomousAgent,
} from "@/lib/server/agentRunner";

export const maxDuration = 300;

function encodeEvent(event: AgentRunProgressEvent | { type: "completed" | "failed"; data: unknown }): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(event)}\n`);
}

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

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (
        event: AgentRunProgressEvent | { type: "completed" | "failed"; data: unknown }
      ) => {
        controller.enqueue(encodeEvent(event));
      };

      try {
        const result = await runAutonomousAgent(normalized.request!, {
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
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
