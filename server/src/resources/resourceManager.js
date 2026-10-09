import os from "node:os";
import { randomUUID } from "node:crypto";

const RESOURCE_MODES = new Set(["auto", "low-memory", "standard"]);

function gb(bytes) {
  return bytes / (1024 ** 3);
}

function resourceError(code, message, status = 503) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function describeHealth(health) {
  return health?.modelStatus || (health?.ok ? "ready" : "unavailable");
}

function shortLeaseId(leaseId) {
  return leaseId ? `${leaseId.slice(0, 4)}...${leaseId.slice(-4)}` : "none";
}

export function createResourceManager({ aiConfig, sttConfig, ttsConfig, chatProvider, sttProvider, ttsProvider, backgroundScheduler, recordPerformance = () => {} }) {
  const totalRamGb = gb(os.totalmem());
  const requestedMode = String(aiConfig.resourceMode || "auto").toLowerCase();
  if (!RESOURCE_MODES.has(requestedMode)) {
    throw new Error("AI_RESOURCE_MODE must be auto, low-memory, or standard");
  }
  const mode = requestedMode === "auto"
    ? totalRamGb < aiConfig.lowMemoryRamThresholdGb ? "low-memory" : "standard"
    : requestedMode;
  const lowMemory = mode === "low-memory";
  const idleUnloadMs = sttConfig.idleUnloadMs;
  const ttsIdleUnloadMs = ttsConfig?.idleUnloadMs || 15_000;
  let transitionTail = Promise.resolve();
  let sttIdleTimer = null;
  let ttsIdleTimer = null;
  let sttActive = false;
  let sttPreparing = false;
  let ttsActive = false;
  let ttsPreparing = false;
  let sttReuseUntil = 0;
  let ttsReuseUntil = 0;
  let activeAiRequests = 0;
  let lastSttModelStatus = "unloaded";
  let lastTtsModelStatus = "unloaded";
  let lastTransition = "idle";
  let currentSttLease = null;
  let sttLeaseTimer = null;
  let sttPrepareCancelRequested = false;

  function recordTimed(operation, startedAt, success, metrics = {}) {
    recordPerformance(operation, {
      durationMs: performance.now() - startedAt,
      success,
      metrics,
    });
  }

  console.log(`[resource] mode=${mode} totalRam=${totalRamGb.toFixed(2)}GB`);

  function wakeBackground() {
    backgroundScheduler?.wake?.();
  }

  function serialize(label, task) {
    const run = transitionTail.then(async () => {
      lastTransition = label;
      try {
        return await task();
      } finally {
        lastTransition = "idle";
      }
    }, async () => task());
    transitionTail = run.catch(() => undefined);
    return run;
  }

  async function getSttHealth() {
    const health = await sttProvider.healthCheck();
    if (!health.ok) throw resourceError("STT_SERVICE_UNAVAILABLE", "Speech transcription service is unavailable");
    lastSttModelStatus = describeHealth(health);
    return health;
  }

  async function getTtsHealth() {
    if (!ttsProvider) return { ok: false, modelStatus: "unavailable", error: "TTS provider is not configured" };
    const health = await ttsProvider.healthCheck();
    lastTtsModelStatus = describeHealth(health);
    return health;
  }

  function clearLeaseTimer() {
    if (sttLeaseTimer) clearTimeout(sttLeaseTimer);
    sttLeaseTimer = null;
  }

  function touchSttLease(leaseId) {
    if (!currentSttLease || currentSttLease.leaseId !== leaseId) return false;
    currentSttLease.lastTouchedAt = Date.now();
    clearLeaseTimer();
    sttLeaseTimer = setTimeout(() => {
      void expireSttLease(leaseId);
    }, sttConfig.leaseTimeoutMs);
    return true;
  }

  function createSttLease() {
    clearLeaseTimer();
    const now = Date.now();
    const lease = {
      leaseId: randomUUID(),
      createdAt: now,
      lastTouchedAt: now,
      phase: "ready",
      releaseRequested: false,
      transcriptionInFlight: false,
    };
    currentSttLease = lease;
    touchSttLease(lease.leaseId);
    console.log(`[resource] STT lease created: ${shortLeaseId(lease.leaseId)}`);
    return lease;
  }

  function validateLease(leaseId) {
    if (!leaseId || !currentSttLease || currentSttLease.leaseId !== leaseId) {
      throw resourceError("STT_LEASE_INVALID", "Speech transcription lease is invalid", 409);
    }
    return currentSttLease;
  }

  function clearSttLease(lease, reason) {
    if (!currentSttLease || currentSttLease.leaseId !== lease.leaseId) return false;
    clearLeaseTimer();
    currentSttLease = null;
    sttActive = false;
    console.log(`[resource] STT lease released: ${reason}`);
    scheduleSttIdleUnload();
    wakeBackground();
    return true;
  }

  function clearIdleTimer() {
    if (sttIdleTimer) clearTimeout(sttIdleTimer);
    sttIdleTimer = null;
  }

  function clearTtsIdleTimer() {
    if (ttsIdleTimer) clearTimeout(ttsIdleTimer);
    ttsIdleTimer = null;
  }

  async function unloadWhisper() {
    const startedAt = performance.now();
    let success = false;
    try {
      const health = await getSttHealth();
      if (health.modelStatus === "unloaded") {
        lastSttModelStatus = "unloaded";
        success = true;
        return;
      }
      console.log("[resource] unloading Whisper");
      await sttProvider.unload();
      const after = await getSttHealth();
      lastSttModelStatus = after.modelStatus || "unloaded";
      console.log("[resource] Whisper unloaded");
      success = true;
    } finally {
      recordTimed("stt_unload", startedAt, success);
    }
  }

  async function unloadOllama() {
    if (!lowMemory || typeof chatProvider.unload !== "function") return;
    const startedAt = performance.now();
    let success = false;
    try {
      console.log(`[resource] unloading Ollama model ${aiConfig.chatModel}`);
      try {
        await chatProvider.unload(aiConfig.chatModel);
        success = true;
      } catch (error) {
        console.warn("[resource] Ollama unload warning:", error?.message || error);
      }
    } finally {
      recordTimed("ollama_unload", startedAt, success);
    }
  }

  async function unloadKokoro() {
    if (!ttsProvider || typeof ttsProvider.unload !== "function") return;
    const startedAt = performance.now();
    let success = false;
    try {
    let health;
    try {
      health = await getTtsHealth();
    } catch (error) {
      lastTtsModelStatus = "unavailable";
      console.warn("[resource] Kokoro health warning:", error?.message || error);
      return;
    }
    if (!health.ok || health.modelStatus === "unloaded" || health.modelStatus === "unavailable") return;
    console.log("[resource] unloading Kokoro");
    try {
      await ttsProvider.unload();
      lastTtsModelStatus = "unloaded";
      console.log("[resource] Kokoro unloaded");
      success = true;
    } catch (error) {
      console.warn("[resource] Kokoro unload warning:", error?.message || error);
    }
    } finally {
      recordTimed("tts_unload", startedAt, success);
    }
  }

  function scheduleSttIdleUnload() {
    if (!lowMemory) return;
    clearIdleTimer();
    sttReuseUntil = Date.now() + idleUnloadMs;
    console.log(`[resource] STT idle unload scheduled: ${idleUnloadMs}ms`);
    sttIdleTimer = setTimeout(() => {
      sttIdleTimer = null;
      void serialize("idle STT unload", async () => {
        if (sttActive || sttPreparing) return;
        let unloaded = false;
        try {
          await unloadWhisper();
          unloaded = true;
        } catch (error) {
          console.warn("[resource] Whisper idle unload warning:", error?.message || error);
        } finally {
          if (unloaded) {
            sttReuseUntil = 0;
            lastSttModelStatus = "unloaded";
            wakeBackground();
          } else {
            scheduleSttIdleUnload();
          }
        }
      });
    }, idleUnloadMs);
  }

  function scheduleTtsIdleUnload() {
    if (!lowMemory || !ttsProvider) return;
    clearTtsIdleTimer();
    ttsReuseUntil = Date.now() + ttsIdleUnloadMs;
    console.log(`[resource] Kokoro idle unload scheduled: ${ttsIdleUnloadMs}ms`);
    ttsIdleTimer = setTimeout(() => {
      ttsIdleTimer = null;
      void serialize("idle Kokoro unload", async () => {
        if (ttsActive || ttsPreparing) return;
        try {
          await unloadKokoro();
          ttsReuseUntil = 0;
          wakeBackground();
        } catch (error) {
          console.warn("[resource] Kokoro idle unload warning:", error?.message || error);
          scheduleTtsIdleUnload();
        }
      });
    }, ttsIdleUnloadMs);
  }

  async function prepareForStt() {
    if (currentSttLease || sttPreparing) throw resourceError("STT_BUSY", "Speech transcription is still active", 409);
    sttPreparing = true;
    sttPrepareCancelRequested = false;
    clearIdleTimer();
    sttReuseUntil = 0;
    clearTtsIdleTimer();
    ttsReuseUntil = 0;
    wakeBackground();
    const startedAt = performance.now();
    const transition = serialize("prepare STT", async () => {
        console.log("[resource] preparing STT");
      try {
        await unloadKokoro();
        await unloadOllama();
        let health = await getSttHealth();
        if (health.modelStatus !== "ready") {
          if (typeof sttProvider.load !== "function") throw resourceError("STT_MODEL_LOAD_FAILED", "Speech model loading is unavailable");
          if (health.modelStatus === "error") console.log("[resource] retrying Whisper load from error state");
          console.log(`[resource] loading Whisper ${health.model || "model"}`);
          const loadStartedAt = performance.now();
          let loadSucceeded = false;
          try {
            await sttProvider.load();
            loadSucceeded = true;
          } catch (error) {
            console.warn("[resource] Whisper load retry failed:", error?.code || error?.message || error);
            throw resourceError(error?.code || "STT_MODEL_LOAD_FAILED", "Speech model could not be loaded");
          } finally {
            recordTimed("stt_model_load", loadStartedAt, loadSucceeded);
          }
          health = await getSttHealth();
        }
        if (sttPrepareCancelRequested) {
          sttPrepareCancelRequested = false;
          sttActive = false;
          scheduleSttIdleUnload();
          throw resourceError("STT_PREPARE_CANCELLED", "Speech preparation was cancelled", 409);
        }
        if (health.modelStatus !== "ready") throw resourceError("STT_MODEL_NOT_READY", "Speech model is not ready");
        lastSttModelStatus = "ready";
        sttActive = true;
        console.log("[resource] Whisper ready");
        const lease = createSttLease();
        return { ...health, leaseId: lease.leaseId };
      } finally {
        sttPreparing = false;
        wakeBackground();
      }
    });
    return transition.then((result) => {
      recordTimed("stt_prepare", startedAt, true);
      return result;
    }, (error) => {
      recordTimed("stt_prepare", startedAt, false, { error: error?.code || "error" });
      throw error;
    });
  }

  async function afterTranscription() {
    return serialize("after transcription", async () => {
      sttActive = false;
      scheduleSttIdleUnload();
      wakeBackground();
    });
  }

  function cancelSttPreparation() {
    if (!sttPreparing) return false;
    sttPrepareCancelRequested = true;
    return true;
  }

  function beginSttTranscription(leaseId) {
    const lease = validateLease(leaseId);
    if (lease.releaseRequested) throw resourceError("STT_LEASE_INVALID", "Speech transcription lease is being released", 409);
    lease.phase = "transcribing";
    lease.transcriptionInFlight = true;
    touchSttLease(leaseId);
    return true;
  }

  async function completeSttTranscription(leaseId) {
    const lease = currentSttLease?.leaseId === leaseId ? currentSttLease : null;
    if (!lease) return { released: true, alreadyReleased: true };
    lease.transcriptionInFlight = false;
    lease.phase = "ready";
    clearSttLease(lease, lease.releaseRequested ? "transcription-complete" : "transcription-complete");
    return { released: true };
  }

  async function releaseSttLease(leaseId, reason = "other") {
    if (!leaseId) return { released: true, alreadyReleased: true };
    const lease = currentSttLease;
    if (!lease || lease.leaseId !== leaseId) {
      return { released: true, alreadyReleased: true, stale: Boolean(lease) };
    }
    if (lease.transcriptionInFlight) {
      lease.releaseRequested = true;
      touchSttLease(leaseId);
      console.log("[resource] STT lease release pending: transcription in flight");
      return { released: false, pending: true };
    }
    clearSttLease(lease, reason);
    return { released: true };
  }

  async function expireSttLease(leaseId) {
    const lease = currentSttLease;
    if (!lease || lease.leaseId !== leaseId) return { released: true, alreadyReleased: true };
    console.log(`[resource] STT lease expired: ${shortLeaseId(leaseId)}`);
    if (lease.transcriptionInFlight) {
      lease.releaseRequested = true;
      return { released: false, pending: true };
    }
    clearSttLease(lease, "timeout");
    return { released: true, expired: true };
  }

  async function prepareForAiInternal() {
    if (sttActive || sttPreparing) throw resourceError("STT_BUSY", "Speech transcription is still active", 409);
    if (ttsActive || ttsPreparing) throw resourceError("TTS_BUSY", "Speech synthesis is still active", 409);
    clearIdleTimer();
    sttReuseUntil = 0;
    clearTtsIdleTimer();
    ttsReuseUntil = 0;
    console.log("[resource] preparing AI");
    if (lowMemory && lastSttModelStatus !== "unloaded") {
      await unloadWhisper();
    }
    if (lowMemory && lastTtsModelStatus !== "unloaded") {
      await unloadKokoro();
    }
    console.log("[resource] Qwen request allowed");
  }

  async function prepareForAi() {
    return serialize("prepare AI", prepareForAiInternal);
  }

  async function prepareForTtsInternal() {
    if (sttActive || sttPreparing) throw resourceError("STT_BUSY", "Speech transcription is still active", 409);
    if (!ttsProvider) throw resourceError("TTS_SERVICE_UNAVAILABLE", "TTS provider is not configured");
    ttsPreparing = true;
    try {
      clearIdleTimer();
      sttReuseUntil = 0;
      clearTtsIdleTimer();
      ttsReuseUntil = 0;
      console.log("[resource] preparing TTS");
      if (lowMemory && lastSttModelStatus !== "unloaded") await unloadWhisper();
      if (lowMemory) await unloadOllama();
      let health = await getTtsHealth();
      if (!health.ok) throw resourceError(health.errorCode || "TTS_SERVICE_UNAVAILABLE", "Kokoro TTS service is unavailable");
      if (health.modelStatus !== "ready") {
        if (typeof ttsProvider.load !== "function") throw resourceError("TTS_MODEL_LOAD_FAILED", "TTS model loading is unavailable");
        console.log(`[resource] loading Kokoro ${health.model || "model"}`);
        const loadStartedAt = performance.now();
        let loadSucceeded = false;
        try {
          health = await ttsProvider.load();
          loadSucceeded = true;
        } catch (error) {
          throw resourceError(error?.code || "TTS_MODEL_LOAD_FAILED", "Kokoro model could not be loaded");
        } finally {
          recordTimed("tts_model_load", loadStartedAt, loadSucceeded);
        }
      }
      if (health.modelStatus && health.modelStatus !== "ready") throw resourceError("TTS_MODEL_NOT_READY", "Kokoro model is not ready");
      lastTtsModelStatus = "ready";
      console.log("[resource] Kokoro ready");
      return health;
    } finally {
      ttsPreparing = false;
    }
  }

  async function prepareForTts() {
    const startedAt = performance.now();
    return serialize("prepare TTS", prepareForTtsInternal).then((result) => {
      recordTimed("tts_prepare", startedAt, true);
      return result;
    }, (error) => {
      recordTimed("tts_prepare", startedAt, false, { error: error?.code || "error" });
      throw error;
    });
  }

  async function runTts(task, { signal, onMetrics } = {}) {
    return serialize("foreground TTS", async () => {
      const prepareStartedAt = performance.now();
      let prepareSucceeded = false;
      try {
        if (signal?.aborted) throw resourceError("TTS_REQUEST_ABORTED", "Speech synthesis request was cancelled", 499);
        await prepareForTtsInternal();
        prepareSucceeded = true;
        onMetrics?.({ prepare_tts_ms: performance.now() - prepareStartedAt });
        if (signal?.aborted) throw resourceError("TTS_REQUEST_ABORTED", "Speech synthesis request was cancelled", 499);
        ttsActive = true;
        return await task({ signal });
      } finally {
        recordTimed("tts_prepare", prepareStartedAt, prepareSucceeded);
        ttsActive = false;
        if (lastTtsModelStatus === "ready" || lastTtsModelStatus === "synthesizing") scheduleTtsIdleUnload();
        wakeBackground();
      }
    });
  }

  function canRunBackgroundAi() {
    return !sttActive && !sttPreparing && !ttsActive && !ttsPreparing && Date.now() >= sttReuseUntil && Date.now() >= ttsReuseUntil && activeAiRequests === 0;
  }

  async function runAi(task, { background = false, onMetrics } = {}) {
    if (background && !canRunBackgroundAi()) {
      throw resourceError("AI_BACKGROUND_DEFERRED", "Background AI is waiting for voice resources", 409);
    }
    return serialize(background ? "background AI" : "foreground AI", async () => {
      if (background && !canRunBackgroundAi()) throw resourceError("AI_BACKGROUND_DEFERRED", "Background AI is waiting for voice resources", 409);
      const prepareStartedAt = performance.now();
      let prepareSucceeded = false;
      try {
        await prepareForAiInternal();
        prepareSucceeded = true;
      } finally {
        const prepareAiMs = performance.now() - prepareStartedAt;
        onMetrics?.({ prepare_ai_ms: prepareAiMs });
        recordPerformance("ai_prepare", { durationMs: prepareAiMs, success: prepareSucceeded, metrics: { background } });
      }
      activeAiRequests += 1;
      try {
        return await task();
      } finally {
        activeAiRequests = Math.max(0, activeAiRequests - 1);
        wakeBackground();
      }
    });
  }

  function getStatus() {
    const leaseAgeMs = currentSttLease ? Math.max(0, Date.now() - currentSttLease.createdAt) : 0;
    return {
      mode,
      requestedMode,
      demoMode: Boolean(aiConfig.demoMode),
      backgroundIdleDelayMs: aiConfig.backgroundIdleDelayMs,
      totalRamGb: Number(totalRamGb.toFixed(2)),
      lowMemoryThresholdGb: aiConfig.lowMemoryRamThresholdGb,
      sttModelStatus: lastSttModelStatus,
      sttActive,
      sttPreparing,
      sttReuseUntil,
      ttsModelStatus: lastTtsModelStatus,
      ttsActive,
      ttsPreparing,
      ttsReuseUntil,
      activeLease: Boolean(currentSttLease),
      leaseAgeMs,
      leasePhase: currentSttLease?.phase || null,
      leaseReleaseRequested: Boolean(currentSttLease?.releaseRequested),
      transcriptionInFlight: Boolean(currentSttLease?.transcriptionInFlight),
      activeAiRequests,
      backgroundAllowed: canRunBackgroundAi(),
      backgroundQueue: backgroundScheduler?.getState?.() || null,
      transition: lastTransition,
      idleUnloadMs,
    };
  }

  return {
    mode,
    prepareForStt,
    afterTranscription,
    cancelSttPreparation,
    beginSttTranscription,
    completeSttTranscription,
    releaseSttLease,
    touchSttLease,
    expireSttLease,
    prepareForAi,
    prepareForTts,
    runTts,
    runAi,
    canRunBackgroundAi,
    scheduleSttIdleUnload,
    cancelSttIdleUnload: clearIdleTimer,
    cancelTtsIdleUnload: clearTtsIdleTimer,
    getStatus,
  };
}
