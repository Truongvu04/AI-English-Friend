import { useCallback, useEffect, useRef, useState } from "react";

export type VoiceRecording = {
  blob: Blob;
  durationMs: number;
  mimeType: string;
};

type RecorderOptions = {
  maxDurationMs?: number;
  onMaxDuration?: () => void;
};

function chooseMimeType() {
  if (typeof MediaRecorder === "undefined") return "";
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];
  return candidates.find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) || "";
}

export function useVoiceRecorder({ maxDurationMs = 120_000, onMaxDuration }: RecorderOptions = {}) {
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const stopResolveRef = useRef<((recording: VoiceRecording | null) => void) | null>(null);
  const stopRejectRef = useRef<((error: unknown) => void) | null>(null);
  const maxTimerRef = useRef<number | null>(null);
  const cancelRequestedRef = useRef(false);
  const onMaxDurationRef = useRef(onMaxDuration);

  useEffect(() => {
    onMaxDurationRef.current = onMaxDuration;
  }, [onMaxDuration]);

  const clearMaxTimer = useCallback(() => {
    if (maxTimerRef.current !== null) {
      window.clearTimeout(maxTimerRef.current);
      maxTimerRef.current = null;
    }
  }, []);

  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const settleStop = useCallback((recording: VoiceRecording | null, error?: unknown) => {
    const resolve = stopResolveRef.current;
    const reject = stopRejectRef.current;
    stopResolveRef.current = null;
    stopRejectRef.current = null;
    clearMaxTimer();
    releaseStream();
    setIsRecording(false);
    if (error) reject?.(error);
    else resolve?.(recording);
  }, [clearMaxTimer, releaseStream]);

  const startRecording = useCallback(async () => {
    if (isRecording) return;
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      throw new Error("MediaRecorder is not supported in this browser.");
    }

    setError(null);
    cancelRequestedRef.current = false;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (cancelRequestedRef.current) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    const mimeType = chooseMimeType();
    const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    chunksRef.current = [];
    streamRef.current = stream;
    recorderRef.current = recorder;
    startedAtRef.current = performance.now();
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.onerror = () => {
      const recorderError = new Error("Recording failed.");
      setError(recorderError.message);
      settleStop(null, recorderError);
    };
    recorder.onstop = () => {
      const type = recorder.mimeType || mimeType || "audio/webm";
      settleStop({
        blob: new Blob(chunksRef.current, { type }),
        durationMs: Math.max(0, Math.round(performance.now() - startedAtRef.current)),
        mimeType: type,
      });
      recorderRef.current = null;
      chunksRef.current = [];
    };
    recorder.start();
    setIsRecording(true);
    clearMaxTimer();
    maxTimerRef.current = window.setTimeout(() => {
      onMaxDurationRef.current?.();
      if (recorder.state === "recording") recorder.stop();
    }, maxDurationMs);
  }, [clearMaxTimer, isRecording, maxDurationMs, settleStop]);

  const stopRecording = useCallback(() => new Promise<VoiceRecording | null>((resolve, reject) => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      cancelRequestedRef.current = true;
      resolve(null);
      return;
    }
    stopResolveRef.current = resolve;
    stopRejectRef.current = reject;
    try {
      recorder.stop();
    } catch (error) {
      settleStop(null, error);
    }
  }), [settleStop]);

  const cancelRecording = useCallback(() => {
    cancelRequestedRef.current = true;
    clearMaxTimer();
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.onstop = null;
    try { recorder?.stop(); } catch { /* already inactive */ }
    recorderRef.current = null;
    chunksRef.current = [];
    releaseStream();
    stopResolveRef.current?.(null);
    stopResolveRef.current = null;
    stopRejectRef.current = null;
    setIsRecording(false);
  }, [clearMaxTimer, releaseStream]);

  useEffect(() => () => {
    clearMaxTimer();
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.onstop = null;
    try { recorder?.stop(); } catch { /* cleanup */ }
    releaseStream();
  }, [clearMaxTimer, releaseStream]);

  return {
    supported: typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia) && typeof MediaRecorder !== "undefined",
    isRecording,
    error,
    startRecording,
    stopRecording,
    cancelRecording,
  };
}
