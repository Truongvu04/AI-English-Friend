import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
  type ReactNode,
} from "react";
import { useVoiceSpaceShortcut } from "./hooks/useKeyboardShortcuts";
import { useSpeechRecognition } from "./hooks/useSpeechRecognition";
import { useVoiceRecorder } from "./hooks/useVoiceRecorder";
import { getVoiceCharacterName, useKokoroSpeechSynthesis, type VoiceCandidate } from "./hooks/useKokoroSpeechSynthesis";
import { getPersonaVoiceProfile } from "./personaConfig";
import {
  sendChatMessage,
  streamChatMessage,
  translateText,
  getConversationMessages,
  requestReentryGreeting,
  getRuntimeConfig,
  prepareStt,
  releaseSttLease,
  transcribeAudio,
  getSettings,
  updateSettings,
  type ConversationSummary,
  type MessageType,
  type Persona,
  type PersonaThreadResponse,
} from "./services/api";
import "./App.css";

type IconName =
  | "arrow"
  | "chevron"
  | "close"
  | "globe"
  | "history"
  | "mic"
  | "pause"
  | "send"
  | "settings"
  | "sparkle"
  | "speaker"
  | "stop"
  | "wave";
type VoiceState =
  | "idle"
  | "preparing"
  | "recording"
  | "stopping"
  | "sending"
  | "processing"
  | "thinking"
  | "streaming"
  | "synthesizing"
  | "speaking"
  | "error";
type ComposerMode = "voice" | "text";
type Drawer = "history" | "settings" | null;
type Message = {
  id: number;
  role: "alex" | "you";
  text: string;
  voice?: boolean;
  correction?: boolean;
  translation?: string;
  translationLoading?: boolean;
  translationError?: string;
  streaming?: boolean;
  localOnly?: boolean;
};

function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const props = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  switch (name) {
    case "arrow":
      return (
        <svg {...props}>
          <path d="M5 12h13M13 6l6 6-6 6" />
        </svg>
      );
    case "chevron":
      return (
        <svg {...props}>
          <path d="m8 10 4 4 4-4" />
        </svg>
      );
    case "close":
      return (
        <svg {...props}>
          <path d="m6 6 12 12M18 6 6 18" />
        </svg>
      );
    case "globe":
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M3.8 9h16.4M3.8 15h16.4M12 3.5c2.2 2.3 3.3 5.1 3.3 8.5S14.2 18.2 12 20.5c-2.2-2.3-3.3-5.1-3.3-8.5S9.8 5.8 12 3.5Z" />
        </svg>
      );
    case "history":
      return (
        <svg {...props}>
          <path d="M4 5v5h5" />
          <path d="M5.3 15a8 8 0 1 0 .5-8.6L4 10" />
          <path d="M12 8v4l2.5 1.5" />
        </svg>
      );
    case "mic":
      return (
        <svg {...props}>
          <rect x="8" y="3" width="8" height="12" rx="4" />
          <path d="M5 11a7 7 0 0 0 14 0M12 18v3M8 21h8" />
        </svg>
      );
    case "pause":
      return (
        <svg {...props}>
          <path d="M8 5v14M16 5v14" />
        </svg>
      );
    case "send":
      return (
        <svg {...props}>
          <path d="m21 3-7.4 18-3.5-7.1L3 10.4 21 3Z" />
          <path d="M10.1 13.9 21 3" />
        </svg>
      );
    case "settings":
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="3" />
          <path
            d="m19.4 15 .1.1a1.8 1.8 0 0 1-2.5 2.5l-.1-.1a1.8 1.8 0 0 0-3.1 1.3v.2a1.8 1.8 0 0 1-3.6 0v-.2a1.8 1.8 0 0 0-3.1-1.3l-.1.1a1.8 1.8 0 1 1-2.5-2.5l.1-.1A1.8 1.8 0 0 0 3.4 12h-.2a1.8 1.8 0 0 1 0-3.6h.2a1.8 1.8 0 0 0 1.3-3.1l-.1-.1a1.8 1.8 0 1 1 2.5-2.5l.1.1a1.8 1.8 0 0 0 3.1-1.3v-.2a1.8 1.8 0 0 1 3.6 0v.2a1.8 1.8 0 0 0 3.1 1.3l-.1-.1a1.8 1.8 0 1 1 2.5 2.5l-.1.1a1.8 1.8 0 0 0 1.3 3.1h.2a1.8 1.8 0 0 1 0 3.6h-.2a1.8 1.8 0 0 0-1.3 3.1Z"
            transform="scale(.72) translate(4.6 4.6)"
          />
        </svg>
      );
    case "sparkle":
      return (
        <svg {...props}>
          <path d="m12 3-1.4 5.6L5 10l5.6 1.4L12 17l1.4-5.6L19 10l-5.6-1.4L12 3Z" />
          <path d="m19 16-.6 2.4L16 19l2.4.6L19 22l.6-2.4L19 16Z" />
        </svg>
      );
    case "speaker":
      return (
        <svg {...props}>
          <path d="M4 10v4h3l4 3V7l-4 3H4Z" />
          <path d="M15 9.5a4 4 0 0 1 0 5M17.5 7a7.5 7.5 0 0 1 0 10" />
        </svg>
      );
    case "stop":
      return (
        <svg {...props}>
          <rect x="6" y="6" width="12" height="12" rx="2" />
        </svg>
      );
    case "wave":
      return (
        <svg {...props}>
          <path d="M4 12h2M8 8v8M12 5v14M16 8v8M20 12h-2" />
        </svg>
      );
  }
}

type AppProps = {
  persona?: Persona;
  initialThread?: PersonaThreadResponse;
  onBackToPersonas?: () => void;
};

function createInitialMessages(persona?: Persona, thread?: PersonaThreadResponse): Message[] {
  const messages = thread?.messages.map((message) => ({
    id: message.id,
    role: message.role === "assistant" ? "alex" as const : "you" as const,
    text: message.content,
    voice: message.message_type === "voice",
    translation: message.translation || undefined,
  })) || [];
  if (messages.length === 0 && persona?.greeting) {
    return [{ id: -persona.id, role: "alex", text: persona.greeting }];
  }
  return messages;
}

const starters = [
  "Tell me about your day",
  "Ask me something random",
  "Let's talk about movies",
];

function ModeSwitch({
  mode,
  onChange,
}: {
  mode: ComposerMode;
  onChange: (mode: ComposerMode) => void;
}) {
  return (
    <div className="mode-switch" role="tablist" aria-label="Input mode">
      <button
        type="button"
        role="tab"
        aria-selected={mode === "voice"}
        className={mode === "voice" ? "selected" : ""}
        onClick={() => onChange("voice")}
      >
        <Icon name="mic" size={15} /> Voice
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={mode === "text"}
        className={mode === "text" ? "selected" : ""}
        onClick={() => onChange("text")}
      >
        <Icon name="send" size={14} /> Text
      </button>
    </div>
  );
}

function buildHistorySections(conversations: ConversationSummary[]) {
  const todayItems: ConversationSummary[] = [];
  const yesterdayItems: ConversationSummary[] = [];
  const thisWeekItems: ConversationSummary[] = [];
  const earlierItems: ConversationSummary[] = [];

  const now = new Date();

  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  );

  const startOfYesterday = new Date(startOfToday);
  startOfYesterday.setDate(startOfYesterday.getDate() - 1);

  const startOfThisWeek = new Date(startOfToday);
  startOfThisWeek.setDate(startOfThisWeek.getDate() - 6);

  for (const conversation of conversations) {
    const dateValue =
      conversation.last_message_at ||
      conversation.updated_at ||
      conversation.created_at;

    const conversationDate = new Date(dateValue);

    if (Number.isNaN(conversationDate.getTime())) {
      earlierItems.push(conversation);
      continue;
    }

    if (conversationDate >= startOfToday) {
      todayItems.push(conversation);
    } else if (conversationDate >= startOfYesterday) {
      yesterdayItems.push(conversation);
    } else if (conversationDate >= startOfThisWeek) {
      thisWeekItems.push(conversation);
    } else {
      earlierItems.push(conversation);
    }
  }

  return [
    {
      label: "Today",
      items: todayItems,
    },
    {
      label: "Yesterday",
      items: yesterdayItems,
    },
    {
      label: "This week",
      items: thisWeekItems,
    },
    {
      label: "Earlier",
      items: earlierItems,
    },
  ].filter((section) => section.items.length > 0);
}

