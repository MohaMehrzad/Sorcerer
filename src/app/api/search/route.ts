import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";

const execFileAsync = promisify(execFile);

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export async function POST(req: NextRequest) {
  let body: { query?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const query = body.query?.trim();
  if (!query) {
    return NextResponse.json({ error: "Query is required" }, { status: 400 });
  }

  try {
    const scriptPath = path.join(process.cwd(), "scripts", "search.py");
    const { stdout } = await execFileAsync("python3", [scriptPath, query], {
      timeout: 15000,
    });

    const parsed = JSON.parse(stdout);

    // Check if the script returned an error
    if (parsed.error) {
      return NextResponse.json({ error: parsed.error }, { status: 502 });
    }

    const results: SearchResult[] = Array.isArray(parsed) ? parsed : [];
    return NextResponse.json({ results });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Search failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
