export function createBackgroundScheduler({ idleDelayMs = 350, onError = console.warn, canStart = () => true, maxQueueSize = 100 } = {}) {
  const queue = [];
  let active = false;
  let foregroundActive = 0;
  let foregroundPending = 0;
  let timer = null;
  const pump = () => {
    timer = null;
    if (active || foregroundPending > 0 || foregroundActive > 0 || queue.length === 0 || !canStart()) return;
    active = true;
    const job = queue.shift();
    Promise.resolve().then(job.task).catch((error) => onError(`[ai-background] ${job.label} failed:`, error)).finally(() => { active = false; pump(); });
  };
  const schedule = () => {
    if (!timer && queue.length > 0) timer = setTimeout(pump, idleDelayMs);
  };
  return {
    runForeground(task) {
      foregroundPending += 1;
      return Promise.resolve().then(() => {
        foregroundPending = Math.max(0, foregroundPending - 1);
        foregroundActive += 1;
        return Promise.resolve().then(task).finally(() => { foregroundActive = Math.max(0, foregroundActive - 1); schedule(); });
      });
    },
    enqueue(label, task) {
      if (queue.length >= maxQueueSize) {
        const error = new Error("Background AI queue is full");
        error.code = "AI_BACKGROUND_QUEUE_FULL";
        return Promise.reject(error);
      }
      return new Promise((resolve, reject) => { queue.push({ label, task: () => Promise.resolve().then(task).then(resolve, reject) }); schedule(); });
    },
    wake() {
      if (timer) clearTimeout(timer);
      timer = null;
      schedule();
    },
    getState() { return { queued: queue.length, active, foregroundActive, foregroundPending, idleDelayMs, maxQueueSize }; },
  };
}
