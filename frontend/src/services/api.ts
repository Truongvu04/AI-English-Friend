export type ChatRole = "user" | "assistant";
export type MessageType = "text" | "voice";

export interface ChatResponse {
  reply: string;
  conversationId: number;
  conversationTitle?: string;
  userMessageId: number;
  assistantMessageId: number;
}

export type ChatStreamEvent =
  | { type: "start"; conversationId: number; userMessageId: number; conversationTitle?: string }
  | { type: "delta"; text: string }
  | { type: "done"; conversationId: number; conversationTitle?: string; userMessageId: number; assistantMessageId: number; content: string }
  | { type: "error"; message: string };

export interface ChatStreamHandlers {
  onStart?: (event: Extract<ChatStreamEvent, { type: "start" }>) => void;
  onDelta?: (text: string) => void;
}

export interface RuntimeConfig {
  streaming: boolean;
  stt?: SttRuntimeConfig;
  tts?: TtsRuntimeConfig;
}

export interface SttRuntimeConfig {
  provider: string;
  browserFallback: boolean;
  maxAudioBytes: number;
  maxRecordingMs: number;
  requestTimeoutMs: number;
}

export interface SttHealth {
  available: boolean;
  status: string;
  provider?: string;
  model?: string;
  device?: string;
  computeType?: string;
  modelStatus?: "unloaded" | "loading" | "ready" | "transcribing" | "error";
  modelErrorCode?: string;
  error?: string;
}

export interface SttPrepareResponse {
  provider: "faster-whisper" | "browser" | string;
  ready: boolean;
  fallback?: boolean;
  model?: string;
  modelStatus?: string;
  leaseId?: string;
  code?: string;
  error?: string;
}

export interface SttTranscriptionResponse {
  text: string;
  language: string;
  duration: number | null;
  processingMs: number | null;
}

export interface TtsRuntimeConfig {
  provider: string;
  browserFallback: boolean;
  requestTimeoutMs: number;
  maxTextChars: number;
  language: string;
}

export interface TtsHealth {
  available: boolean;
  status: string;
  serviceStatus?: string;
  provider?: string;
  model?: string;
  precision?: string;
  language?: string;
  modelStatus?: "unloaded" | "loading" | "ready" | "synthesizing" | "error" | "unavailable";
  errorCode?: string | null;
  error?: string | null;
}

export interface TtsVoice {
  id: string;
  label: string;
  language: string;
}

export interface TtsSynthesisResponse {
  audio: Blob;
  durationMs: number | null;
  processingMs: number | null;
  voice: string | null;
  sampleRate: number | null;
}

export interface ReentryGreetingResponse {
  generated: boolean;
  latestUserMessageId: number | null;
  triggerUserMessage?: string | null;
  message: StoredMessage | null;
}

export interface Persona {
  id: number;
  slug: string;
  name: string;
  cardLabel: string;
  tagline: string;
  shortDescription: string;
  longDescription: string;
  greeting: string;
  voiceName: string | null;
  hasConversation: boolean;
  conversationId: number | null;
  lastActiveAt: string | null;
  messageCount: number;
}

export interface PersonaThreadResponse {
  persona: Persona;
  conversation: ConversationMessagesResponse["conversation"] | null;
  messages: StoredMessage[];
}

export interface UserSettings {
  learningLevel: string;
  autoSpeak: boolean;
  languageCode: string;
}

export interface TranslationResponse {
  translation: string;
}

export interface ConversationSummary {
  id: number;
  title: string | null;
  conversation_mode: "text" | "voice";
  summary: string | null;
  summary_updated_at: string | null;
  started_at: string;
  ended_at: string | null;
  created_at: string;
  updated_at: string;
  message_count: number | string;
  last_message_at: string | null;
}

export interface StoredMessage {
  id: number;
  conversation_id: number;
  role: "user" | "assistant";
  content: string;
  message_type: "text" | "voice";
  translation: string | null;
  audio_url: string | null;
  audio_duration_ms: number | null;
  created_at: string;
}

export interface ConversationsResponse {
  conversations: ConversationSummary[];
}

export interface ConversationMessagesResponse {
  conversation: {
    id: number;
    user_id: number;
    title: string | null;
    conversation_mode: "text" | "voice";
    summary: string | null;
    summary_updated_at: string | null;
    created_at: string;
  };
  messages: StoredMessage[];
}

