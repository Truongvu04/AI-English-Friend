function readNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readBoolean(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  return String(value).toLowerCase() === "true";
}

export function createAiConfig(env = process.env) {
  const chatModel = env.OLLAMA_CHAT_MODEL || env.OLLAMA_MODEL || "qwen3:4b";
  const translationModel = env.OLLAMA_TRANSLATION_MODEL || chatModel;
  const keepAlive = env.OLLAMA_KEEP_ALIVE || "10m";
  const think = readBoolean(env.OLLAMA_THINK, false);
  const demoMode = readBoolean(env.AI_DEMO_MODE, false);
  const configuredBackgroundIdleDelayMs = readNumber(env.AI_BACKGROUND_IDLE_DELAY_MS, 350);
  const demoBackgroundIdleDelayMs = readNumber(env.AI_DEMO_BACKGROUND_IDLE_DELAY_MS, 5_000);

  return {
    ollamaUrl: (env.OLLAMA_URL || "http://localhost:11434").replace(/\/$/, ""),
    chatModel,
    translationModel,
    keepAlive,
    think,
    streaming: readBoolean(env.AI_STREAMING, true),
    numCtx: readNumber(env.OLLAMA_NUM_CTX, 2048),
    timeoutMs: readNumber(env.OLLAMA_TIMEOUT_MS, 60_000),
    demoMode,
    configuredBackgroundIdleDelayMs,
    demoBackgroundIdleDelayMs,
    backgroundIdleDelayMs: demoMode ? demoBackgroundIdleDelayMs : configuredBackgroundIdleDelayMs,
    resourceMode: env.AI_RESOURCE_MODE || "auto",
    lowMemoryRamThresholdGb: readNumber(env.AI_LOW_MEMORY_RAM_THRESHOLD_GB, 8),
    profiles: {
      chat: { model: chatModel, temperature: readNumber(env.OLLAMA_CHAT_TEMPERATURE, 0.78), numPredict: readNumber(env.OLLAMA_CHAT_NUM_PREDICT, 240) },
      translation: { model: translationModel, temperature: readNumber(env.OLLAMA_TRANSLATION_TEMPERATURE, 0.1), numPredict: readNumber(env.OLLAMA_TRANSLATION_NUM_PREDICT, 256) },
      title: { model: chatModel, temperature: 0.2, numPredict: 80 },
      memory: { model: chatModel, temperature: 0.1, numPredict: 180 },
      summary: { model: chatModel, temperature: 0.25, numPredict: 220 },
      reentry: { model: chatModel, temperature: 0.68, numPredict: 180 },
    },
  };
}
