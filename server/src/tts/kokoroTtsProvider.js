function createTimeoutSignal(timeoutMs, parentSignal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const abortParent = () => controller.abort();
  if (parentSignal) {
    if (parentSignal.aborted) controller.abort();
    else parentSignal.addEventListener("abort", abortParent, { once: true });
  }
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
      parentSignal?.removeEventListener("abort", abortParent);
    },
  };
}

async function readError(response, fallbackCode, fallbackMessage) {
  const data = await response.json().catch(() => ({}));
  const detail = data?.detail;
  const message = typeof detail === "object" ? detail?.error : detail;
  const error = new Error(data?.error || message || fallbackMessage);
  error.status = response.status;
  error.code = typeof detail === "object" ? detail?.code || fallbackCode : data?.code || fallbackCode;
  return error;
}

function normalizeHealth(data, config) {
  return {
    ok: true,
    status: data?.status || "ready",
    serviceStatus: data?.serviceStatus || "ready",
    modelStatus: data?.modelStatus || "unloaded",
    provider: data?.provider || "kokoro",
    model: data?.model,
    precision: data?.precision || "int8",
    language: data?.language || config.language,
    errorCode: data?.errorCode || null,
    error: data?.error || null,
  };
}

export function createKokoroTtsProvider(config, logPerformance = () => {}) {
  async function request(path, options = {}, fallbackCode = "TTS_SERVICE_UNAVAILABLE") {
    const timeout = createTimeoutSignal(config.requestTimeoutMs, options.signal);
    try {
      const response = await fetch(`${config.kokoroUrl}${path}`, { ...options, signal: timeout.signal });
      if (!response.ok) throw await readError(response, fallbackCode, "Kokoro TTS request failed");
      return response;
    } catch (error) {
      if (error?.name === "AbortError") {
        if (options.signal?.aborted) {
          const cancellationError = new Error("Kokoro TTS request was cancelled");
          cancellationError.code = "TTS_REQUEST_ABORTED";
          cancellationError.status = 499;
          throw cancellationError;
        }
        const timeoutError = new Error("Kokoro TTS request timed out");
        timeoutError.code = "TTS_TIMEOUT";
        timeoutError.status = 504;
        throw timeoutError;
      }
      if (error?.code) throw error;
      const serviceError = new Error("Kokoro TTS service is unavailable");
      serviceError.code = "TTS_SERVICE_UNAVAILABLE";
      serviceError.status = 503;
      throw serviceError;
    } finally {
      timeout.dispose();
    }
  }

  async function healthCheck() {
    try {
      const response = await request("/health", {}, "TTS_SERVICE_UNAVAILABLE");
      return normalizeHealth(await response.json(), config);
    } catch (error) {
      return { ok: false, status: 503, serviceStatus: "unavailable", modelStatus: "unavailable", provider: "kokoro", error: error.message, errorCode: error.code };
    }
  }

  async function load() {
    const response = await request("/model/load", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }, "TTS_MODEL_LOAD_FAILED");
    return response.json();
  }

  async function unload() {
    const response = await request("/model/unload", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }, "TTS_MODEL_UNLOAD_FAILED");
    return response.json();
  }

  async function getVoices() {
    const response = await request("/voices", {}, "TTS_SERVICE_UNAVAILABLE");
    return response.json();
  }

  async function synthesize({ text, voice, speed, language }, { signal, operation = "tts synthesize" } = {}) {
    const startedAt = performance.now();
    try {
      if (!text?.trim()) {
        const error = new Error("Text is required");
        error.code = "TTS_INVALID_TEXT";
        error.status = 400;
        throw error;
      }
      if (text.length > config.maxTextChars) {
        const error = new Error("Text is too long");
        error.code = "TTS_INVALID_TEXT";
        error.status = 400;
        throw error;
      }
      const response = await request("/synthesize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, voice, speed, language: language || config.language }),
        signal,
      }, "TTS_SYNTHESIS_FAILED");
      if (signal?.aborted) {
        const cancellationError = new Error("Kokoro TTS request was cancelled");
        cancellationError.code = "TTS_REQUEST_ABORTED";
        cancellationError.status = 499;
        throw cancellationError;
      }
      const audio = Buffer.from(await response.arrayBuffer());
      if (signal?.aborted) {
        const cancellationError = new Error("Kokoro TTS request was cancelled");
        cancellationError.code = "TTS_REQUEST_ABORTED";
        cancellationError.status = 499;
        throw cancellationError;
      }
      if (audio.length === 0) {
        const error = new Error("Kokoro returned empty audio");
        error.code = "TTS_SYNTHESIS_FAILED";
        error.status = 502;
        throw error;
      }
      return {
        audio,
        contentType: response.headers.get("content-type") || "audio/wav",
        duration: Number(response.headers.get("x-tts-duration-ms") || 0) || null,
        processingMs: Number(response.headers.get("x-tts-processing-ms") || 0) || null,
        voice: response.headers.get("x-tts-voice") || voice,
        sampleRate: Number(response.headers.get("x-tts-sample-rate") || 0) || null,
      };
    } finally {
      logPerformance(operation, startedAt);
    }
  }

  return { healthCheck, load, unload, getVoices, synthesize };
}