const API_URL = (
  import.meta.env.VITE_API_URL || "http://localhost:3001"
).replace(/\/$/, "");

export async function getRuntimeConfig(): Promise<RuntimeConfig> {
  const response = await fetch(`${API_URL}/api/config`);
  const data = (await response.json()) as Partial<RuntimeConfig> & { error?: string };
  if (!response.ok || typeof data.streaming !== "boolean") {
    throw new Error(data.error || "Invalid runtime configuration");
  }
  return {
    streaming: data.streaming,
    stt: data.stt,
    tts: data.tts,
  };
}

export async function getSttHealth(): Promise<SttHealth> {
  const response = await fetch(`${API_URL}/api/stt/health`);
  const data = (await response.json()) as SttHealth & { error?: string };
  if (!response.ok && typeof data.available !== "boolean") {
    throw new Error(data.error || "Unable to check speech transcription service");
  }
  return data;
}

export async function prepareStt(signal?: AbortSignal): Promise<SttPrepareResponse> {
  const response = await fetch(`${API_URL}/api/stt/prepare`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
    signal,
  });
  const data = (await response.json().catch(() => ({}))) as SttPrepareResponse;
  if (!response.ok || !data.ready) throw new Error(data.error || "Speech transcription is unavailable.");
  return data;
}

export async function releaseSttLease(leaseId: string, reason = "other"): Promise<{ released: boolean; pending?: boolean; alreadyReleased?: boolean; stale?: boolean }> {
  const response = await fetch(`${API_URL}/api/stt/release`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ leaseId, reason }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Speech transcription lease could not be released.");
  return data;
}

export async function transcribeAudio(
  blob: Blob,
  durationMs: number,
  maxAudioBytes?: number,
  signal?: AbortSignal,
  leaseId?: string,
): Promise<SttTranscriptionResponse> {
  if (maxAudioBytes && blob.size > maxAudioBytes) {
    throw new Error("This recording is too large. Please speak for a shorter time.");
  }
  const response = await fetch(`${API_URL}/api/stt/transcribe`, {
    method: "POST",
    headers: {
      "Content-Type": blob.type || "application/octet-stream",
      "X-Audio-Duration-Ms": String(Math.max(0, Math.round(durationMs))),
      ...(leaseId ? { "X-STT-Lease-Id": leaseId } : {}),
    },
    body: blob,
    signal,
  });
  const data = (await response.json().catch(() => ({}))) as SttTranscriptionResponse & { error?: string };
  if (!response.ok) throw new Error(data.error || "Speech transcription is unavailable.");
  if (typeof data.text !== "string") throw new Error("Speech transcription returned no text.");
  return {
    text: data.text.trim().replace(/\s+/g, " "),
    language: data.language || "en",
    duration: data.duration ?? null,
    processingMs: data.processingMs ?? null,
  };
}

export async function getTtsHealth(): Promise<TtsHealth> {
  const response = await fetch(`${API_URL}/api/tts/health`);
  const data = (await response.json().catch(() => ({}))) as TtsHealth & { error?: string };
  if (!response.ok && typeof data.available !== "boolean") throw new Error(data.error || "Unable to check Kokoro TTS service");
  return data;
}

export async function getTtsVoices(): Promise<TtsVoice[]> {
  const response = await fetch(`${API_URL}/api/tts/voices`);
  const data = (await response.json().catch(() => ({}))) as { voices?: string[]; language?: string; error?: string };
  if (!response.ok) throw new Error(data.error || "Unable to load Kokoro voices");
  const language = data.language || "en-us";
  return (Array.isArray(data.voices) ? data.voices : []).map((id) => ({
    id,
    label: id.replace(/^(?:af|am|bf|bm)_/, "").replace(/(^|_)([a-z])/g, (_, prefix, letter) => `${prefix} ${letter.toUpperCase()}`).trim(),
    language,
  }));
}

