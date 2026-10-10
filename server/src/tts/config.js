import { basename } from "node:path";

function readPositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
function readBoolean(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  return String(value).toLowerCase() === "true";
}
export function createTtsConfig(env = process.env) {
  const modelPath = env.KOKORO_MODEL_PATH || "models/kokoro-v1.0.int8.onnx";
  const voicesPath = env.KOKORO_VOICES_PATH || "models/voices-v1.0.bin";
  return {
    provider: env.TTS_PROVIDER || "kokoro",
    modelPath,
    voicesPath,
    model: basename(modelPath),
    voices: basename(voicesPath),
    kokoroUrl: (env.KOKORO_TTS_URL || "http://127.0.0.1:8766").replace(/\/$/, ""),
    browserFallback: readBoolean(env.TTS_BROWSER_FALLBACK, true),
    requestTimeoutMs: readPositiveInteger(env.TTS_REQUEST_TIMEOUT_MS, 120_000),
    maxTextChars: readPositiveInteger(env.TTS_MAX_TEXT_CHARS, 4_000),
    idleUnloadMs: readPositiveInteger(env.TTS_IDLE_UNLOAD_MS, 15_000),
    language: env.KOKORO_LANGUAGE || "en-us",
  };
}
