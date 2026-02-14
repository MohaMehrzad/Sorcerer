export interface ModelMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ModelConfig {
  apiUrl: string;
  apiKey: string;
  model: string;
}

interface CompletionChoice {
  delta?: {
    content?: string;
    reasoning?: string;
  };
  message?: {
    role?: string;
    content?: string;
  };
  finish_reason?: string | null;
}

interface CompletionResponse {
  choices?: CompletionChoice[];
}

interface ModelRequestOptions {
  model?: string;
  stream?: boolean;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  extraBody?: Record<string, unknown>;
  modelConfig?: Partial<ModelConfig>;
}

const DEFAULT_API_URL = "https://api.viwoapp.net/v1/chat/completions";
const DEFAULT_MODEL = "qwen3:30b-128k";
const DEFAULT_MAX_REQUEST_ATTEMPTS = 3;
const MIN_REQUEST_ATTEMPTS = 2;
const MAX_REQUEST_ATTEMPTS = 6;
const DEFAULT_MODEL_REQUEST_TIMEOUT_MS = 20000;
const MIN_MODEL_REQUEST_TIMEOUT_MS = 8000;
const MAX_MODEL_REQUEST_TIMEOUT_MS = 180000;
const DEFAULT_COMPLETION_BODY_TIMEOUT_MS = 120000;
const MIN_COMPLETION_BODY_TIMEOUT_MS = 10000;
const MAX_COMPLETION_BODY_TIMEOUT_MS = 300000;
const MAX_ERROR_BODY_CHARS = 1800;
const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);

function isTruthy(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/^\[|\]$/g, "");
}

function isPrivateIpv4(hostname: string): boolean {
  const match = hostname.match(/^(\d{1,3})(?:\.(\d{1,3})){3}$/);
  if (!match) return false;
  const parts = hostname.split(".").map((part) => Number(part));
  if (parts.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
    return false;
  }

  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 0) return true;
  return false;
}

function isPrivateIpv6(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  if (normalized === "::1") return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  if (
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb")
  ) {
    return true;
  }
  return false;
}

function isPrivateAddress(hostname: string): boolean {
  return isPrivateIpv4(hostname) || isPrivateIpv6(hostname);
}

function parseAllowedHosts(): Set<string> {
  const raw = process.env.MODEL_API_ALLOWED_HOSTS;
  if (!raw) return new Set();

  return new Set(
    raw
      .split(",")
      .map((host) => normalizeHostname(host))
      .filter(Boolean)
  );
}

function normalizeApiUrl(rawUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("Model API URL must be a valid absolute URL");
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Model API URL must use http:// or https://");
  }

  if (!parsed.hostname) {
    throw new Error("Model API URL must include a hostname");
  }

  if (parsed.username || parsed.password) {
    throw new Error("Model API URL must not include embedded credentials");
  }

  const hostname = normalizeHostname(parsed.hostname);
  const allowPrivateHosts = isTruthy(process.env.MODEL_API_ALLOW_PRIVATE_HOSTS);
  const allowedHosts = parseAllowedHosts();

  if (parsed.protocol === "http:" && !LOCAL_HOSTNAMES.has(hostname)) {
    throw new Error("Model API URL over http:// is only allowed for localhost");
  }

  if (isPrivateAddress(hostname) && !allowPrivateHosts && !LOCAL_HOSTNAMES.has(hostname)) {
    throw new Error(
      "Model API URL targets a private network address. Set MODEL_API_ALLOW_PRIVATE_HOSTS=true to allow this explicitly."
    );
  }

  if (allowedHosts.size > 0 && !allowedHosts.has(hostname)) {
    throw new Error(
      `Model API host "${hostname}" is not in MODEL_API_ALLOWED_HOSTS`
    );
  }

  parsed.hash = "";

  return parsed.toString();
}