function Drawer({
  drawer,
  onClose,
  level,
  onLevelChange,
  settingsError,
  speechSupported,
  selectedVoiceName,
  onVoiceChange,
  voiceCandidates,
  voiceRate,
  onVoiceRateChange,
  onPreviewVoice,
  personaName,
  personaSlug,
  voiceStyle,

  conversations,
  historyLoading,
  historyError,
  currentConversationId,
  openingConversationId,
  onSelectConversation,
  onNewConversation,
}: {
  drawer: Drawer;
  onClose: () => void;

  level: string;
  onLevelChange: (level: string) => void;

  settingsError: string | null;

  speechSupported: boolean;

  selectedVoiceName: string;
  onVoiceChange: (name: string) => void;
  voiceCandidates: VoiceCandidate[];
  voiceRate: number;
  onVoiceRateChange: (rate: number) => void;
  onPreviewVoice: () => void;
  personaName: string;
  personaSlug: string;
  voiceStyle: string;

  conversations: ConversationSummary[];

  historyLoading: boolean;

  historyError: string | null;

  currentConversationId: number | null;

  openingConversationId: number | null;

  onSelectConversation: (conversation: ConversationSummary) => void;
  onNewConversation: () => void;

}) {
  if (!drawer) return null;
  const title = drawer === "history" ? "Your conversations" : "Settings";
  const recommendedVoice = voiceCandidates.find((voice) => (voice.id || voice.name) === selectedVoiceName) || voiceCandidates[0];

  const historySections = buildHistorySections(conversations);
  return (
    <div
      className={`drawer-layer drawer-${drawer} persona-theme-${personaSlug}`}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <button
        className="drawer-scrim"
        onClick={onClose}
        aria-label="Close drawer"
      />
      <aside className="drawer-panel">
        <header className="drawer-header">
          <div>
            <span className="drawer-kicker">
              {drawer === "history" ? "LOOKING BACK" : "YOUR SPACE"}
            </span>
            <h2>{title}</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            <Icon name="close" size={17} />
          </button>
        </header>
        {drawer === "history" && (
          <div className="history-content">
            <button
              type="button"
              className="history-new-button"
              onClick={onNewConversation}
            >
              + New conversation
            </button>

            {historyLoading ? (
              <p>Loading conversations...</p>
            ) : historyError ? (
              <p>{historyError}</p>
            ) : conversations.length === 0 ? (
              <p>No conversations yet.</p>
            ) : (
              historySections.map((section) => (
                <HistoryGroup
                  key={section.label}
                  label={section.label}
                  items={section.items}
                  currentConversationId={currentConversationId}
                  openingConversationId={openingConversationId}
                  onSelect={onSelectConversation}
                />
              ))
            )}
          </div>
        )}
        {drawer === "settings" && (
          <div className="settings-content">
            <section className="settings-section settings-conversation-section">
              <div className="settings-section-heading"><span>CONVERSATION</span><p>Set the pace for your friend.</p></div>
              <SettingRow
                title="English level"
                note="How your friend adapts the conversation pace and language"
              >
                <div className="level-options">
                  {["A1", "A2", "B1", "B2", "C1", "C2"].map((item) => (
                    <button
                      type="button"
                      className={level === item ? "selected" : ""}
                      key={item}
                      onClick={() => onLevelChange(item)}
                    >
                      {item}
                    </button>
                  ))}
                </div>
              </SettingRow>
            </section>
            <section className="settings-section settings-voice-section">
              <div className="settings-section-heading"><span>VOICE</span><p>Personalize how {personaName} sounds.</p></div>
              <div className="voice-selector-card">
                <div className="voice-selector-heading">
                  <span className="voice-selector-avatar" aria-hidden="true"><i /></span>
                  <div><strong>AI voice</strong><span>{personaName}</span><small>{voiceStyle}</small></div>
                  <span className="voice-recommended-label">Recommended</span>
                </div>
                <div className="voice-selected-summary">
                  <div><strong>{recommendedVoice?.name || "Speech unavailable"}</strong><span>{recommendedVoice ? `${recommendedVoice.lang} · English voice` : "Start Kokoro or enable browser fallback"}</span></div>
                  <label className="voice-change-control">Change voice<select value={selectedVoiceName} onChange={(event) => onVoiceChange(event.target.value)} disabled={!speechSupported || voiceCandidates.length === 0} aria-label={`Choose voice for ${personaName}`}><option value="">Browser default</option>{voiceCandidates.map((voice) => <option value={voice.id || voice.name} key={`${voice.id || voice.name}-${voice.lang}`}>{voice.name} ({voice.lang})</option>)}</select></label>
                </div>
                <button type="button" className="voice-preview-button" onClick={onPreviewVoice} disabled={!speechSupported}><Icon name="speaker" size={14} /> Preview voice</button>
              </div>
              <div className="voice-rate-control">
                <div><strong>Voice speed</strong><span>Slower <b>{voiceRate.toFixed(2)}×</b> Faster</span></div>
                <input type="range" min="0.75" max="1.25" step="0.05" value={voiceRate} onChange={(event) => onVoiceRateChange(Number(event.target.value))} aria-label="Voice speed" />
              </div>
            </section>
            {settingsError && <p className="settings-error">{settingsError}</p>}
          </div>
        )}
      </aside>
    </div>
  );
}

function HistoryGroup({
  label,
  items,
  currentConversationId,
  openingConversationId,
  onSelect,
}: {
  label: string;

  items: ConversationSummary[];

  currentConversationId: number | null;

  openingConversationId: number | null;

  onSelect: (conversation: ConversationSummary) => void;
}) {
  return (
    <section className="history-group">
      <span>{label}</span>

      {items.map((item) => {
        const isCurrent = currentConversationId === item.id;

        const isOpening = openingConversationId === item.id;

        const displayTitle =
          !item.title || item.title === "New conversation"
            ? "Your conversation"
            : item.title;

        return (
          <button
            type="button"
            key={item.id}
            onClick={() => onSelect(item)}
            disabled={isOpening}
            aria-current={isCurrent ? "true" : undefined}
          >
            <i />

            {isOpening ? "Loading..." : displayTitle}

            <Icon name="chevron" size={14} />
          </button>
        );
      })}
    </section>
  );
}
function SettingRow({
  title,
  note,
  children,
}: {
  title: string;
  note: string;
  children: ReactNode;
}) {
  return (
    <div className="setting-row">
      <div>
        <strong>{title}</strong>
        <small>{note}</small>
      </div>
      {children}
    </div>
  );
}

