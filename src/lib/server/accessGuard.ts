import { timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";

const DEFAULT_ALLOWED_ORIGINS = ["http://127.0.0.1:7777", "http://localhost:7777"];

function normalizeConfiguredOrigins(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function resolveAllowedOrigins(): string[] {
  const configured = normalizeConfiguredOrigins(process.env.CORS_ALLOWED_ORIGINS);
  return configured.length > 0 ? configured : DEFAULT_ALLOWED_ORIGINS;
}

function normalizeHost(value: string | null): string {
  if (!value) return "";
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return "";
  if (trimmed.startsWith("[")) {
    const closing = trimmed.indexOf("]");
    if (closing >= 0) {
      return trimmed.slice(1, closing);
    }
  }
  return trimmed.split(":")[0];
}

function isLoopbackHost(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

function extractBearerToken(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  const match = trimmed.match(/^bearer\s+(.+)$/i);
  if (!match) return null;
  const token = match[1].trim();
  return token.length > 0 ? token : null;
}

function constantTimeEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function resolveExpectedApiToken(): string | null {
  const explicit =
    process.env.SORCERER_API_AUTH_TOKEN?.trim() ||
    process.env.API_AUTH_TOKEN?.trim() ||
    "";
  return explicit || null;
}

interface GuardOptions {
  requireOrigin?: boolean;
  includeCorsHeaders?: boolean;
  methods?: string;
}

export function buildCorsHeaders(
  req: NextRequest,
  methods: string = "POST, OPTIONS"
): Record<string, string> {
  const requestOrigin = req.headers.get("origin")?.trim();
  const allowedOrigins = resolveAllowedOrigins();
  const origin =
    requestOrigin && allowedOrigins.includes(requestOrigin)
      ? requestOrigin
      : allowedOrigins[0] || "http://127.0.0.1:7777";

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": methods,
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, X-Sorcerer-Auth, X-Requested-With",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export function enforceApiAccess(
  req: NextRequest,
  options: GuardOptions = {}
): NextResponse | null {
  const requireOrigin = options.requireOrigin ?? true;
  const includeCorsHeaders = options.includeCorsHeaders ?? false;
  const corsHeaders = includeCorsHeaders
    ? buildCorsHeaders(req, options.methods)
    : undefined;

  const host = normalizeHost(req.headers.get("host"));
  const allowRemoteHost = process.env.ALLOW_REMOTE_API === "true";
  if (!allowRemoteHost && (!host || !isLoopbackHost(host))) {
    return NextResponse.json(
      {
        error:
          "Remote API access is disabled. Use localhost only or set ALLOW_REMOTE_API=true explicitly.",
      },
      { status: 403, headers: corsHeaders }
    );
  }

  const origin = req.headers.get("origin")?.trim() || "";
  const allowedOrigins = resolveAllowedOrigins();
  if (origin) {
    if (!allowedOrigins.includes(origin)) {
      return NextResponse.json(
        {
          error:
            "Origin is not allowed for this API. Update CORS_ALLOWED_ORIGINS to include this origin.",
        },
        { status: 403, headers: corsHeaders }
      );
    }
  } else if (requireOrigin) {
    return NextResponse.json(
      {
        error:
          "Missing Origin header. Browser-originated requests from the trusted frontend are required.",
      },
      { status: 403, headers: corsHeaders }
    );
  }

  const expectedToken = resolveExpectedApiToken();
  if (expectedToken) {
    const providedToken =
      extractBearerToken(req.headers.get("authorization")) ||
      req.headers.get("x-sorcerer-auth")?.trim() ||
      "";
    if (!providedToken || !constantTimeEquals(providedToken, expectedToken)) {
      return NextResponse.json(
        {
          error:
            "Unauthorized API request. Provide a valid bearer token that matches server auth settings.",
        },
        { status: 401, headers: corsHeaders }
      );
    }
  }

  return null;
}