export function getModelConfig(): ModelConfig {
  const configuredApiUrl =
    process.env.MODEL_API_URL ||
    process.env.CHAT_API_URL ||
    process.env.VIWO_API_URL ||
    DEFAULT_API_URL;
  const apiUrl = normalizeApiUrl(configuredApiUrl);

  return {
    apiUrl,
    apiKey:
      process.env.MODEL_API_KEY ||
      process.env.CHAT_API_KEY ||
      process.env.VIWO_API_KEY ||
      "",
    model:
      process.env.MODEL_NAME ||
      process.env.CHAT_MODEL ||
      process.env.VIWO_MODEL ||
      DEFAULT_MODEL,
  };
}

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function parseModelConfigInput(value: unknown): Partial<ModelConfig> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("modelConfig must be an object");
  }

  const input = value as {
    apiUrl?: unknown;
    apiKey?: unknown;
    model?: unknown;
  };

  if (input.apiUrl !== undefined && typeof input.apiUrl !== "string") {
    throw new Error("modelConfig.apiUrl must be a string");
  }
  if (input.apiKey !== undefined && typeof input.apiKey !== "string") {
    throw new Error("modelConfig.apiKey must be a string");
  }
  if (input.model !== undefined && typeof input.model !== "string") {
    throw new Error("modelConfig.model must be a string");
  }

  const parsed: Partial<ModelConfig> = {};
  const apiUrl = normalizeString(input.apiUrl);
  const apiKey = normalizeString(input.apiKey);
  const model = normalizeString(input.model);

  if (apiUrl && !apiKey) {
    throw new Error(
      "modelConfig.apiUrl override requires modelConfig.apiKey in the same request."
    );
  }

  if (apiUrl) parsed.apiUrl = normalizeApiUrl(apiUrl);
  if (apiKey) parsed.apiKey = apiKey;
  if (model) parsed.model = model;

  return parsed;
}

export function resolveModelConfig(override?: Partial<ModelConfig>): ModelConfig {
  const base = getModelConfig();
  const overrideApiUrl = normalizeString(override?.apiUrl);
  const overrideApiKey = normalizeString(override?.apiKey);

  if (overrideApiUrl && !overrideApiKey) {
    throw new Error(
      "modelConfig.apiUrl override requires modelConfig.apiKey in the same request."
    );
  }

  return {
    apiUrl: overrideApiUrl ? normalizeApiUrl(overrideApiUrl) : base.apiUrl,
    apiKey: overrideApiKey || base.apiKey,
    model: normalizeString(override?.model) || base.model,
  };
}

