function createTimeoutSignal(timeoutMs, parentSignal) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const abortFromParent = () => controller.abort();
  if (parentSignal) {
    if (parentSignal.aborted) controller.abort();
    else parentSignal.addEventListener("abort", abortFromParent, { once: true });
  }
  return { signal: controller.signal, dispose: () => { clearTimeout(timeout); parentSignal?.removeEventListener("abort", abortFromParent); } };
}

function providerError(response, details) {
  const error = new Error(`Ollama returned ${response.status}: ${details}`);
  error.code = response.status === 404
    ? "MODEL_NOT_FOUND"
    : /out[- ]of[- ]memory|failed to allocate/i.test(details)
      ? "OLLAMA_OUT_OF_MEMORY"
      : "OLLAMA_RESPONSE_ERROR";
  return error;
}

function requestBody(config, messages, profile, stream) {
  return { model: profile.model, messages, stream, keep_alive: config.keepAlive, think: config.think, options: { num_ctx: config.numCtx, num_predict: profile.numPredict, temperature: profile.temperature } };
}

function parseChunk(line) {
  if (!line.trim()) return null;
  try { return JSON.parse(line); } catch (error) { console.warn("[ollama] Ignoring malformed NDJSON chunk:", error); return null; }
}

function nanosToMs(value) {
  return typeof value === "number" && Number.isFinite(value) ? value / 1_000_000 : null;
}

function metricsFromCompletion(data, firstTokenMs = null) {
  const metrics = {};
  const fields = [
    ["ollama_total_ms", data?.total_duration],
    ["ollama_load_ms", data?.load_duration],
    ["prompt_eval_ms", data?.prompt_eval_duration],
    ["generation_ms", data?.eval_duration],
  ];
  for (const [name, nanos] of fields) {
    const value = nanosToMs(nanos);
    if (value !== null) metrics[name] = value;
  }
  if (Number.isFinite(data?.prompt_eval_count)) metrics.prompt_eval_count = data.prompt_eval_count;
  if (Number.isFinite(data?.eval_count)) metrics.eval_count = data.eval_count;
  if (Number.isFinite(firstTokenMs)) metrics.first_token_ms = firstTokenMs;
  if (Number.isFinite(data?.eval_count) && Number.isFinite(data?.eval_duration) && data.eval_duration > 0) {
    metrics.tokens_per_second = data.eval_count / (data.eval_duration / 1_000_000_000);
  }
  return metrics;
}

export function createOllamaChatProvider(config, logPerformance = () => {}) {
  async function generate(messages, profile, { signal, operation = "ollama", onMetrics } = {}) {
    const startedAt = performance.now();
    const timeout = createTimeoutSignal(config.timeoutMs, signal);
    let completion = null;
    try {
      const response = await fetch(`${config.ollamaUrl}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(requestBody(config, messages, profile, false)), signal: timeout.signal });
      if (!response.ok) {
        const error = providerError(response, await response.text());
        error.modelName = profile.model;
        throw error;
      }
      const data = await response.json();
      completion = data;
      const content = data?.message?.content?.trim();
      if (!content) throw new Error("Ollama returned an empty response");
      return content;
    } finally {
      timeout.dispose();
      const clientDurationMs = performance.now() - startedAt;
      logPerformance(operation, startedAt);
      onMetrics?.({ clientDurationMs, metrics: metricsFromCompletion(completion) });
    }
  }

  async function stream(messages, profile, { signal, operation = "ollama stream", onDelta, onMetrics } = {}) {
    const startedAt = performance.now();
    const timeout = createTimeoutSignal(config.timeoutMs, signal);
    let reader;
    let completion = null;
    let firstTokenMs = null;
    try {
      const response = await fetch(`${config.ollamaUrl}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(requestBody(config, messages, profile, true)), signal: timeout.signal });
      if (!response.ok) {
        const error = providerError(response, await response.text());
        error.modelName = profile.model;
        throw error;
      }
      if (!response.body) throw new Error("Ollama did not return a streaming body");
      reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffered = "";
      let content = "";
      let doneReceived = false;
      const consume = (line) => {
        const chunk = parseChunk(line);
        if (!chunk) return;
        const delta = typeof chunk.message?.content === "string" ? chunk.message.content : typeof chunk.response === "string" ? chunk.response : "";
        if (delta) {
          content += delta;
          if (firstTokenMs === null) firstTokenMs = performance.now() - startedAt;
          onDelta?.(delta);
        }
        if (chunk.done) { doneReceived = true; completion = chunk; }
      };
      while (!doneReceived) {
        const { value, done } = await reader.read();
        if (done) break;
        buffered += decoder.decode(value, { stream: true });
        const lines = buffered.split(/\r?\n/);
        buffered = lines.pop() || "";
        lines.forEach(consume);
      }
      buffered += decoder.decode();
      if (buffered.trim()) consume(buffered);
      if (!content.trim()) throw new Error("Ollama returned an empty streaming response");
      return content.trim();
    } finally {
      if (reader && timeout.signal.aborted) { try { await reader.cancel(); } catch { /* request is already aborting */ } }
      timeout.dispose();
      const clientDurationMs = performance.now() - startedAt;
      logPerformance(operation, startedAt);
      onMetrics?.({ clientDurationMs, metrics: metricsFromCompletion(completion, firstTokenMs) });
    }
  }

  async function healthCheck() {
    const response = await fetch(`${config.ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(5_000) });
    const data = response.ok ? await response.json() : null;
    const models = Array.isArray(data?.models) ? data.models : [];
    return { ok: response.ok, status: response.status, data, modelAvailable: models.some((item) => item.name === config.chatModel) };
  }

  async function unload(modelName = config.chatModel) {
    const response = await fetch(`${config.ollamaUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: modelName, prompt: "", stream: false, keep_alive: 0 }),
      signal: AbortSignal.timeout(config.timeoutMs),
    });
    if (!response.ok) throw providerError(response, await response.text());
    await response.text();
    return { ok: true, model: modelName };
  }

  return { generate, stream, healthCheck, unload };
}
