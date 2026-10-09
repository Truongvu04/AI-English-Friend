function createTimeoutSignal(timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return { controller, clear: () => clearTimeout(timer) };
}

function normalizeHealth(data, fallback) {
  return {
    ok: true,
    status: data?.status || "ready",
    modelStatus: data?.modelStatus || "ready",
    modelErrorCode: data?.modelErrorCode,
    modelError: data?.modelError,
    provider: data?.provider || "faster-whisper",
    model: data?.model || fallback.model,
    device: data?.device || fallback.device,
    computeType: data?.computeType || fallback.computeType,
  };
}

function responseError(data, fallbackMessage, fallbackCode, status) {
  const detail = data?.detail;
  const message = typeof detail === "object" ? detail.message : detail;
  const error = new Error(data?.error || message || fallbackMessage);
  error.status = status;
  error.code = data?.code || (typeof detail === "object" ? detail.code : null) || fallbackCode;
  return error;
}

export function createFasterWhisperSttProvider(config, logPerformance = () => {}) {
  const healthUrl = `${config.fasterWhisperUrl}/health`;
  const transcribeUrl = `${config.fasterWhisperUrl}/transcribe`;

  async function healthCheck() {
    const request = createTimeoutSignal(Math.min(config.requestTimeoutMs, 10_000));
    try {
      const response = await fetch(healthUrl, { signal: request.controller.signal });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        return { ok: false, status: response.status || 503, ...data };
      }
      return normalizeHealth(data, {});
    } catch (error) {
      return { ok: false, status: 503, error: error?.name === "AbortError" ? "STT health check timed out" : "STT service unavailable" };
    } finally {
      request.clear();
    }
  }

  async function modelCommand(path, fallbackCode) {
    const request = createTimeoutSignal(Math.min(config.requestTimeoutMs, 30_000));
    try {
      const response = await fetch(`${config.fasterWhisperUrl}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        signal: request.controller.signal,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw responseError(data, "Speech model command failed", fallbackCode, response.status);
      return data;
    } catch (error) {
      if (error?.name === "AbortError") throw Object.assign(new Error("Speech model command timed out"), { status: 504, code: "STT_TIMEOUT" });
      if (error?.code) throw error;
      throw Object.assign(new Error("Speech transcription service is unavailable"), { status: 503, code: "STT_SERVICE_UNAVAILABLE" });
    } finally {
      request.clear();
    }
  }

  async function transcribe(audioBuffer, metadata = {}) {
    if (!Buffer.isBuffer(audioBuffer) || audioBuffer.length === 0) {
      const error = new Error("Audio body is empty");
      error.status = 400;
      error.code = "EMPTY_AUDIO";
      throw error;
    }

    const startedAt = performance.now();
    const request = createTimeoutSignal(config.requestTimeoutMs);
    try {
      const response = await fetch(transcribeUrl, {
        method: "POST",
        headers: {
          "Content-Type": metadata.contentType || "application/octet-stream",
          "Content-Length": String(audioBuffer.length),
          ...(metadata.durationMs ? { "X-Audio-Duration-Ms": String(metadata.durationMs) } : {}),
        },
        body: audioBuffer,
        signal: request.controller.signal,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw responseError(data, "Speech transcription failed", "STT_TRANSCRIPTION_FAILED", response.status);
      if (typeof data.text !== "string") {
        const error = new Error("Speech transcription response was invalid");
        error.status = 502;
        error.code = "STT_INVALID_RESPONSE";
        throw error;
      }
      logPerformance("STT round trip", startedAt);
      return {
        text: data.text.trim().replace(/\s+/g, " "),
        language: data.language || "en",
        duration: Number.isFinite(Number(data.duration)) ? Number(data.duration) : null,
        processingMs: Number.isFinite(Number(data.processingMs)) ? Number(data.processingMs) : null,
      };
    } catch (error) {
      if (error?.name === "AbortError") {
        const timeoutError = new Error("Speech transcription timed out");
        timeoutError.status = 504;
        timeoutError.code = "STT_TIMEOUT";
        throw timeoutError;
      }
      throw error;
    } finally {
      request.clear();
    }
  }

  return {
    healthCheck,
    transcribe,
    load: () => modelCommand("/model/load", "STT_MODEL_LOAD_FAILED"),
    unload: () => modelCommand("/model/unload", "STT_MODEL_UNLOAD_FAILED"),
    getStatus: () => ({ provider: "faster-whisper", url: config.fasterWhisperUrl }),
  };
}
