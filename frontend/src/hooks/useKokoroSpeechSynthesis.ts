import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getTtsHealth, getTtsVoices, synthesizeTts, type TtsVoice } from '../services/api'
import type { PersonaVoiceProfile } from '../personaConfig'

const voiceStoragePrefix = 'ai-english-friend.kokoro-voice.'
const rateStoragePrefix = 'ai-english-friend.kokoro-rate.'
const TTS_RECOVERY_RETRY_MS = 4000

export type VoiceCandidate = {
  id?: string
  name: string
  label?: string
  lang: string
  source?: 'kokoro' | 'browser'
  browserVoice?: SpeechSynthesisVoice
}

export function getVoiceCharacterName(voice: Pick<{ name: string }, 'name'> | string | null | undefined, fallback = '') {
  const rawName = typeof voice === 'string' ? voice : voice?.name || ''
  const cleaned = rawName.replace(/^(?:af|am|bf|bm)_/i, '').replace(/[._-]+/g, ' ').replace(/\([^)]*\)/g, '')
    .split(/\s+-\s+/)[0].replace(/^\s*(Microsoft|Google|Apple|Amazon)\s+/i, '')
    .replace(/\b(Online|Natural|Desktop|Mobile|Enhanced|Premium|Compact|Multilingual)\b/gi, '')
    .replace(/\s+/g, ' ').trim()
  if (!cleaned || /^(default|default voice|english|us english|en[- ]us)$/i.test(cleaned)) return fallback
  return cleaned.replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export type SpeechMood = 'neutral' | 'positive' | 'excited' | 'supportive' | 'sad' | 'serious' | 'reflective'
export type SpeechContext = { userMessage?: string; assistantReply?: string }

