"use client";

import { getRuntimeApiKey } from "@/lib/store";

function resolveApiAuthToken(): string | null {
  const explicit = process.env.NEXT_PUBLIC_SORCERER_API_AUTH_TOKEN?.trim();
  if (explicit) return explicit;

  const runtimeToken = getRuntimeApiKey().trim();
  return runtimeToken || null;
}

function withAuthHeaders(inputHeaders?: HeadersInit): Headers {
  const headers = new Headers(inputHeaders);
  const token = resolveApiAuthToken();
  if (!token) return headers;

  if (!headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  if (!headers.has("X-Sorcerer-Auth")) {
    headers.set("X-Sorcerer-Auth", token);
  }

  return headers;
}

export async function apiFetch(
  input: RequestInfo | URL,
  init: RequestInit = {}
): Promise<Response> {
  return fetch(input, {
    ...init,
    headers: withAuthHeaders(init.headers),
  });
}
