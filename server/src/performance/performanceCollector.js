const DEFAULT_LIMIT = 100;

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function sanitizeMetrics(metrics = {}) {
  const safe = {};
  for (const [key, value] of Object.entries(metrics || {})) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(key)) continue;
    const number = finiteNumber(value);
    if (number !== null) safe[key] = round(number);
    else if (typeof value === "boolean" || typeof value === "string") safe[key] = value;
  }
  return safe;
}

function summarize(samples) {
  if (samples.length === 0) {
    return { count: 0, successCount: 0, failureCount: 0, last: null, averageMs: null, medianMs: null, minMs: null, maxMs: null };
  }
  const durations = samples.map((sample) => sample.durationMs).sort((left, right) => left - right);
  const middle = Math.floor(durations.length / 2);
  const median = durations.length % 2 === 0 ? (durations[middle - 1] + durations[middle]) / 2 : durations[middle];
  return {
    count: samples.length,
    successCount: samples.filter((sample) => sample.success).length,
    failureCount: samples.filter((sample) => !sample.success).length,
    last: samples[samples.length - 1],
    averageMs: round(durations.reduce((total, value) => total + value, 0) / durations.length),
    medianMs: round(median),
    minMs: durations[0],
    maxMs: durations[durations.length - 1],
  };
}

export function createPerformanceCollector({ limit = DEFAULT_LIMIT } = {}) {
  const samples = [];
  const maxSamples = Math.max(10, Math.min(500, Number(limit) || DEFAULT_LIMIT));

  function record(operation, { durationMs, success = true, metrics = {} } = {}) {
    const duration = finiteNumber(durationMs);
    if (!operation || duration === null) return null;
    const sample = {
      timestamp: new Date().toISOString(),
      operation: String(operation),
      durationMs: round(Math.max(0, duration)),
      success: Boolean(success),
      metrics: sanitizeMetrics(metrics),
    };
    samples.push(sample);
    if (samples.length > maxSamples) samples.splice(0, samples.length - maxSamples);
    return sample;
  }

  function start(operation, metrics = {}) {
    const startedAt = performance.now();
    let ended = false;
    return {
      end({ success = true, metrics: finalMetrics = {} } = {}) {
        if (ended) return null;
        ended = true;
        return record(operation, {
          durationMs: performance.now() - startedAt,
          success,
          metrics: { ...metrics, ...finalMetrics },
        });
      },
    };
  }

  function snapshot() {
    const byOperation = {};
    for (const sample of samples) {
      if (!byOperation[sample.operation]) byOperation[sample.operation] = [];
      byOperation[sample.operation].push(sample);
    }
    return {
      limit: maxSamples,
      sampleCount: samples.length,
      operations: Object.fromEntries(Object.entries(byOperation).map(([operation, operationSamples]) => [operation, summarize(operationSamples)])),
      recent: samples.slice(-maxSamples),
    };
  }

  return { record, start, snapshot };
}
