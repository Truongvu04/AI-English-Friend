function readPositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function readBoolean(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  return String(value).toLowerCase() === "true";
}

export function createTtsConfig(env = process.env) {
  return {
    provider: env.TTS_PROVIDER || "kokoro",
    kokoroUrl: (env.KOKORO_TTS_URL || "http://127.0.0.1:8766").replace(/\/$/, ""),
    browserFallback: readBoolean(env.TTS_BROWSER_FALLBACK, true),
    requestTimeoutMs: readPositiveInteger(env.TTS_REQUEST_TIMEOUT_MS, 120_000),
    maxTextChars: readPositiveInteger(env.TTS_MAX_TEXT_CHARS, 4_000),
    idleUnloadMs: readPositiveInteger(env.TTS_IDLE_UNLOAD_MS, 15_000),
    language: env.KOKORO_LANGUAGE || "en-us",
  };
}