function ChatShell({
  assistantName,
  personaSlug,
  messages,
  messagesEndRef,
  effectiveVoiceState,
  stateLabel,
  mode,
  input,
  setInput,
  recordingSeconds,
  voiceDraft,
  voicePreview,
  voiceDraftRef,
  onVoiceDraftChange,
  level,
  levelOpen,
  setLevelOpen,
  onLevelChange,
  onModeChange,
  onSend,
  onToggleRecording,
  onTranslate,
  onSpeak,
  speechSupported,
  onSettings,
  onBackToPersonas,
  voiceCharacterName,
}: {
  assistantName: string;
  personaSlug: string;
  messages: Message[];
  messagesEndRef: RefObject<HTMLDivElement | null>;
  effectiveVoiceState: VoiceState;
  stateLabel: string;
  mode: ComposerMode;
  input: string;
  setInput: (value: string) => void;
  recordingSeconds: number;
  voiceDraft: string;
  voicePreview: string;
  voiceDraftRef: RefObject<HTMLTextAreaElement | null>;
  onVoiceDraftChange: (value: string) => void;
  level: string;
  levelOpen: boolean;
  setLevelOpen: (open: boolean) => void;
  onLevelChange: (level: string) => void;
  onModeChange: (mode: ComposerMode) => void;
  onSend: (value?: string, fromVoice?: boolean) => void;
  onToggleRecording: () => void;
  onTranslate: (messageId: number, force?: boolean) => void;
  onSpeak: (text: string) => void;
  speechSupported: boolean;
  onSettings: () => void;
  onBackToPersonas?: () => void;
  voiceCharacterName: string;
}) {
  const isListening = effectiveVoiceState === "recording";
  const isVoiceDraftLocked = ["preparing", "recording", "stopping", "sending", "thinking", "streaming", "processing"].includes(effectiveVoiceState);
  const panelStatus = effectiveVoiceState === "recording"
    ? "Listening"
    : effectiveVoiceState === "stopping"
      ? "Finishing"
      : effectiveVoiceState === "preparing"
        ? "Preparing voice..."
      : effectiveVoiceState === "synthesizing"
        ? `${voiceCharacterName} is preparing voice...`
      : effectiveVoiceState === "sending" || effectiveVoiceState === "thinking"
        ? `${voiceCharacterName} is thinking...`
        : effectiveVoiceState === "processing"
          ? "Transcribing..."
        : effectiveVoiceState === "streaming"
          ? `${voiceCharacterName} is replying...`
        : effectiveVoiceState === "speaking"
          ? `${voiceCharacterName} is speaking...`
          : "Online";
  return (
    <main className={`chat-app persona-theme-${personaSlug} mode-${mode} state-${effectiveVoiceState}`}>
      <div className="chat-frame">
        <header className="chat-header">
          <div className="chat-brand">
            <span className="chat-brand-mark"><i /><i /><i /></span>
            <div>
              <strong>{assistantName}</strong>
              <span>AI English Friend · private thread</span>
            </div>
          </div>
          <ModeSwitch mode={mode} onChange={onModeChange} />
          <div className="chat-header-actions">
            <button type="button" className="chat-icon-button" onClick={onSettings} aria-label="Open settings">
              <Icon name="settings" size={17} />
            </button>
          </div>
        </header>

        <div className="chat-utility-row">
          <div className="chat-utility-left">
            {onBackToPersonas && (
              <button type="button" className="chat-icon-button chat-back-button" onClick={onBackToPersonas} aria-label="Back to AI friends">
                <Icon name="arrow" size={17} />
              </button>
            )}
          </div>
          <div className="chat-utility-center" aria-label={`${voiceCharacterName} online`}>
            <i className="chat-utility-status-dot" />
            <strong>{voiceCharacterName}</strong>
            <span>Online</span>
          </div>
          <div className="chat-utility-right">
            <div className="chat-level-wrap">
              <button type="button" className="chat-level-button" onClick={() => setLevelOpen(!levelOpen)}>
                <span>Your level</span><strong>{level}</strong><Icon name="chevron" size={14} />
              </button>
              {levelOpen && (
                <div className="chat-level-menu">
                  {["A1", "A2", "B1", "B2", "C1", "C2"].map((item) => (
                    <button type="button" key={item} className={item === level ? "selected" : ""} onClick={() => { onLevelChange(item); setLevelOpen(false); }}>
                      {item}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className={`chat-shell-body mode-body-${mode}`}>
          <aside className="chat-intro-column">
            <span className="chat-mode-label">{mode === "voice" ? "VOICE MODE" : "TEXT MODE"}</span>
            <h1>{mode === "voice" ? "Say what’s\non your mind." : "Write what’s\non your mind."}</h1>
            <p>{mode === "voice"
              ? "A calm space to speak naturally. No scripts, no pressure — just a conversation that follows you."
              : "Take your time, find your words, and let the conversation move at your own pace."}</p>
            <div className="chat-intro-note">
              <span className="chat-note-dot" />
              <span>Companion, not classroom</span>
            </div>
            {mode === "voice" && (
              <div className="voice-shortcut-help">
                <span>VOICE SHORTCUTS</span>
                <div><kbd>SPACE</kbd><small>Start / stop</small></div>
                <div><kbd>ESC</kbd><small>Cancel</small></div>
              </div>
            )}
          </aside>

          {mode === "voice" ? (
            <section className="voice-mode-stage" aria-label="Voice conversation">
              <div className={`voice-orb-wrap ${isListening ? "is-listening" : ""} ${effectiveVoiceState === "thinking" || effectiveVoiceState === "sending" || effectiveVoiceState === "streaming" || effectiveVoiceState === "synthesizing" ? "is-thinking" : ""}`}>
                <span className="voice-orb-aura aura-a" />
                <span className="voice-orb-aura aura-b" />
                <button type="button" className="voice-orb-button" onClick={onToggleRecording} aria-label={isListening ? "Stop listening" : "Start speaking"}>
                  <span className="voice-orb-core"><Icon name={isListening ? "stop" : "mic"} size={31} /></span>
                </button>
              </div>
              <div className="voice-waveform" aria-hidden="true">
                {Array.from({ length: 17 }, (_, index) => <i key={index} style={{ "--bar-index": index } as CSSProperties} />)}
              </div>
              <div className="voice-state-copy"><span className="voice-state-dot" /><strong>{stateLabel}</strong>{isListening && <time>{formatClock(recordingSeconds)}</time>}</div>
              {(isListening || effectiveVoiceState === "stopping" || Boolean(voiceDraft)) && (
                <div className="voice-transcript-editor">
                <textarea
                  ref={voiceDraftRef}
                  className="voice-transcript-input"
                  value={voicePreview}
                  onChange={(event) => onVoiceDraftChange(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      if (!isVoiceDraftLocked && voiceDraft.trim()) onSend(voiceDraft, true);
                    }
                  }}
                  readOnly={isVoiceDraftLocked}
                  placeholder="Speak, then edit before sending..."
                  rows={1}
                  aria-label="Voice transcript"
                />
                </div>
              )}
            </section>
          ) : (
            <section className="text-mode-stage" aria-label="Text conversation">
              {/* <div className="text-stage-status"><span className="text-online"><i /> Online</span></div> */}
              <div className="chat-message-scroll">
                <div className="chat-message-list">
                  {messages.map((message, index) => {
                    const channel = getMessageChannel(messages, index);
                    return (
                    <article className={`chat-message chat-message-${message.role}`} key={message.id}>
                      <div className="chat-message-meta"><span>{message.role === "alex" ? assistantName.toUpperCase() : "YOU"}</span><em className={`message-channel-badge channel-${channel}`}><Icon name={channel === "voice" ? "mic" : "send"} size={12} /> {channel === "voice" ? "Voice" : "Text"}</em>{message.role === "alex" && <button type="button" onClick={() => onSpeak(message.text)} disabled={!speechSupported} aria-label={`Play ${assistantName} message`}><Icon name="speaker" size={15} /></button>}</div>
                      {message.role === "alex" ? (
                        <div className="chat-assistant-content">
                          <div className="chat-bubble"><p>{message.text}</p></div>
                          <div className="chat-message-actions">
                            <button type="button" className="chat-translate-button" onClick={() => onTranslate(message.id)} disabled={message.id < 0 || Boolean(message.translationLoading)}>{message.translationLoading ? "Translating..." : message.translationError ? "Retry" : message.translation ? "Hide translation" : "Translate"}</button>
                            {message.translation && <button type="button" className="chat-translate-button" onClick={() => onTranslate(message.id, true)} disabled={message.id < 0 || Boolean(message.translationLoading)}>Retranslate</button>}
                          </div>
                          {(message.translation || message.translationError) && <div className={`chat-translation ${message.translationError ? "has-error" : ""}`}><span>VIETNAMESE</span><p className="vietnamese-copy">{message.translation || message.translationError}</p></div>}
                        </div>
                      ) : <div className="chat-bubble"><p>{message.text}</p></div>}
                    </article>
                    );
                  })}
                  <div ref={messagesEndRef} aria-hidden="true" />
                </div>
              </div>
              <div className="chat-suggestions">
                {starters.map((starter) => <button type="button" key={starter} onClick={() => onSend(starter)}>{starter}<Icon name="arrow" size={13} /></button>)}
              </div>
              <div className="chat-composer-wrap">
                <div className="chat-composer">
                  <textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); onSend(); } }} placeholder="Write something..." rows={1} aria-label="Write a message" />
                  <button type="button" className="chat-send-button" onClick={() => onSend()} disabled={!input.trim() || effectiveVoiceState === "thinking" || effectiveVoiceState === "streaming"} aria-label="Send message"><Icon name="send" size={18} /></button>
                </div>
                <span className="composer-hint">ENTER to send <b>·</b> SHIFT + ENTER for a new line</span>
              </div>
            </section>
          )}

          {mode === "voice" && (
            <aside className="voice-conversation-panel" aria-label="Live voice conversation">
              <header className="voice-conversation-header">
                <div><span>LIVE CONVERSATION</span><strong>Recent messages</strong></div>
                <span className="voice-panel-status"><i /> {panelStatus}</span>
              </header>
              <div className="voice-conversation-scroll">
                {messages.slice(-10).map((message, index) => {
                  const messageIndex = messages.length - Math.min(messages.length, 10) + index;
                  const channel = getMessageChannel(messages, messageIndex);
                  return (
                  <article className={`voice-transcript-message voice-transcript-${message.role}`} key={message.id}>
                    <div className="voice-transcript-meta"><span>{message.role === "alex" ? assistantName.toUpperCase() : "YOU"}</span><em className={`message-channel-badge channel-${channel}`}><Icon name={channel === "voice" ? "mic" : "send"} size={11} /> {channel === "voice" ? "Voice" : "Text"}</em></div>
                    <p>{message.text}</p>
                    {message.role === "alex" && (
                      <div className="voice-transcript-actions">
                        <button type="button" onClick={() => onTranslate(message.id)} disabled={message.id < 0 || Boolean(message.translationLoading)}>{message.translationLoading ? "Translating..." : message.translationError ? "Retry" : message.translation ? "Translated" : "Translate"}</button>
                        {message.translation && <button type="button" onClick={() => onTranslate(message.id, true)} disabled={message.id < 0 || Boolean(message.translationLoading)}>Retranslate</button>}
                        <button type="button" onClick={() => onSpeak(message.text)} disabled={!speechSupported} aria-label={`Play ${assistantName} message`}><Icon name="speaker" size={13} /></button>
                      </div>
                    )}
                    {message.translation && <div className="voice-transcript-translation vietnamese-copy">{message.translation}</div>}
                    {message.translationError && <div className="voice-transcript-translation has-error">{message.translationError}</div>}
                  </article>
                  );
                })}
                <div ref={messagesEndRef} aria-hidden="true" />
              </div>
            </aside>
          )}
        </div>

        <footer className="chat-footer"><span>{mode === "voice" ? "Your voice stays in this conversation." : "A thoughtful space for everyday English."}</span><span>{assistantName} <i /> ready when you are</span></footer>
      </div>
    </main>
  );
}

