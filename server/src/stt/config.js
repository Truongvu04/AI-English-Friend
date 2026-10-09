function readPositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function readBoolean(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  return String(value).toLowerCase() === "true";
}

export function createSttConfig(env = process.env) {
  return {
    provider: env.STT_PROVIDER || "faster-whisper",
    fasterWhisperUrl: (env.FASTER_WHISPER_URL || "http://127.0.0.1:8765").replace(/\/$/, ""),
    browserFallback: readBoolean(env.STT_BROWSER_FALLBACK, true),
    maxAudioBytes: readPositiveInteger(env.STT_MAX_AUDIO_BYTES, 20 * 1024 * 1024),
    maxRecordingMs: readPositiveInteger(env.STT_MAX_RECORDING_MS, 120_000),
    requestTimeoutMs: readPositiveInteger(env.STT_REQUEST_TIMEOUT_MS, 120_000),
    idleUnloadMs: readPositiveInteger(env.STT_IDLE_UNLOAD_MS, 20_000),
    leaseTimeoutMs: readPositiveInteger(env.STT_LEASE_TIMEOUT_MS, 180_000),
  };
}
