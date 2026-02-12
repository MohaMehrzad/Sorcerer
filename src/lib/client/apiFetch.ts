"use client";

const BOT_PROFILE_KEY = "sorcerer-bot-profile-v1";

interface StoredBotProfile {
  apiKey?: unknown;
}

function readStoredApiKey(storage: Storage): string | null {
  try {
    const raw = storage.getItem(BOT_PROFILE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredBotProfile;
    if (typeof parsed.apiKey !== "string") return null;
    const token = parsed.apiKey.trim();
    return token.length > 0 ? token : null;
  } catch {
    return null;
  }
}

function resolveApiAuthToken(): string | null {
  const explicit = process.env.NEXT_PUBLIC_SORCERER_API_AUTH_TOKEN?.trim();
  if (explicit) return explicit;

  if (typeof window === "undefined") {
    return null;
  }

  const sessionToken = readStoredApiKey(window.sessionStorage);
  if (sessionToken) return sessionToken;

  const localToken = readStoredApiKey(window.localStorage);
  if (localToken) return localToken;

  return null;
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