function formatClock(value: number) {
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

function getMessageChannel(messages: Message[], index: number): "voice" | "text" {
  const message = messages[index];
  if (message?.role === "you") return message.voice ? "voice" : "text";
  for (let previous = index - 1; previous >= 0; previous -= 1) {
    if (messages[previous].role === "you") {
      return messages[previous].voice ? "voice" : "text";
    }
  }
  return "text";
}

function joinVoiceText(base: string, addition: string) {
  const left = base.trim();
  const right = addition.trim();
  if (!left) return right;
  if (!right) return left;
  return `${left} ${right}`;
}

export default function App({ persona, initialThread, onBackToPersonas }: AppProps) {
  const assistantName = persona?.name || "Alex";
  const personaSlug = persona?.slug || "thoughtful";
  const personaVoiceProfile = getPersonaVoiceProfile(personaSlug);
  const [messages, setMessages] = useState(() =>
    createInitialMessages(persona, initialThread),
  );

  const [conversationId, setConversationId] = useState<number | null>(
    initialThread?.conversation?.id || null,
  );

  const [historyConversations] = useState<ConversationSummary[]>([]);

  const [historyLoading] = useState(false);

  const [historyError, setHistoryError] = useState<string | null>(null);

  const [openingConversationId, setOpeningConversationId] = useState<
    number | null
  >(null);
  const [level, setLevel] = useState("A2");
  const [input, setInput] = useState("");
  const [drawer, setDrawer] = useState<Drawer>(null);
  const [levelOpen, setLevelOpen] = useState(false);
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [voiceDraft, setVoiceDraft] = useState("");
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [mode, setMode] = useState<ComposerMode>("voice");
  const [streamingEnabled, setStreamingEnabled] = useState(true);
  const [sttBrowserFallback, setSttBrowserFallback] = useState(true);
  const [ttsBrowserFallback, setTtsBrowserFallback] = useState<boolean | null>(null);
  const [sttMaxAudioBytes, setSttMaxAudioBytes] = useState(20 * 1024 * 1024);
  const [sttMaxRecordingMs, setSttMaxRecordingMs] = useState(120_000);
  const [transcriptionError, setTranscriptionError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const voiceDraftValueRef = useRef("");
  const voiceDurationMsRef = useRef(0);
  const voiceSessionDurationMsRef = useRef(0);
  const voiceSessionBaseRef = useRef("");
  const shouldFocusVoiceDraftRef = useRef(false);
  const voiceDraftTextareaRef = useRef<HTMLTextAreaElement>(null);
  const sendingVoiceRef = useRef(false);
  const streamAbortRef = useRef<AbortController | null>(null);
  const transcribeAbortRef = useRef<AbortController | null>(null);
  const prepareSttAbortRef = useRef<AbortController | null>(null);
  const activeSttLeaseRef = useRef<string | null>(null);
  const voiceCycleRef = useRef(0);
  const captureModeRef = useRef<"whisper" | "browser" | null>(null);
  const finishWhisperRecordingRef = useRef<() => void>(() => undefined);
  const reentryStartedRef = useRef(false);
  const modeRef = useRef<ComposerMode>("voice");
  const handleSpeechError = useCallback(() => setVoiceState("error"), []);
  const {
    finalTranscript,
    interimTranscript,
    error: speechError,
    supported: speechRecognitionSupported,
    isListening,
    startListening,
    stopListening,
    cancelListening,
    resetTranscript,
  } = useSpeechRecognition(handleSpeechError);
  const voiceRecorder = useVoiceRecorder({
    maxDurationMs: sttMaxRecordingMs,
    onMaxDuration: () => finishWhisperRecordingRef.current(),
  });
  const {
    speak,
    stop: stopSpeaking,
    supported: speechSupported,
    selectedVoiceName,
    isSpeaking,
    isSynthesizing,
    selectVoice,
    voiceCandidates,
    voiceRate,
    setVoiceRate,
    previewVoice,
  } = useKokoroSpeechSynthesis(personaSlug, personaVoiceProfile, ttsBrowserFallback ?? false);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  const selectedVoice = voiceCandidates.find((voice) => (voice.id || voice.name) === selectedVoiceName);
  const voiceCharacterName = getVoiceCharacterName(
    selectedVoice ?? selectedVoiceName,
    getVoiceCharacterName(voiceCandidates[0], assistantName),
  );

  useEffect(() => {
    let cancelled = false;

    void getSettings()
      .then((settings) => {
        if (cancelled) return;
        setLevel(settings.learningLevel);
      })
      .catch((error) => {
        if (cancelled) return;
        console.error("Failed to load settings:", error);
        setSettingsError("Couldn't load your saved settings.");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void getRuntimeConfig()
      .then((config) => {
        if (cancelled) return;
        setStreamingEnabled(config.streaming);
        if (config.stt) {
          setSttBrowserFallback(config.stt.browserFallback);
          setSttMaxAudioBytes(config.stt.maxAudioBytes);
          setSttMaxRecordingMs(config.stt.maxRecordingMs);
        }
        if (config.tts) setTtsBrowserFallback(config.tts.browserFallback);
      })
      .catch((error) => {
        console.warn("[config] Could not load runtime config; keeping streaming enabled:", error);
        setTtsBrowserFallback(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!persona?.id || reentryStartedRef.current) return;
    reentryStartedRef.current = true;
    const markerKey = `ai-english-friend.reentry.${persona.id}`;
    let lastGreetedUserMessageId: number | null = null;
    try {
      const stored = Number(window.localStorage.getItem(markerKey));
      if (Number.isInteger(stored) && stored > 0) lastGreetedUserMessageId = stored;
    } catch {
      // Re-entry remains safe because the backend also verifies the activity gap.
    }

    void requestReentryGreeting(persona.id, lastGreetedUserMessageId)
      .then((result) => {
        if (!result.generated || !result.message) return;
        const reentryMessage = result.message;
        try { window.localStorage.setItem(markerKey, String(result.latestUserMessageId)); } catch { /* session-only dedupe */ }
        setMessages((current) => current.some((message) => message.id === reentryMessage.id)
          ? current
          : [...current, { id: reentryMessage.id, role: "alex", text: reentryMessage.content }]);
        if (modeRef.current === "voice") speak(reentryMessage.content, { assistantReply: reentryMessage.content });
      })
      .catch((error) => console.warn("[reentry] Could not prepare a return greeting:", error));
  }, [persona?.id, speak]);

  const handleLevelChange = useCallback(
    async (nextLevel: string) => {
      const previousLevel = level;
      setLevel(nextLevel);
      setSettingsError(null);

      try {
        const saved = await updateSettings({ learningLevel: nextLevel });
        setLevel(saved.learningLevel);
      } catch (error) {
        console.error("Failed to save learning level:", error);
        setLevel(previousLevel);
        setSettingsError("Couldn't save your English level.");
      }
    },
    [level],
  );

  useEffect(() => {
    if (voiceState !== "recording") return;
    const timer = window.setInterval(
      () => setRecordingSeconds((value) => value + 1),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [voiceState]);
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "end",
    });
  }, [messages.length, mode]);
  const streamingTextLength = messages.find((message) => message.streaming)?.text.length || 0;
  useEffect(() => {
    if (streamingTextLength > 0) messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [streamingTextLength]);

  useEffect(() => () => streamAbortRef.current?.abort(), []);

  const sendMessage = useCallback(
    async (value = input, fromVoice = false) => {
      const text = value.trim();
      if (fromVoice && sendingVoiceRef.current) return;
      if (
        !text ||
        (!fromVoice &&
          (voiceState === "preparing" ||
            voiceState === "recording" ||
            voiceState === "stopping" ||
            voiceState === "sending" ||
            voiceState === "thinking" ||
            voiceState === "streaming" ||
            voiceState === "processing")) ||
        (fromVoice &&
          (voiceState === "preparing" ||
            voiceState === "recording" ||
            voiceState === "stopping" ||
            voiceState === "sending" ||
            voiceState === "thinking" ||
            voiceState === "streaming" ||
            voiceState === "processing"))
      )
        return;

      if (fromVoice) {
        sendingVoiceRef.current = true;
      }

      const temporaryUserMessageId = Date.now();
      const temporaryAssistantMessageId = -Date.now() - 1;
      setMessages((current) => [
        ...current,
        { id: temporaryUserMessageId, role: "you", text, voice: fromVoice },
        { id: temporaryAssistantMessageId, role: "alex", text: "", streaming: true },
      ]);
      setInput("");
      setVoiceState(fromVoice ? "sending" : "thinking");

      const messageType: MessageType = fromVoice ? "voice" : "text";
      const audioDurationMs = fromVoice ? voiceDurationMsRef.current : null;
      const streamController = new AbortController();
      streamAbortRef.current = streamController;

      if (fromVoice) {
        captureModeRef.current = null;
        voiceDraftValueRef.current = "";
        voiceDurationMsRef.current = 0;
        voiceSessionDurationMsRef.current = 0;
        voiceSessionBaseRef.current = "";
        shouldFocusVoiceDraftRef.current = false;
        setVoiceDraft("");
        setRecordingSeconds(0);
        setTranscriptionError(null);
        resetTranscript();
      }

      try {
        const result = streamingEnabled
          ? await streamChatMessage(
              text,
              level || "A2",
              conversationId,
              persona?.id || null,
              messageType,
              audioDurationMs,
              streamController.signal,
              {
                onStart: ({ conversationId: startedConversationId, userMessageId }) => {
                  setConversationId(startedConversationId);
                  setMessages((current) => current.map((message) => message.id === temporaryUserMessageId ? { ...message, id: userMessageId } : message));
                },
                onDelta: (delta) => {
                  if (delta.trim()) setVoiceState("streaming");
                  setMessages((current) => current.map((message) => message.id === temporaryAssistantMessageId ? { ...message, text: `${message.text}${delta}`, streaming: true } : message));
                },
              },
            )
          : await sendChatMessage(text, level || "A2", conversationId, persona?.id || null, messageType, audioDurationMs);
        const {
          reply,
          conversationId: returnedConversationId,
          userMessageId,
          assistantMessageId,
        } = result;

        setConversationId(returnedConversationId);

        setMessages((current) => current.map((message) => {
          if (message.id === temporaryUserMessageId) return { ...message, id: userMessageId };
          if (message.id === temporaryAssistantMessageId) return { ...message, id: assistantMessageId, text: reply, streaming: false };
          return message;
        }));
        if (modeRef.current === "voice") speak(reply, { userMessage: text, assistantReply: reply });
      } catch (error) {
        console.error("Text chat request failed:", error);
        setMessages((current) => current.filter((message) => message.id !== temporaryAssistantMessageId));
      } finally {
        if (streamAbortRef.current === streamController) streamAbortRef.current = null;
        if (fromVoice) sendingVoiceRef.current = false;
        setVoiceState("idle");
      }
    },
    [
      conversationId,
      input,
      level,
      persona,
      resetTranscript,
      speak,
      streamingEnabled,
      voiceState,
    ],
  );

  const handleVoiceDraftChange = useCallback((value: string) => {
    voiceDraftValueRef.current = value;
    setVoiceDraft(value);
  }, []);

  const releaseSttLeaseBestEffort = useCallback((leaseId: string | null, reason: string) => {
    if (!leaseId) return;
    void releaseSttLease(leaseId, reason).catch((error) => console.warn("[stt] Lease release failed:", error));
  }, []);

  const finishWhisperRecording = useCallback(async () => {
    if (captureModeRef.current !== "whisper" || voiceState !== "recording") return;
    const leaseId = activeSttLeaseRef.current;
    if (!leaseId) {
      setTranscriptionError("Speech transcription session is no longer active.");
      setVoiceState("error");
      return;
    }
    setVoiceState("processing");
    setTranscriptionError(null);
    try {
      const recording = await voiceRecorder.stopRecording();
      if (!recording) {
        releaseSttLeaseBestEffort(leaseId, "recording-cancelled");
        activeSttLeaseRef.current = null;
        captureModeRef.current = null;
        setVoiceState("idle");
        return;
      }
      setRecordingSeconds(Math.max(0, Math.round(recording.durationMs / 1000)));
      const transcribeController = new AbortController();
      transcribeAbortRef.current = transcribeController;
      const result = await transcribeAudio(recording.blob, recording.durationMs, sttMaxAudioBytes, transcribeController.signal, leaseId);
      if (transcribeAbortRef.current === transcribeController) transcribeAbortRef.current = null;
      activeSttLeaseRef.current = null;
      const transcript = result.text.trim();
      captureModeRef.current = null;
      if (!transcript) {
        setTranscriptionError("No speech detected.");
        setVoiceState("error");
        return;
      }
      const nextDraft = joinVoiceText(voiceSessionBaseRef.current, transcript);
      voiceDraftValueRef.current = nextDraft;
      setVoiceDraft(nextDraft);
      const nextDuration = voiceDurationMsRef.current + recording.durationMs;
      voiceDurationMsRef.current = nextDuration;
      voiceSessionDurationMsRef.current = 0;
      setTranscriptionError(null);
      shouldFocusVoiceDraftRef.current = true;
      setVoiceState("idle");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError" && captureModeRef.current === null) return;
      captureModeRef.current = null;
      transcribeAbortRef.current = null;
      releaseSttLeaseBestEffort(leaseId, "other");
      activeSttLeaseRef.current = null;
      setTranscriptionError(error instanceof Error ? error.message : "Speech transcription failed. Please try again.");
      setVoiceState("error");
    }
  }, [releaseSttLeaseBestEffort, sttMaxAudioBytes, voiceRecorder, voiceState]);

  useEffect(() => {
    finishWhisperRecordingRef.current = () => { void finishWhisperRecording(); };
  }, [finishWhisperRecording]);

  useEffect(() => {
    if (voiceState !== "stopping" || isListening) return;

    const sessionText = joinVoiceText(finalTranscript, interimTranscript);
    const nextDraft = joinVoiceText(voiceSessionBaseRef.current, sessionText);
    voiceDraftValueRef.current = nextDraft;
    setVoiceDraft(nextDraft);
    if (sessionText) {
      const nextDuration = voiceDurationMsRef.current + voiceSessionDurationMsRef.current;
      voiceDurationMsRef.current = nextDuration;
    }
    voiceSessionDurationMsRef.current = 0;
    shouldFocusVoiceDraftRef.current = true;
    setVoiceState("idle");
  }, [finalTranscript, interimTranscript, isListening, voiceState]);

  useEffect(() => {
    if (!shouldFocusVoiceDraftRef.current || voiceState !== "idle") return;
    shouldFocusVoiceDraftRef.current = false;
    window.requestAnimationFrame(() => {
      const editor = voiceDraftTextareaRef.current;
      if (!editor) return;
      editor.focus();
      const cursorPosition = editor.value.length;
      editor.setSelectionRange(cursorPosition, cursorPosition);
    });
  }, [voiceDraft, voiceState]);

  const startRecording = useCallback(() => {
    if (
      mode !== "voice" ||
      isListening ||
      voiceState === "preparing" ||
      voiceState === "thinking" ||
      voiceState === "streaming" ||
      voiceState === "processing" ||
      voiceState === "stopping" ||
      voiceState === "sending" ||
      voiceState === "recording"
    )
      return;
    stopSpeaking();
    voiceSessionBaseRef.current = voiceDraftValueRef.current;
    voiceSessionDurationMsRef.current = 0;
    setRecordingSeconds(0);
    setTranscriptionError(null);
    resetTranscript();
    setVoiceState("preparing");
    const cycle = voiceCycleRef.current + 1;
    voiceCycleRef.current = cycle;
    const prepareController = new AbortController();
    prepareSttAbortRef.current = prepareController;
    void (async () => {
      try {
        if (voiceRecorder.supported) {
          const prepared = await prepareStt(prepareController.signal);
          if (prepareController.signal.aborted || cycle !== voiceCycleRef.current) {
            releaseSttLeaseBestEffort(prepared.leaseId || null, "prepare-failed");
            return;
          }
          if (prepared.provider === "faster-whisper" && !prepared.fallback) {
            if (!prepared.leaseId) throw new Error("Speech transcription session was not created.");
            activeSttLeaseRef.current = prepared.leaseId;
            captureModeRef.current = "whisper";
            setVoiceState("recording");
            try {
              await voiceRecorder.startRecording();
            } catch (error) {
              activeSttLeaseRef.current = null;
              releaseSttLeaseBestEffort(prepared.leaseId, "recording-cancelled");
              throw error;
            }
            return;
          }
        }
        if (sttBrowserFallback && speechRecognitionSupported && !prepareController.signal.aborted) {
          captureModeRef.current = "browser";
          setVoiceState("recording");
          startListening();
          return;
        }
        throw new Error("Speech transcription is unavailable. Start the STT service or enable browser fallback.");
      } catch (error) {
        if (prepareController.signal.aborted) return;
        releaseSttLeaseBestEffort(activeSttLeaseRef.current, "prepare-failed");
        activeSttLeaseRef.current = null;
        captureModeRef.current = null;
        setTranscriptionError(error instanceof Error ? error.message : "Microphone could not start.");
        setVoiceState("error");
      } finally {
        if (prepareSttAbortRef.current === prepareController) prepareSttAbortRef.current = null;
      }
    })();
  }, [
    isListening,
    mode,
    resetTranscript,
    speechRecognitionSupported,
    sttBrowserFallback,
    prepareSttAbortRef,
    releaseSttLeaseBestEffort,
    startListening,
    stopSpeaking,
    voiceRecorder,
    voiceState,
  ]);

  const stopRecording = useCallback(() => {
    if (voiceState !== "recording") return;
    if (captureModeRef.current === "whisper") {
      void finishWhisperRecording();
      return;
    }
    voiceSessionDurationMsRef.current = recordingSeconds * 1000;
    stopListening();
    setVoiceState("stopping");
  }, [finishWhisperRecording, recordingSeconds, stopListening, voiceState]);

  const cancelVoice = useCallback((reason = "escape") => {
    sendingVoiceRef.current = false;
    voiceCycleRef.current += 1;
    prepareSttAbortRef.current?.abort();
    prepareSttAbortRef.current = null;
    transcribeAbortRef.current?.abort();
    transcribeAbortRef.current = null;
    if (captureModeRef.current === "whisper") voiceRecorder.cancelRecording();
    releaseSttLeaseBestEffort(activeSttLeaseRef.current, reason);
    activeSttLeaseRef.current = null;
    captureModeRef.current = null;
    cancelListening();
    resetTranscript();
    voiceSessionDurationMsRef.current = 0;
    setRecordingSeconds(0);
    setTranscriptionError(null);
    setVoiceState("idle");
  }, [cancelListening, releaseSttLeaseBestEffort, resetTranscript, voiceRecorder]);

  const resetVoiceComposer = useCallback(() => {
    captureModeRef.current = null;
    voiceDraftValueRef.current = "";
    voiceDurationMsRef.current = 0;
    voiceSessionDurationMsRef.current = 0;
    voiceSessionBaseRef.current = "";
    shouldFocusVoiceDraftRef.current = false;
    setVoiceDraft("");
    setRecordingSeconds(0);
    setTranscriptionError(null);
    resetTranscript();
  }, [resetTranscript]);

  const clearUnsentVoiceDraft = useCallback(() => {
    resetVoiceComposer();
    setVoiceState("idle");
  }, [resetVoiceComposer]);

  const handleVoiceEscape = useCallback(() => {
    const activeVoiceLifecycle = ["preparing", "recording", "stopping", "processing"].includes(voiceState);
    if (activeVoiceLifecycle) {
      cancelVoice("escape");
      return;
    }
    if (mode === "voice" && voiceDraftValueRef.current.trim()) clearUnsentVoiceDraft();
  }, [cancelVoice, clearUnsentVoiceDraft, mode, voiceState]);

  const handleBackToPersonas = useCallback(() => {
    cancelVoice("navigation");
    onBackToPersonas?.();
  }, [cancelVoice, onBackToPersonas]);

  useEffect(() => () => {
    voiceCycleRef.current += 1;
    prepareSttAbortRef.current?.abort();
    transcribeAbortRef.current?.abort();
    releaseSttLeaseBestEffort(activeSttLeaseRef.current, "component-cleanup");
    activeSttLeaseRef.current = null;
  }, [releaseSttLeaseBestEffort]);

  const toggleRecording = useCallback(() => {
    if (voiceState === "recording") stopRecording();
    else if (voiceState === "idle" || voiceState === "error") startRecording();
  }, [startRecording, stopRecording, voiceState]);

  const handleModeChange = useCallback(
    (nextMode: ComposerMode) => {
      if (nextMode === mode) return;
      if (["preparing", "recording", "stopping", "processing"].includes(voiceState)) cancelVoice("mode-switch");
      if (nextMode === "text") stopSpeaking();
      setMode(nextMode);
    },
    [cancelVoice, mode, stopSpeaking, voiceState],
  );

  const startNewConversation = useCallback(() => {
    stopSpeaking();

    if (["preparing", "recording", "stopping", "processing"].includes(voiceState)) cancelVoice("navigation");

    setConversationId(null);
    setMessages([]);

    setInput("");

    voiceDraftValueRef.current = "";
    voiceDurationMsRef.current = 0;
    voiceSessionDurationMsRef.current = 0;
    setVoiceDraft("");
    setRecordingSeconds(0);
    resetTranscript();
    setVoiceState("idle");

    setDrawer(null);
  }, [cancelVoice, resetTranscript, stopSpeaking, voiceState]);

  useVoiceSpaceShortcut(
    mode === "voice",
    voiceState === "recording",
    voiceState === "idle" || voiceState === "error",
    startRecording,
    stopRecording,
    handleVoiceEscape,
    ["preparing", "recording", "stopping", "processing"].includes(voiceState) || Boolean(voiceDraft.trim()),
  );

  const openHistoryConversation = useCallback(
    async (conversation: ConversationSummary) => {
      cancelVoice("navigation");
      setOpeningConversationId(conversation.id);

      setHistoryError(null);

      try {
        stopSpeaking();

        const data = await getConversationMessages(conversation.id);

        const restoredMessages: Message[] = data.messages.map((message) => ({
          id: message.id,

          role: message.role === "assistant" ? "alex" : "you",

          text: message.content,

          voice: message.message_type === "voice",

          translation: message.translation || undefined,

        }));

        setMessages(restoredMessages);

        setConversationId(data.conversation.id);

        setMode(data.conversation.conversation_mode);

        setInput("");

        setRecordingSeconds(0);

        setVoiceState("idle");

        setDrawer(null);
      } catch (error) {
        console.error("Failed to open conversation:", error);

        setHistoryError("Couldn't open this conversation.");
      } finally {
        setOpeningConversationId(null);
      }
    },
    [cancelVoice, stopSpeaking],
  );

  const translateMessage = useCallback(
    async (messageId: number, force = false) => {
      const message = messages.find((item) => item.id === messageId);
      if (!message || message.role !== "alex" || message.id < 0 || message.translationLoading) return;
      if (message.translation && !force) {
        setMessages((current) => current.map((item) => item.id === messageId ? { ...item, translation: undefined, translationError: undefined } : item));
        return;
      }
      setMessages((current) => current.map((item) => item.id === messageId ? { ...item, translationLoading: true, translationError: undefined } : item));
      try {
        const { translation } = await translateText(messageId, "vi", force);
        setMessages((current) => current.map((item) => item.id === messageId ? { ...item, translation, translationLoading: false } : item));
      } catch (error) {
        console.warn("[translate] Could not translate assistant message:", error);
        setMessages((current) => current.map((item) => item.id === messageId ? { ...item, translationLoading: false, translationError: "Couldn't translate. Try again." } : item));
      }
    },
    [messages],
  );

  const effectiveVoiceState: VoiceState =
    voiceState !== "idle" ? voiceState : isSynthesizing ? "synthesizing" : isSpeaking ? "speaking" : voiceState;
  const recognitionPreview = joinVoiceText(finalTranscript, interimTranscript);
  const voicePreview = voiceState === "recording" || voiceState === "stopping"
    ? joinVoiceText(voiceDraft, recognitionPreview)
    : voiceDraft;
  const stateLabel =
    effectiveVoiceState === "recording"
      ? "Listening"
      : effectiveVoiceState === "stopping"
        ? "Finishing your sentence..."
      : effectiveVoiceState === "preparing"
        ? "Preparing voice..."
      : effectiveVoiceState === "sending" || effectiveVoiceState === "thinking"
        ? `${voiceCharacterName} is thinking...`
      : effectiveVoiceState === "synthesizing"
        ? `${voiceCharacterName} is preparing voice...`
      : effectiveVoiceState === "processing"
        ? "Transcribing..."
          : effectiveVoiceState === "streaming"
            ? `${voiceCharacterName} is replying...`
          : effectiveVoiceState === "speaking"
            ? `${voiceCharacterName} is speaking...`
      : effectiveVoiceState === "error"
              ? transcriptionError || speechError || "I didn't catch that clearly. Try again?"
              : mode === "voice"
                ? voiceDraft.trim() ? "Review your message" : "Tap to speak"
                : "Text mode";
  return (
    <>
      <ChatShell
        assistantName={assistantName}
        personaSlug={personaSlug}
        messages={messages}
        messagesEndRef={messagesEndRef}
        effectiveVoiceState={effectiveVoiceState}
        stateLabel={stateLabel}
        mode={mode}
        input={input}
        setInput={setInput}
        recordingSeconds={recordingSeconds}
        voiceDraft={voiceDraft}
        voicePreview={voicePreview}
        voiceDraftRef={voiceDraftTextareaRef}
        onVoiceDraftChange={handleVoiceDraftChange}
        level={level}
        levelOpen={levelOpen}
        setLevelOpen={setLevelOpen}
        onLevelChange={handleLevelChange}
        onModeChange={handleModeChange}
        onSend={(value, fromVoice) => void sendMessage(value, fromVoice)}
        onToggleRecording={toggleRecording}
        onTranslate={(messageId) => void translateMessage(messageId)}
        onSpeak={speak}
        speechSupported={speechSupported}
        onSettings={() => setDrawer("settings")}
        onBackToPersonas={handleBackToPersonas}
        voiceCharacterName={voiceCharacterName}
      />
      <Drawer
        drawer={drawer}
        onClose={() => setDrawer(null)}
        level={level}
        onLevelChange={handleLevelChange}
        settingsError={settingsError}
        speechSupported={speechSupported}
        selectedVoiceName={selectedVoiceName}
        onVoiceChange={selectVoice}
        voiceCandidates={voiceCandidates}
        voiceRate={voiceRate}
        onVoiceRateChange={setVoiceRate}
        onPreviewVoice={previewVoice}
        personaName={assistantName}
        personaSlug={personaSlug}
        voiceStyle={personaVoiceProfile.style}
        conversations={historyConversations}
        historyLoading={historyLoading}
        historyError={historyError}
        currentConversationId={conversationId}
        openingConversationId={openingConversationId}
        onSelectConversation={openHistoryConversation}
        onNewConversation={startNewConversation}
      />
    </>
  );
  /*
      <div className="app-content">
        <header className="topbar">
          <div className="brand-lockup">
            <span className="brand-symbol">
              <i />
              <i />
              <i />
            </span>
            <div>
              <strong>AI English Friend</strong>
              <span>Your everyday speaking companion</span>
            </div>
          </div>
          <div className="alex-presence">
            <AlexAvatar small />
            <div>
                <strong>{assistantName}</strong>
              <span>
                <i /> Online
              </span>
            </div>
          </div>
          <nav className="top-actions" aria-label="Conversation controls">
            {onBackToPersonas && (
              <button
                type="button"
                className="nav-icon persona-back"
                onClick={onBackToPersonas}
                aria-label="Choose another AI friend"
              >
                <Icon name="arrow" size={16} />
                <span>Friends</span>
              </button>
            )}
            <div
              className="level-wrap"
              onClick={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                className="level-trigger"
                onClick={() => setLevelOpen(!levelOpen)}
              >
                <span>Level</span>
                <b>{level}</b>
                <Icon name="chevron" size={14} />
              </button>
              {levelOpen && (
                <div className="level-menu">
                  {["A1", "A2", "B1", "B2", "C1", "C2"].map((item) => (
                    <button
                      type="button"
                      className={level === item ? "selected" : ""}
                      key={item}
                      onClick={() => {
                        void handleLevelChange(item);
                        setLevelOpen(false);
                      }}
                    >
                      {item}
                      {level === item && <span>Current</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              type="button"
              className="nav-icon"
              onClick={openHistory}
              aria-label="History"
            >
              <Icon name="history" size={18} />
              <span>History</span>
            </button>
            <button
              type="button"
              className="nav-icon"
              onClick={() => setDrawer("settings")}
              aria-label="Settings"
            >
              <Icon name="settings" size={18} />
              <span>Settings</span>
            </button>
          </nav>
        </header>

        <section className="conversation-stage">
          <div className="conversation-wrap">
            <div className="conversation-heading">
              <div>
                <span className="eyebrow">
                  {conversationId
                    ? `CONVERSATION #${conversationId}`
                    : "NEW CONVERSATION"}
                </span>

                <h1>{conversationTitle}</h1>
              </div>
              <button
                type="button"
                className="quiet-action"
                aria-label="Conversation options"
              >
                <span />
                <span />
                <span />
              </button>
            </div>
            <div className="message-scroll">
              <div className="message-list">
                {messages.map((message) => (
                  <article
                    className={`message message-${message.role}`}
                    key={message.id}
                  >
                    <div className="message-meta">
                      {message.role === "alex" ? (
                        <div className="assistant-author">
                          <AlexAvatar />
                          <strong>{assistantName}</strong>
                          <button
                            type="button"
                            className="message-action replay"
                            aria-label={
                              speechSupported
                                ? isSpeaking
                                  ? `Replay ${assistantName} message`
                                  : `Play ${assistantName} message`
                                : "Text to speech is not supported in this browser"
                            }
                            onClick={() => speak(message.text)}
                            disabled={!speechSupported}
                          >
                            <Icon name="speaker" size={18} />
                            <span>Speak</span>
                          </button>
                        </div>
                      ) : (
                        <>
                          <strong>You</strong>
                          {message.voice && (
                            <span className="voice-tag">
                              <Icon name="mic" size={12} /> Voice
                            </span>
                          )}
                        </>
                      )}
                    </div>
                    {message.role === "alex" ? (
                      <div
                        className={`assistant-content ${message.translation || message.translationLoading || message.translationError ? "has-translation" : ""}`}
                      >
                        <div className="english-copy">
                          <span className="copy-label">English</span>
                          <p>{message.text}</p>
                          {message.correction && (
                            <div className="correction">
                              <strong>Quick note</strong>
                              <span>You said “I go there yesterday.”</span>
                              <em>More natural: “I went there yesterday.”</em>
                            </div>
                          )}
                          <button
                            type="button"
                            className="translate-button"
                             aria-label={`Translate ${assistantName} message`}
                            onClick={() =>
                              void translateMessage(message.id)
                            }
                            disabled={Boolean(message.translationLoading)}
                          >
                            <Icon name="globe" size={16} />
                            <span>
                              {message.translation ? "Translated" : "Translate"}
                            </span>
                          </button>
                        </div>
                        {(message.translation ||
                          message.translationLoading ||
                          message.translationError) && (
                          <aside className="translation-panel">
                            <span className="copy-label">Vietnamese</span>
                            {message.translationLoading ? (
                              <p className="translation-status">
                                 Translating with {assistantName}...
                              </p>
                            ) : message.translationError ? (
                              <p className="translation-status error">
                                {message.translationError}
                              </p>
                            ) : (
                              <p>{message.translation}</p>
                            )}
                          </aside>
                        )}
                      </div>
                    ) : (
                      <>
                        <p>{message.text}</p>
                        {message.correction && (
                          <div className="correction">
                            <strong>Quick note</strong>
                            <span>You said “I go there yesterday.”</span>
                            <em>More natural: “I went there yesterday.”</em>
                          </div>
                        )}
                      </>
                    )}
                  </article>
                ))}
                <div ref={messagesEndRef} aria-hidden="true" />
              </div>
              <div className="starters">
                <span>Keep it going</span>
                {starters.map((starter) => (
                  <button
                    type="button"
                    key={starter}
                    onClick={() => void sendMessage(starter)}
                  >
                    {starter}
                    <Icon name="arrow" size={13} />
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="interaction-dock" aria-label="Conversation input">
          <div
            className={`live-area ${effectiveVoiceState !== "idle" || voiceDraft ? "visible" : ""}`}
          >
            <div className="live-status">
              {effectiveVoiceState === "recording" && (
                <span className="status-dot" />
              )}
              {effectiveVoiceState === "thinking" && (
                <span className="thinking-dots">
                  <i />
                  <i />
                  <i />
                </span>
              )}
              {effectiveVoiceState === "speaking" && (
                <Icon name="wave" size={17} />
              )}
              <strong>{stateLabel}</strong>
              {effectiveVoiceState === "recording" && (
                <time>{formatTime(recordingSeconds)}</time>
              )}
            </div>
            {effectiveVoiceState === "recording" && <p>“{liveTranscript}”</p>}
            {effectiveVoiceState === "processing" && (
              <p className="subtle-line">Give me a second to catch that.</p>
            )}
            {effectiveVoiceState === "thinking" && (
              <p className="subtle-line">Finding the right words...</p>
            )}
            {effectiveVoiceState === "speaking" && (
              <p className="subtle-line">
                 {assistantName} is speaking. You can start the next turn when they finish.
              </p>
            )}
            {effectiveVoiceState === "error" && (
              <p className="subtle-line">Want to try that one more time?</p>
            )}
            {voiceDraft && effectiveVoiceState === "idle" && (
              <p className="subtle-line">
                Review the transcript, correct anything you heard wrong, then
                send it.
              </p>
            )}
          </div>
          <div className="dock-main">
            <div className="dock-hint">
              <Icon name="sparkle" size={16} />
              <span>
                {mode === "voice"
                  ? "Press Space or tap the mic to speak"
                  : "Type naturally and press Enter to send"}
              </span>
            </div>
            <div
              className={`composer-center ${mode === "text" || voiceDraft ? "has-field" : ""}`}
            >
              {mode === "voice" ? (
                voiceDraft ? (
                  <div className="voice-review">
                    <textarea
                      value={voiceDraft}
                      onChange={(event) => onVoiceDraftChange(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && !event.shiftKey) {
                          event.preventDefault();
                          if (voiceDraft.trim() && !["preparing", "recording", "stopping", "processing", "sending", "thinking", "streaming"].includes(effectiveVoiceState)) {
                            void sendMessage(voiceDraft, true);
                          }
                        }
                      }}
                      placeholder="Review your transcript..."
                      aria-label="Review voice transcript"
                      rows={2}
                    />
                    <button
                      type="button"
                      className="composer-send"
                      onClick={() => void sendMessage(voiceDraft, true)}
                      disabled={!voiceDraft.trim() || voiceState === "thinking" || voiceState === "streaming"}
                      aria-label="Send voice transcript"
                    >
                      <Icon name="send" size={17} />
                    </button>
                  </div>
                ) : (
                  <VoiceButton
                    state={effectiveVoiceState}
                    onClick={toggleRecording}
                  />
                )
              ) : (
                <div className="composer">
                  <textarea
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        void sendMessage();
                      }
                    }}
                    placeholder="Type something..."
                    aria-label="Type a message"
                    rows={1}
                  />
                  <button
                    type="button"
                    className="composer-send"
                    onClick={() => void sendMessage()}
                    disabled={!input.trim() || voiceState === "thinking"}
                    aria-label="Send message"
                  >
                    <Icon name="send" size={17} />
                  </button>
                </div>
              )}
            </div>
            <div className="composer-controls">
              <ModeSwitch mode={mode} onChange={handleModeChange} />
              {mode === "voice" && !voiceDraft && (
                <div className="voice-label">
                  <strong>
                    {effectiveVoiceState === "recording"
                      ? "Recording"
                      : "Voice mode"}
                  </strong>
                  <span>
                    {effectiveVoiceState === "recording"
                      ? formatTime(recordingSeconds)
                      : "Space to toggle"}
                  </span>
                </div>
              )}
            </div>
          </div>
        </section>
        <p className="bottom-note">
          Conversation, not classroom <span>·</span> Companion, not teacher
        </p>
      </div>
      <Drawer
        drawer={drawer}
        onClose={() => setDrawer(null)}
        level={level}
        onLevelChange={handleLevelChange}
        settingsError={settingsError}
        speechSupported={speechSupported}
        voices={voices}
        selectedVoiceName={selectedVoiceName}
        onVoiceChange={selectVoice}
        conversations={historyConversations}
        historyLoading={historyLoading}
        historyError={historyError}
        currentConversationId={conversationId}
        openingConversationId={openingConversationId}
        onSelectConversation={openHistoryConversation}
        onNewConversation={startNewConversation}
      />
    </main>
  );
  */
}
