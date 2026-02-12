import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import { buildCorsHeaders, enforceApiAccess } from "@/lib/server/accessGuard";

const execFileAsync = promisify(execFile);

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

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

  let body: { query?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON" },
      { status: 400, headers: corsHeaders(req) }
    );
  }

  const query = body.query?.trim();
  if (!query) {
    return NextResponse.json(
      { error: "Query is required" },
      { status: 400, headers: corsHeaders(req) }
    );
  }

  try {
    const scriptPath = path.join(process.cwd(), "scripts", "search.py");
    const { stdout } = await execFileAsync("python3", [scriptPath, query], {
      timeout: 15000,
    });

    const parsed = JSON.parse(stdout);

    // Check if the script returned an error
    if (parsed.error) {
      return NextResponse.json(
        { error: parsed.error },
        { status: 502, headers: corsHeaders(req) }
      );
    }

    const results: SearchResult[] = Array.isArray(parsed) ? parsed : [];
    return NextResponse.json({ results }, { headers: corsHeaders(req) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Search failed";
    return NextResponse.json(
      { error: message },
      { status: 502, headers: corsHeaders(req) }
    );
  }
}