function cleanSpeechText(text: string) {
  return text.replace(/```[\s\S]*?```/g, ' ').replace(/[*_~`>#-]/g, ' ')
    .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, ' ')
    .replace(/[^\p{L}\p{N}\s.,!?;:'"()-]/gu, ' ').replace(/\s+/g, ' ').trim()
}

function readStoredVoice(personaSlug: string) {
  if (typeof window === 'undefined') return ''
  try { return window.localStorage.getItem(`${voiceStoragePrefix}${personaSlug}`) || '' } catch { return '' }
}

function storeVoice(personaSlug: string, voiceId: string) {
  try {
    const key = `${voiceStoragePrefix}${personaSlug}`
    if (voiceId) window.localStorage.setItem(key, voiceId)
    else window.localStorage.removeItem(key)
  } catch { /* session-only fallback */ }
}

function readStoredRate(personaSlug: string, fallback: number) {
  if (typeof window === 'undefined') return fallback
  try {
    const stored = Number(window.localStorage.getItem(`${rateStoragePrefix}${personaSlug}`))
    return Number.isFinite(stored) ? Math.min(1.25, Math.max(0.75, stored)) : fallback
  } catch { return fallback }
}

function clamp(value: number, min: number, max: number) { return Math.min(max, Math.max(min, value)) }

const maleVoiceHints = ['david', 'daniel', 'george', 'james', 'guy', 'mark', 'alex', 'ryan', 'fred', 'tom']
const femaleVoiceHints = ['zira', 'samantha', 'victoria', 'ava', 'emma', 'aria', 'jenny', 'susan', 'hazel', 'karen', 'katie']

function classifyVoiceGender(voice: SpeechSynthesisVoice): PersonaVoiceProfile['gender'] | null {
  const name = voice.name.toLowerCase()
  const male = maleVoiceHints.some((hint) => name.includes(hint))
  const female = femaleVoiceHints.some((hint) => name.includes(hint))
  if (male === female) return null
  return male ? 'male' : 'female'
}

function localeScore(lang: string) {
  const normalized = lang.toLowerCase()
  if (normalized === 'en-us') return 50
  if (normalized === 'en-gb') return 42
  if (normalized === 'en-au') return 36
  if (normalized.startsWith('en-')) return 28
  return 0
}

function rankBrowserVoices(voices: SpeechSynthesisVoice[], profile: PersonaVoiceProfile): VoiceCandidate[] {
  const englishVoices = voices.filter((voice) => voice.lang.toLowerCase().startsWith('en'))
  const classifiedMatches = englishVoices.filter((voice) => classifyVoiceGender(voice) === profile.gender)
  const unknownVoices = englishVoices.filter((voice) => classifyVoiceGender(voice) === null)
  const pool = classifiedMatches.length > 0 ? [...classifiedMatches, ...unknownVoices] : unknownVoices.length > 0 ? unknownVoices : englishVoices
  return [...new Map(pool.map((voice) => [voice.name, voice])).values()].sort((left, right) => {
    const score = (voice: SpeechSynthesisVoice) => {
      const name = voice.name.toLowerCase()
      const gender = classifyVoiceGender(voice)
      const genderScore = gender === profile.gender ? 100 : gender === null ? 20 : -40
      const hintScore = profile.nameHints.some((hint) => name.includes(hint)) ? 30 : 0
      return genderScore + hintScore + (voice.localService ? 5 : 0) + localeScore(voice.lang)
    }
    return score(right) - score(left)
  }).slice(0, 5).map((voice) => ({ name: voice.name, lang: voice.lang || 'en-US', source: 'browser' as const, browserVoice: voice }))
}

function mapKokoroVoice(voice: TtsVoice): VoiceCandidate {
  return { id: voice.id, name: voice.label || voice.id, lang: voice.language || 'en-US', source: 'kokoro' }
}

const moodKeywords: Record<Exclude<SpeechMood, 'neutral'>, string[]> = {
  sad: ['sad', 'upset', 'lonely', 'hurt', 'cry', 'crying', 'exhausted', 'awful', 'terrible', 'bad day', 'worried'],
  excited: ['wow', 'amazing', 'incredible', 'excited', 'yay', "can't wait", 'awesome'],
  supportive: ['help me', 'struggling', 'difficult', 'hard for me', 'need help', 'thank you', 'thanks', 'sorry'],
  serious: ['important', 'serious', 'problem', 'mistake', 'deadline', 'urgent', 'concern'],
  reflective: ['i think', 'i wonder', 'meaning', 'why do', 'how do i feel', 'maybe', 'thoughts'],
  positive: ['happy', 'great', 'good news', 'love', 'enjoy', 'proud', 'glad', 'better'],
}

export function inferSpeechMood({ userMessage = '', assistantReply = '', personaSlug = '' }: SpeechContext & { personaSlug?: string }): SpeechMood {
  const text = `${userMessage} ${assistantReply}`.toLowerCase()
  const match = (mood: Exclude<SpeechMood, 'neutral'>) => moodKeywords[mood].some((keyword) => text.includes(keyword))
  if (match('sad')) return 'sad'
  if (match('excited') || (text.includes('!') && match('positive'))) return 'excited'
  if (match('supportive')) return 'supportive'
  if (match('serious')) return 'serious'
  if (match('reflective')) return 'reflective'
  if (match('positive')) return 'positive'
  if (personaSlug === 'empathetic' && /\b(hear|understand|with you|here for you)\b/.test(text)) return 'supportive'
  return 'neutral'
}

function getMoodRate(mood: SpeechMood) {
  if (mood === 'excited') return 1.06
  if (mood === 'positive') return 1.03
  if (mood === 'supportive') return 0.94
  if (mood === 'sad') return 0.9
  if (mood === 'serious') return 0.95
  if (mood === 'reflective') return 0.93
  return 1
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
}

export function useKokoroSpeechSynthesis(personaSlug = 'thoughtful', profile: PersonaVoiceProfile, browserFallback = true) {
  const browserSupported = typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window
  const [browserVoices, setBrowserVoices] = useState<SpeechSynthesisVoice[]>([])
  const [kokoroVoices, setKokoroVoices] = useState<TtsVoice[]>([])
  const [kokoroAvailable, setKokoroAvailable] = useState(false)
  const [selectedVoiceState, setSelectedVoiceState] = useState(() => ({ personaSlug, name: readStoredVoice(personaSlug) }))
  const [voiceRateState, setVoiceRateState] = useState(() => ({ personaSlug, value: readStoredRate(personaSlug, profile.preferredRate) }))
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [isSynthesizing, setIsSynthesizing] = useState(false)
  const activeAudio = useRef<HTMLAudioElement | null>(null)
  const activeAudioUrl = useRef<string | null>(null)
  const activeUtterance = useRef<SpeechSynthesisUtterance | null>(null)
  const activeAbort = useRef<AbortController | null>(null)
  const sequenceToken = useRef(0)
  const mountedRef = useRef(true)
  const kokoroAvailableRef = useRef(false)
  const kokoroVoicesRef = useRef<TtsVoice[]>([])
  const recoveryInFlightRef = useRef<Promise<boolean> | null>(null)
  const nextRecoveryAttemptRef = useRef(0)

  const refreshKokoro = useCallback(async (force = false) => {
    if (kokoroAvailableRef.current && kokoroVoicesRef.current.length > 0) return true
    if (recoveryInFlightRef.current) return recoveryInFlightRef.current
    if (!force && Date.now() < nextRecoveryAttemptRef.current) return false
    nextRecoveryAttemptRef.current = Date.now() + TTS_RECOVERY_RETRY_MS
    const recovery = (async () => {
      try {
        const health = await getTtsHealth()
        if (!health.available) return false
        const voices = await getTtsVoices()
        const americanVoices = voices.filter((voice) => /^(?:af|am)_/i.test(voice.id))
        if (!mountedRef.current || americanVoices.length === 0) return false
        kokoroVoicesRef.current = americanVoices
        setKokoroVoices(americanVoices)
        kokoroAvailableRef.current = true
        setKokoroAvailable(true)
        nextRecoveryAttemptRef.current = 0
        return true
      } catch (error) {
        if (mountedRef.current) console.warn('[tts] Kokoro recovery check failed:', error)
        kokoroAvailableRef.current = false
        if (mountedRef.current) setKokoroAvailable(false)
        return false
      }
    })()
    recoveryInFlightRef.current = recovery
    try {
      return await recovery
    } finally {
      if (recoveryInFlightRef.current === recovery) recoveryInFlightRef.current = null
    }
  }, [])

  const loadBrowserVoices = useCallback(() => {
    if (browserSupported) setBrowserVoices(window.speechSynthesis.getVoices())
  }, [browserSupported])

  useEffect(() => {
    if (!browserSupported) return
    const synthesis = window.speechSynthesis
    const initialLoad = window.setTimeout(loadBrowserVoices, 0)
    synthesis.addEventListener('voiceschanged', loadBrowserVoices)
    return () => {
      window.clearTimeout(initialLoad)
      synthesis.removeEventListener('voiceschanged', loadBrowserVoices)
    }
  }, [browserSupported, loadBrowserVoices])

  useEffect(() => {
    mountedRef.current = true
    void refreshKokoro(true)
    return () => { mountedRef.current = false }
  }, [personaSlug, refreshKokoro])

  const voiceCandidates = useMemo<VoiceCandidate[]>(() => {
    if (kokoroAvailable && kokoroVoices.length > 0) return kokoroVoices.map(mapKokoroVoice)
    return browserFallback ? rankBrowserVoices(browserVoices, profile) : []
  }, [browserFallback, browserVoices, kokoroAvailable, kokoroVoices, profile])
  const defaultVoiceId = profile.kokoroVoice || 'am_michael'
  const selectedVoiceName = useMemo(() => {
    const stored = readStoredVoice(personaSlug)
    const current = selectedVoiceState.personaSlug === personaSlug ? selectedVoiceState.name : stored
    if (kokoroAvailable) return kokoroVoices.some((voice) => voice.id === current) ? current : (kokoroVoices.some((voice) => voice.id === defaultVoiceId) ? defaultVoiceId : kokoroVoices[0]?.id || defaultVoiceId)
    if (current && voiceCandidates.some((voice) => voice.name === current)) return current
    return voiceCandidates[0]?.name || ''
  }, [defaultVoiceId, kokoroAvailable, kokoroVoices, personaSlug, selectedVoiceState, voiceCandidates])
  const voiceRate = voiceRateState.personaSlug === personaSlug ? voiceRateState.value : readStoredRate(personaSlug, profile.preferredRate)
  const supported = kokoroAvailable || browserSupported

  const releaseAudio = useCallback(() => {
    const audio = activeAudio.current
    if (audio) {
      audio.onended = null
      audio.onerror = null
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
    }
    activeAudio.current = null
    if (activeAudioUrl.current) URL.revokeObjectURL(activeAudioUrl.current)
    activeAudioUrl.current = null
  }, [])

  const stop = useCallback(() => {
    sequenceToken.current += 1
    activeAbort.current?.abort()
    activeAbort.current = null
    releaseAudio()
    if (browserSupported) {
      window.speechSynthesis.cancel()
      activeUtterance.current = null
    }
    setIsSpeaking(false)
    setIsSynthesizing(false)
  }, [browserSupported, releaseAudio])

  const speakWithBrowser = useCallback((text: string, context: SpeechContext, token: number) => {
    if (!browserSupported || !browserFallback || sequenceToken.current !== token) return
    const synthesis = window.speechSynthesis
    synthesis.cancel()
    const mood = inferSpeechMood({ ...context, assistantReply: context.assistantReply || text, personaSlug })
    const selected = browserVoices.find((voice) => voice.name === selectedVoiceName) || browserVoices[0]
    const utterance = new SpeechSynthesisUtterance(text)
    activeUtterance.current = utterance
    utterance.lang = 'en-US'
    utterance.rate = clamp(voiceRate * getMoodRate(mood), 0.75, 1.25)
    utterance.pitch = clamp(profile.preferredPitch, 0.85, 1.15)
    utterance.volume = clamp(profile.preferredVolume, 0.75, 1)
    if (selected) utterance.voice = selected
    utterance.onstart = () => { if (sequenceToken.current === token) setIsSpeaking(true) }
    const finish = () => {
      if (sequenceToken.current !== token) return
      activeUtterance.current = null
      setIsSpeaking(false)
    }
    utterance.onend = finish
    utterance.onerror = finish
    setIsSynthesizing(false)
    synthesis.speak(utterance)
  }, [browserFallback, browserSupported, browserVoices, personaSlug, profile.preferredPitch, profile.preferredVolume, selectedVoiceName, voiceRate])

  const speak = useCallback((text: string, context: SpeechContext = {}) => {
    const cleanText = cleanSpeechText(text)
    if (!cleanText) return
    stop()
    const token = sequenceToken.current
    const mood = inferSpeechMood({ ...context, assistantReply: context.assistantReply || cleanText, personaSlug })
    const runSpeech = async () => {
      let useKokoro = kokoroAvailableRef.current && kokoroVoicesRef.current.length > 0
      if (!useKokoro) useKokoro = await refreshKokoro()
      if (sequenceToken.current !== token) return
      const voiceId = /^(?:af|am)_/i.test(selectedVoiceName) ? selectedVoiceName : (profile.kokoroVoice || 'am_michael')
      if (useKokoro && voiceId) {
      const controller = new AbortController()
      activeAbort.current = controller
      setIsSynthesizing(true)
      void synthesizeTts(cleanText, voiceId, clamp(voiceRate * getMoodRate(mood), 0.75, 1.25), 'en-us', controller.signal)
        .then(async ({ audio }) => {
          if (sequenceToken.current !== token || controller.signal.aborted) return
          const url = URL.createObjectURL(audio)
          activeAudioUrl.current = url
          const player = new Audio(url)
          activeAudio.current = player
          player.onended = () => {
            if (sequenceToken.current !== token) return
            releaseAudio()
            setIsSpeaking(false)
          }
          player.onerror = () => {
            if (sequenceToken.current !== token) return
            releaseAudio()
            setIsSpeaking(false)
            console.warn('[tts] Kokoro audio playback failed; browser fallback is available')
          }
          setIsSynthesizing(false)
          setIsSpeaking(true)
          try {
            await player.play()
          } catch (error) {
            if (sequenceToken.current !== token) return
            releaseAudio()
            setIsSpeaking(false)
            console.warn('[tts] Kokoro audio playback was blocked:', error)
          }
        })
        .catch((error) => {
          if (sequenceToken.current !== token || isAbortError(error)) return
          setIsSynthesizing(false)
          kokoroAvailableRef.current = false
          setKokoroAvailable(false)
          nextRecoveryAttemptRef.current = Date.now() + TTS_RECOVERY_RETRY_MS
          console.warn('[tts] Kokoro synthesis failed; using browser fallback:', error)
          speakWithBrowser(cleanText, context, token)
        })
        return
      }
      setIsSynthesizing(false)
      if (!browserFallback) {
        console.warn('[tts] Kokoro is unavailable and browser fallback is disabled')
        return
      }
      speakWithBrowser(cleanText, context, token)
    }
    void runSpeech()
  }, [browserFallback, personaSlug, profile.kokoroVoice, refreshKokoro, releaseAudio, selectedVoiceName, speakWithBrowser, stop, voiceRate])

  const selectVoice = useCallback((name: string) => {
    setSelectedVoiceState({ personaSlug, name })
    storeVoice(personaSlug, name)
  }, [personaSlug])
  const setVoiceRate = useCallback((nextRate: number) => {
    const safeRate = Math.min(1.25, Math.max(0.75, Math.round(nextRate * 20) / 20))
    setVoiceRateState({ personaSlug, value: safeRate })
    try { window.localStorage.setItem(`${rateStoragePrefix}${personaSlug}`, String(safeRate)) } catch { /* session-only fallback */ }
  }, [personaSlug])
  const pause = useCallback(() => {
    if (activeAudio.current) activeAudio.current.pause()
    else if (browserSupported) window.speechSynthesis.pause()
  }, [browserSupported])
  const resume = useCallback(() => {
    if (activeAudio.current) void activeAudio.current.play()
    else if (browserSupported) window.speechSynthesis.resume()
  }, [browserSupported])

  useEffect(() => () => {
    sequenceToken.current += 1
    activeAbort.current?.abort()
    releaseAudio()
    if (browserSupported) window.speechSynthesis.cancel()
  }, [browserSupported, releaseAudio])

  return {
    supported,
    voices: browserVoices,
    selectedVoiceName,
    selectedVoice: voiceCandidates.find((voice) => (voice.id || voice.name) === selectedVoiceName) || voiceCandidates[0],
    voiceCandidates,
    voiceRate,
    isSpeaking,
    isSynthesizing,
    speak,
    previewVoice: () => speak("Hey, it's good to talk with you."),
    stop,
    pause,
    resume,
    selectVoice,
    setVoiceRate,
    getAvailableVoices: () => voiceCandidates,
  }
}
