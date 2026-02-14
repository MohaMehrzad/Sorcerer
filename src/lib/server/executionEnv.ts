const ALLOWED_ENV_KEYS = [
  "PATH",
  "HOME",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TMPDIR",
  "TMP",
  "TEMP",
  "SYSTEMROOT",
  "WINDIR",
  "PATHEXT",
  "ComSpec",
  "TERM",
  "SHELL",
  "TZ",
] as const;

interface BuildExecutionEnvOptions {
  nodeEnv?: "production" | "test";
  additional?: Record<string, string>;
}

export function buildRestrictedExecutionEnv(
  options: BuildExecutionEnvOptions = {},
  source: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: options.nodeEnv || "production",
    CI: "1",
    FORCE_COLOR: "0",
  };

  for (const key of ALLOWED_ENV_KEYS) {
    const value = source[key];
    if (typeof value === "string" && value.length > 0) {
      env[key] = value;
    }
  }

  if (options.additional) {
    for (const [key, value] of Object.entries(options.additional)) {
      if (typeof key === "string" && key.length > 0 && typeof value === "string") {
        env[key] = value;
      }
    }
  }

  return env;
}