export function requireModelConfig(override?: Partial<ModelConfig>): ModelConfig {
  const config = resolveModelConfig(override);
  if (!config.apiKey) {
    throw new Error(
      "Missing model API key. Set MODEL_API_KEY (or CHAT_API_KEY / VIWO_API_KEY)."
    );
  }
  return config;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n... (truncated ${value.length - maxChars} chars)`;
}

function parseRetryAfterSeconds(headerValue: string | null): number | null {
  if (!headerValue) return null;
  const numeric = Number(headerValue);
  if (Number.isFinite(numeric) && numeric >= 0) {
    return numeric;
  }
  return null;
}

function isRetryableStatus(status: number): boolean {
  if (status === 408 || status === 429) return true;
  return status >= 500 && status <= 599;
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function computeRetryDelayMs(attempt: number, retryAfterSeconds: number | null): number {
  if (retryAfterSeconds !== null) {
    return Math.min(12000, Math.max(200, retryAfterSeconds * 1000));
  }

  const base = 350;
  const exponential = base * 2 ** (attempt - 1);
  const jitter = Math.floor(Math.random() * 180);
  return Math.min(10000, exponential + jitter);
}

function getMaxRequestAttempts(): number {
  const raw = Number(process.env.MODEL_API_MAX_RETRIES ?? DEFAULT_MAX_REQUEST_ATTEMPTS);
  if (!Number.isFinite(raw)) {
    return DEFAULT_MAX_REQUEST_ATTEMPTS;
  }
  return clampNumber(raw, MIN_REQUEST_ATTEMPTS, MAX_REQUEST_ATTEMPTS);
}

function getModelRequestTimeoutMs(): number {
  const raw = Number(
    process.env.MODEL_API_REQUEST_TIMEOUT_MS ?? DEFAULT_MODEL_REQUEST_TIMEOUT_MS
  );
  if (!Number.isFinite(raw)) {
    return DEFAULT_MODEL_REQUEST_TIMEOUT_MS;
  }
  return clampNumber(raw, MIN_MODEL_REQUEST_TIMEOUT_MS, MAX_MODEL_REQUEST_TIMEOUT_MS);
}

function getCompletionBodyTimeoutMs(): number {
  const raw = Number(
    process.env.MODEL_API_COMPLETION_BODY_TIMEOUT_MS ?? DEFAULT_COMPLETION_BODY_TIMEOUT_MS
  );
  if (!Number.isFinite(raw)) {
    return DEFAULT_COMPLETION_BODY_TIMEOUT_MS;
  }
  return clampNumber(raw, MIN_COMPLETION_BODY_TIMEOUT_MS, MAX_COMPLETION_BODY_TIMEOUT_MS);
}

function buildRequestBody(messages: ModelMessage[], options: ModelRequestOptions) {
  const body: Record<string, unknown> = {
    model: options.model,
    messages,
    stream: options.stream ?? false,
  };

  if (options.temperature !== undefined) {
    body.temperature = options.temperature;
  }
  if (options.maxTokens !== undefined) {
    body.max_tokens = options.maxTokens;
  }
  if (options.extraBody) {
    Object.assign(body, options.extraBody);
  }

  return body;
}

export async function requestModel(
  messages: ModelMessage[],
  options: ModelRequestOptions = {}
): Promise<Response> {
  const config = requireModelConfig(options.modelConfig);
  const body = buildRequestBody(messages, {
    ...options,
    model: options.model || config.model,
  });
  const maxAttempts = getMaxRequestAttempts();
  const timeoutMs = getModelRequestTimeoutMs();

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let timeoutId: NodeJS.Timeout | null = null;
    let timedOut = false;
    const controller = new AbortController();
    const onAbort = () => controller.abort();

    if (options.signal) {
      if (options.signal.aborted) {
        throw new DOMException("The operation was aborted", "AbortError");
      }
      options.signal.addEventListener("abort", onAbort, { once: true });
    }

    timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    try {
      const response = await fetch(config.apiUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (response.ok || !isRetryableStatus(response.status) || attempt >= maxAttempts) {
        return response;
      }

      const retryAfterSeconds = parseRetryAfterSeconds(response.headers.get("retry-after"));
      response.body?.cancel().catch(() => undefined);
      await sleep(computeRetryDelayMs(attempt, retryAfterSeconds));
    } catch (err) {
      if (options.signal?.aborted) {
        throw err;
      }

      if (timedOut) {
        if (attempt >= maxAttempts) {
          throw new Error(
            `Model request timeout after ${maxAttempts} attempts (${timeoutMs}ms each)`
          );
        }
        await sleep(computeRetryDelayMs(attempt, null));
        continue;
      }

      if (isAbortError(err) || attempt >= maxAttempts) {
        throw err;
      }

      await sleep(computeRetryDelayMs(attempt, null));
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      if (options.signal) {
        options.signal.removeEventListener("abort", onAbort);
      }
    }
  }

  throw new Error("Model request failed after retries");
}

export async function completeModel(
  messages: ModelMessage[],
  options: ModelRequestOptions = {}
): Promise<{ content: string; raw: CompletionResponse }> {
  const response = await requestModel(messages, { ...options, stream: false });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error");
    if (response.status === 524) {
      throw new Error(
        `Model API timeout (524) after retries. Upstream provider did not respond in time. ${truncateText(
          errorText,
          MAX_ERROR_BODY_CHARS
        )}`
      );
    }
    throw new Error(
      `Model API error ${response.status}: ${truncateText(errorText, MAX_ERROR_BODY_CHARS)}`
    );
  }
  const bodyTimeoutMs = getCompletionBodyTimeoutMs();
  const contentType = (response.headers.get("content-type") || "").toLowerCase();

  if (contentType.includes("text/event-stream")) {
    return readSseCompletion(response, bodyTimeoutMs);
  }

  const raw = (await readJsonWithTimeout(response, bodyTimeoutMs)) as CompletionResponse;
  const content = raw.choices?.[0]?.message?.content;

  if (typeof content === "string" && content.trim().length > 0) {
    return { content, raw };
  }

  if (!contentType.includes("application/json")) {
    return readSseCompletion(response, bodyTimeoutMs);
  }

  throw new Error("Model response did not include text content");
}

async function readJsonWithTimeout(response: Response, timeoutMs: number): Promise<unknown> {
  let timeoutId: NodeJS.Timeout | null = null;
  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        response.body?.cancel().catch(() => undefined);
        reject(
          new Error(
            `Model completion body timeout after ${timeoutMs}ms while waiting for JSON payload`
          )
        );
      }, timeoutMs);
    });
    return (await Promise.race([response.json(), timeoutPromise])) as unknown;
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

function extractStreamChunkContent(chunk: CompletionResponse): {
  deltaContent?: string;
  messageContent?: string;
  finished: boolean;
} {
  const choice = chunk.choices?.[0];
  const deltaContent =
    choice?.delta && typeof choice.delta.content === "string"
      ? choice.delta.content
      : undefined;
  const messageContent =
    choice?.message && typeof choice.message.content === "string"
      ? choice.message.content
      : undefined;
  const finished = Boolean(choice?.finish_reason);
  return {
    deltaContent,
    messageContent,
    finished,
  };
}

async function readSseCompletion(
  response: Response,
  timeoutMs: number
): Promise<{ content: string; raw: CompletionResponse }> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("Model stream response body is unavailable");
  }

  const decoder = new TextDecoder();
  const deadline = Date.now() + timeoutMs;
  let buffer = "";
  let finalMessageContent = "";
  const deltaParts: string[] = [];
  let lastChunk: CompletionResponse | null = null;

  while (Date.now() < deadline) {
    const remainingMs = Math.max(1, deadline - Date.now());
    let timeoutId: NodeJS.Timeout | null = null;
    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(
            new Error(
              `Model completion body timeout after ${timeoutMs}ms while waiting for stream payload`
            )
          );
        }, remainingMs);
      });

      const next = (await Promise.race([reader.read(), timeoutPromise])) as ReadableStreamReadResult<Uint8Array>;
      if (next.done) {
        break;
      }

      buffer += decoder.decode(next.value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line || !line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") {
          const content = finalMessageContent.trim() || deltaParts.join("").trim();
          if (content) {
            await reader.cancel().catch(() => undefined);
            return {
              content,
              raw: lastChunk || { choices: [] },
            };
          }
          continue;
        }

        let parsed: CompletionResponse;
        try {
          parsed = JSON.parse(payload) as CompletionResponse;
        } catch {
          continue;
        }
        lastChunk = parsed;
        const extracted = extractStreamChunkContent(parsed);
        if (typeof extracted.messageContent === "string" && extracted.messageContent.trim()) {
          finalMessageContent = extracted.messageContent;
        }
        if (typeof extracted.deltaContent === "string" && extracted.deltaContent.length > 0) {
          deltaParts.push(extracted.deltaContent);
        }
        if (extracted.finished) {
          const content = finalMessageContent.trim() || deltaParts.join("").trim();
          if (content) {
            await reader.cancel().catch(() => undefined);
            return {
              content,
              raw: parsed,
            };
          }
        }
      }
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }

  await reader.cancel().catch(() => undefined);
  const content = finalMessageContent.trim() || deltaParts.join("").trim();
  if (content) {
    return {
      content,
      raw: lastChunk || { choices: [] },
    };
  }
  throw new Error("Model stream response did not include text content");
}
