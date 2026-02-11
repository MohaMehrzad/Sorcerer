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
  message?: {
    role?: string;
    content?: string;
  };
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
const DEFAULT_MAX_REQUEST_ATTEMPTS = 2;
const MIN_REQUEST_ATTEMPTS = 1;
const MAX_REQUEST_ATTEMPTS = 6;
const DEFAULT_MODEL_REQUEST_TIMEOUT_MS = 20000;
const MIN_MODEL_REQUEST_TIMEOUT_MS = 8000;
const MAX_MODEL_REQUEST_TIMEOUT_MS = 180000;
const MAX_ERROR_BODY_CHARS = 1800;

export function getModelConfig(): ModelConfig {
  return {
    apiUrl:
      process.env.MODEL_API_URL ||
      process.env.CHAT_API_URL ||
      process.env.VIWO_API_URL ||
      DEFAULT_API_URL,
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

  if (apiUrl) parsed.apiUrl = apiUrl;
  if (apiKey) parsed.apiKey = apiKey;
  if (model) parsed.model = model;

  return parsed;
}

export function resolveModelConfig(override?: Partial<ModelConfig>): ModelConfig {
  const base = getModelConfig();
  return {
    apiUrl: normalizeString(override?.apiUrl) || base.apiUrl,
    apiKey: normalizeString(override?.apiKey) || base.apiKey,
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

  const raw = (await response.json()) as CompletionResponse;
  const content = raw.choices?.[0]?.message?.content;

  if (typeof content !== "string" || content.trim().length === 0) {
    throw new Error("Model response did not include text content");
  }

  return { content, raw };
}