export async function synthesizeTts(
  text: string,
  voice: string,
  speed = 1,
  language = "en-us",
  signal?: AbortSignal,
): Promise<TtsSynthesisResponse> {
  const response = await fetch(`${API_URL}/api/tts/synthesize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, voice, speed, language }),
    signal,
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({})) as { error?: string; code?: string };
    const error = new Error(data.error || "Kokoro TTS synthesis failed");
    (error as Error & { code?: string }).code = data.code;
    throw error;
  }
  return {
    audio: await response.blob(),
    durationMs: Number(response.headers.get("X-TTS-Duration-Ms") || 0) || null,
    processingMs: Number(response.headers.get("X-TTS-Processing-Ms") || 0) || null,
    voice: response.headers.get("X-TTS-Voice"),
    sampleRate: Number(response.headers.get("X-TTS-Sample-Rate") || 0) || null,
  };
}

export async function sendChatMessage(
  message: string,
  level = "A2",
  conversationId: number | null = null,
  personaId: number | null = null,
  messageType: MessageType = "text",
  audioDurationMs: number | null = null,
): Promise<ChatResponse> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 90_000);

  try {
    const response = await fetch(`${API_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        level: level || "A2",
        conversationId,
        personaId,
        messageType,
        audioDurationMs,
      }),
      signal: controller.signal,
    });

    const data = (await response.json()) as ChatResponse & { error?: string };
    if (!response.ok) throw new Error(data.error || "Unable to send message");
    if (!data.reply || typeof data.reply !== "string") {
      throw new Error("The AI response was empty");
    }

    if (
      typeof data.conversationId !== "number" ||
      !Number.isInteger(data.conversationId)
    ) {
      throw new Error("The conversation ID was missing");
    }

    if (
      typeof data.userMessageId !== "number" ||
      !Number.isInteger(data.userMessageId) ||
      typeof data.assistantMessageId !== "number" ||
      !Number.isInteger(data.assistantMessageId)
    ) {
      throw new Error("The saved message IDs were missing");
    }

    return {
      reply: data.reply,
      conversationId: data.conversationId,
      conversationTitle: data.conversationTitle,
      userMessageId: data.userMessageId,
      assistantMessageId: data.assistantMessageId,
    };
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function streamChatMessage(
  message: string,
  level = "A2",
  conversationId: number | null = null,
  personaId: number | null = null,
  messageType: MessageType = "text",
  audioDurationMs: number | null = null,
  signal?: AbortSignal,
  handlers: ChatStreamHandlers = {},
): Promise<ChatResponse> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 120_000);
  const abortFromCaller = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", abortFromCaller, { once: true });
  }

  let deltaBuffer = "";
  let deltaTimer: number | null = null;
  const flushDeltas = () => {
    if (deltaTimer !== null) {
      window.clearTimeout(deltaTimer);
      deltaTimer = null;
    }
    if (deltaBuffer) {
      const next = deltaBuffer;
      deltaBuffer = "";
      handlers.onDelta?.(next);
    }
  };
  const queueDelta = (text: string) => {
    deltaBuffer += text;
    if (deltaTimer === null) deltaTimer = window.setTimeout(flushDeltas, 30);
  };

  try {
    const response = await fetch(`${API_URL}/api/chat/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, level: level || "A2", conversationId, personaId, messageType, audioDurationMs }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error || "Unable to send message");
    }
    if (!response.body) throw new Error("The streaming response was empty");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffered = "";
    let result: ChatResponse | null = null;
    const consume = (line: string) => {
      if (!line.trim()) return;
      const event = JSON.parse(line) as ChatStreamEvent;
      if (event.type === "start") {
        handlers.onStart?.(event);
      } else if (event.type === "delta") {
        if (typeof event.text === "string") queueDelta(event.text);
      } else if (event.type === "error") {
        throw new Error(event.message || "The AI stream failed");
      } else if (event.type === "done") {
        flushDeltas();
        result = { reply: event.content, conversationId: event.conversationId, conversationTitle: event.conversationTitle, userMessageId: event.userMessageId, assistantMessageId: event.assistantMessageId };
      }
    };
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffered += decoder.decode(value, { stream: true });
      const lines = buffered.split(/\r?\n/);
      buffered = lines.pop() || "";
      lines.forEach(consume);
    }
    buffered += decoder.decode();
    if (buffered.trim()) consume(buffered);
    flushDeltas();
    if (!result) throw new Error("The AI stream ended before completion");
    return result;
  } finally {
    flushDeltas();
    window.clearTimeout(timeout);
    signal?.removeEventListener("abort", abortFromCaller);
  }
}

export async function getPersonas(): Promise<{ personas: Persona[] }> {
  const response = await fetch(`${API_URL}/api/personas`);
  const data = (await response.json()) as { personas?: Persona[]; error?: string };
  if (!response.ok) throw new Error(data.error || "Unable to load AI friends");
  if (!Array.isArray(data.personas)) throw new Error("Invalid personas response");
  return { personas: data.personas };
}

export async function getPersonaThread(personaId: number): Promise<PersonaThreadResponse> {
  const response = await fetch(`${API_URL}/api/personas/${personaId}/thread`);
  const data = (await response.json()) as PersonaThreadResponse & { error?: string };
  if (!response.ok) throw new Error(data.error || "Unable to load this AI friend");
  if (!data.persona || !Array.isArray(data.messages)) {
    throw new Error("Invalid persona thread response");
  }
  return data;
}

export async function requestReentryGreeting(
  personaId: number,
  lastGreetedUserMessageId: number | null = null,
): Promise<ReentryGreetingResponse> {
  const response = await fetch(`${API_URL}/api/personas/${personaId}/reentry`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      lastGreetedUserMessageId,
      localHour: new Date().getHours(),
      daypart: new Date().getHours() < 12 ? "morning" : new Date().getHours() < 18 ? "afternoon" : "evening",
    }),
  });
  const data = (await response.json()) as ReentryGreetingResponse & { error?: string };
  if (!response.ok) throw new Error(data.error || "Unable to prepare a return greeting");
  if (typeof data.generated !== "boolean" || !("message" in data)) {
    throw new Error("Invalid re-entry response");
  }
  return data;
}

export async function getConversations(): Promise<ConversationsResponse> {
  const response = await fetch(`${API_URL}/api/conversations`);

  const data = (await response.json()) as ConversationsResponse & {
    error?: string;
  };

  if (!response.ok) {
    throw new Error(data.error || "Unable to load conversations");
  }

  if (!Array.isArray(data.conversations)) {
    throw new Error("Invalid conversations response");
  }

  return data;
}

export async function getConversationMessages(
  conversationId: number,
): Promise<ConversationMessagesResponse> {
  const response = await fetch(
    `${API_URL}/api/conversations/${conversationId}/messages`,
  );

  const data = (await response.json()) as ConversationMessagesResponse & {
    error?: string;
  };

  if (!response.ok) {
    throw new Error(data.error || "Unable to load conversation");
  }

  if (!data.conversation || !Array.isArray(data.messages)) {
    throw new Error("Invalid conversation response");
  }

  return data;
}

export async function translateText(
  messageId: number,
  targetLanguage = "vi",
  force = false,
): Promise<TranslationResponse> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 90_000);

  try {
    const response = await fetch(`${API_URL}/api/translate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageId, targetLanguage, force }),
      signal: controller.signal,
    });

    const data = (await response.json()) as TranslationResponse & {
      error?: string;
    };
    if (!response.ok)
      throw new Error(data.error || "Unable to translate message");
    if (!data.translation || typeof data.translation !== "string")
      throw new Error("The translation was empty");
    return { translation: data.translation };
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function getSettings(): Promise<UserSettings> {
  const response = await fetch(`${API_URL}/api/settings`);
  const data = (await response.json()) as UserSettings & { error?: string };

  if (!response.ok) {
    throw new Error(data.error || "Unable to load settings");
  }

  if (
    typeof data.learningLevel !== "string" ||
    typeof data.autoSpeak !== "boolean" ||
    typeof data.languageCode !== "string"
  ) {
    throw new Error("Invalid settings response");
  }

  return {
    learningLevel: data.learningLevel,
    autoSpeak: data.autoSpeak,
    languageCode: data.languageCode,
  };
}

export async function updateSettings(
  settings: Partial<UserSettings>,
): Promise<UserSettings> {
  const response = await fetch(`${API_URL}/api/settings`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });

  const data = (await response.json()) as UserSettings & { error?: string };
  if (!response.ok) {
    throw new Error(data.error || "Unable to save settings");
  }

  if (
    typeof data.learningLevel !== "string" ||
    typeof data.autoSpeak !== "boolean" ||
    typeof data.languageCode !== "string"
  ) {
    throw new Error("Invalid settings response");
  }

  return {
    learningLevel: data.learningLevel,
    autoSpeak: data.autoSpeak,
    languageCode: data.languageCode,
  };
}
