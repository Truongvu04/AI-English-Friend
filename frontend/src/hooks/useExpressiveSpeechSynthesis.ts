import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PersonaVoiceProfile } from '../personaConfig'

const voiceStoragePrefix = 'ai-english-friend.voice.'
const rateStoragePrefix = 'ai-english-friend.voice-rate.'
const maleVoiceHints = ['david', 'daniel', 'george', 'james', 'guy', 'mark', 'alex', 'ryan', 'fred', 'tom']
const femaleVoiceHints = ['zira', 'samantha', 'victoria', 'ava', 'emma', 'aria', 'jenny', 'susan', 'hazel', 'karen', 'katie']

/** Convert a browser voice label into the friendly character name shown in the UI. */
export function getVoiceCharacterName(voice: Pick<SpeechSynthesisVoice, 'name'> | string | null | undefined, fallback = '') {
  const rawName = typeof voice === 'string' ? voice : voice?.name || ''
  const cleaned = rawName
    .replace(/\([^)]*\)/g, '')
    .split(/\s+-\s+/)[0]
    .replace(/^\s*(Microsoft|Google|Apple|Amazon)\s+/i, '')
    .replace(/\b(Online|Natural|Desktop|Mobile|Enhanced|Premium|Compact|Multilingual)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!cleaned || /^(default|default voice|english|us english|en[- ]us)$/i.test(cleaned)) return fallback
  return cleaned
}

export type SpeechMood = 'neutral' | 'positive' | 'excited' | 'supportive' | 'sad' | 'serious' | 'reflective'
export type SpeechContext = { userMessage?: string; assistantReply?: string }

function cleanSpeechText(text: string) {
  return text.replace(/```[\s\S]*?```/g, ' ').replace(/[*_~`>#-]/g, ' ').replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, ' ').replace(/[^\p{L}\p{N}\s.,!?;:'"()-]/gu, ' ').replace(/\s+/g, ' ').trim()
}

function readStoredVoice(personaSlug: string) {
  if (typeof window === 'undefined') return ''
  try { return window.localStorage.getItem(`${voiceStoragePrefix}${personaSlug}`) || '' } catch { return '' }
}

function storeVoice(personaSlug: string, name: string) {
  try {
    const key = `${voiceStoragePrefix}${personaSlug}`
    if (name) window.localStorage.setItem(key, name)
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

function rankVoiceCandidates(voices: SpeechSynthesisVoice[], profile: PersonaVoiceProfile) {
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
  }).slice(0, 5)
}

const moodKeywords: Record<Exclude<SpeechMood, 'neutral'>, string[]> = {
  sad: ['sad', 'upset', 'lonely', 'hurt', 'cry', 'crying', 'exhausted', 'awful', 'terrible', 'bad day', 'worried'],
  excited: ['wow', 'amazing', 'incredible', 'excited', 'yay', 'can’t wait', "can't wait", 'awesome'],
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

function splitSpeechSegments(text: string) {
  const protectedText = text.replace(/\b(?:mr|mrs|ms|dr|prof|sr|jr|st|vs|e\.g|i\.e|etc)\./gi, (value) => value.replace('.', '§'))
  const parts = protectedText.match(/[^.!?;:]+[.!?;:]+|[^.!?;:]+$/g) || []
  return parts.map((part) => part.replace(/§/g, '.').trim()).filter(Boolean)
}

function getPauseProfileBase(profile: PersonaVoiceProfile['pauseProfile']) {
  if (profile === 'short') return 115
  if (profile === 'long') return 260
  if (profile === 'medium-long') return 220
  return 155
}

function getSpeechTuning(profile: PersonaVoiceProfile, mood: SpeechMood, punctuation: string) {
  const moodTuning: Record<SpeechMood, { rate: number; pitch: number; volume: number; pause: number }> = {
    neutral: { rate: 1, pitch: 0, volume: 1, pause: 1 }, positive: { rate: 1.03, pitch: 0.02, volume: 1, pause: 0.9 }, excited: { rate: 1.06, pitch: 0.04, volume: 1, pause: 0.8 }, supportive: { rate: 0.94, pitch: -0.01, volume: 0.95, pause: 1.25 }, sad: { rate: 0.9, pitch: -0.03, volume: 0.93, pause: 1.35 }, serious: { rate: 0.95, pitch: -0.02, volume: 1, pause: 1.2 }, reflective: { rate: 0.93, pitch: 0, volume: 1, pause: 1.3 },
  }
  const tuning = moodTuning[mood]
  const punctuationPause = punctuation === '?' ? 1.16 : punctuation === '!' ? 0.72 : punctuation === ';' || punctuation === ':' ? 0.86 : 1
  return { rate: tuning.rate, pitch: tuning.pitch, volume: tuning.volume, pause: clamp(getPauseProfileBase(profile.pauseProfile) * tuning.pause * punctuationPause, 60, 320) }
}

/** @deprecated The active implementation is useKokoroSpeechSynthesis. */
export function useLegacySpeechSynthesis(personaSlug = 'thoughtful', profile: PersonaVoiceProfile) {
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const [selectedVoiceState, setSelectedVoiceState] = useState(() => ({ personaSlug, name: readStoredVoice(personaSlug) }))
  const [voiceRateState, setVoiceRateState] = useState(() => ({ personaSlug, value: readStoredRate(personaSlug, profile.preferredRate) }))
  const [isSpeaking, setIsSpeaking] = useState(false)
  const activeUtterance = useRef<SpeechSynthesisUtterance | null>(null)
  const sequenceToken = useRef(0)
  const pauseTimer = useRef<number | null>(null)
  const voiceCandidates = useMemo(() => rankVoiceCandidates(voices, profile), [profile, voices])
  const selectedVoiceName = useMemo(() => {
    const stored = readStoredVoice(personaSlug)
    const current = selectedVoiceState.personaSlug === personaSlug ? selectedVoiceState.name : stored
    if (current && voiceCandidates.some((voice) => voice.name === current)) return current
    return voiceCandidates[0]?.name || current || ''
  }, [personaSlug, selectedVoiceState, voiceCandidates])
  const voiceRate = voiceRateState.personaSlug === personaSlug ? voiceRateState.value : readStoredRate(personaSlug, profile.preferredRate)

  const loadVoices = useCallback(() => {
    if (supported) setVoices(window.speechSynthesis.getVoices())
  }, [supported])

  useEffect(() => {
    if (!supported) return
    const synthesis = window.speechSynthesis
    const initialLoad = window.setTimeout(loadVoices, 0)
    synthesis.addEventListener('voiceschanged', loadVoices)
    return () => {
      window.clearTimeout(initialLoad)
      if (pauseTimer.current !== null) window.clearTimeout(pauseTimer.current)
      sequenceToken.current += 1
      synthesis.cancel()
      activeUtterance.current = null
      synthesis.removeEventListener('voiceschanged', loadVoices)
    }
  }, [loadVoices, supported])

  const selectVoice = useCallback((name: string) => { setSelectedVoiceState({ personaSlug, name }); storeVoice(personaSlug, name) }, [personaSlug])
  const setVoiceRate = useCallback((nextRate: number) => {
    const safeRate = Math.min(1.25, Math.max(0.75, Math.round(nextRate * 20) / 20))
    setVoiceRateState({ personaSlug, value: safeRate })
    try { window.localStorage.setItem(`${rateStoragePrefix}${personaSlug}`, String(safeRate)) } catch { /* session-only fallback */ }
  }, [personaSlug])

  const stop = useCallback(() => {
    if (!supported) return
    sequenceToken.current += 1
    if (pauseTimer.current !== null) window.clearTimeout(pauseTimer.current)
    pauseTimer.current = null
    window.speechSynthesis.cancel()
    activeUtterance.current = null
    setIsSpeaking(false)
  }, [supported])

  const speak = useCallback((text: string, context: SpeechContext = {}) => {
    if (!supported) return
    const cleanText = cleanSpeechText(text)
    if (!cleanText) return
    const synthesis = window.speechSynthesis
    sequenceToken.current += 1
    const token = sequenceToken.current
    if (pauseTimer.current !== null) window.clearTimeout(pauseTimer.current)
    pauseTimer.current = null
    synthesis.cancel()
    const mood = inferSpeechMood({ ...context, assistantReply: context.assistantReply || cleanText, personaSlug })
    const segments = splitSpeechSegments(cleanText)
    const availableVoices = voices.length > 0 ? voices : synthesis.getVoices()
    const selectedVoice = availableVoices.find((voice) => voice.name === selectedVoiceName) ?? voiceCandidates[0]
    setIsSpeaking(true)

    const speakSegment = (index: number) => {
      if (sequenceToken.current !== token || index >= segments.length) { if (sequenceToken.current === token) setIsSpeaking(false); return }
      const segment = segments[index]
      const tuning = getSpeechTuning(profile, mood, segment.slice(-1))
      const empatheticWarmth = personaSlug === 'empathetic' && mood === 'positive'
        ? { pitch: 0.01, volume: 1.02 }
        : { pitch: 0, volume: 1 }
      const utterance = new SpeechSynthesisUtterance(segment)
      activeUtterance.current = utterance
      utterance.lang = 'en-US'
      utterance.rate = clamp(voiceRate * tuning.rate, 0.75, 1.25)
      utterance.pitch = clamp(profile.preferredPitch + tuning.pitch + empatheticWarmth.pitch, 0.85, 1.15)
      utterance.volume = clamp(profile.preferredVolume * tuning.volume * empatheticWarmth.volume, 0.75, 1)
      if (selectedVoice) utterance.voice = selectedVoice
      const moveForward = () => {
        if (sequenceToken.current !== token) return
        activeUtterance.current = null
        if (index === segments.length - 1) { setIsSpeaking(false); return }
        pauseTimer.current = window.setTimeout(() => { pauseTimer.current = null; speakSegment(index + 1) }, tuning.pause)
      }
      utterance.onstart = () => { if (sequenceToken.current === token) setIsSpeaking(true) }
      utterance.onend = moveForward
      utterance.onerror = moveForward
      synthesis.speak(utterance)
    }
    speakSegment(0)
  }, [personaSlug, profile, selectedVoiceName, supported, voiceCandidates, voices, voiceRate])

  const pause = useCallback(() => { if (supported) window.speechSynthesis.pause() }, [supported])
  const resume = useCallback(() => { if (supported) window.speechSynthesis.resume() }, [supported])
  const getAvailableVoices = useCallback(() => supported ? (voices.length > 0 ? voices : window.speechSynthesis.getVoices()) : [], [supported, voices])

  return { supported, voices, selectedVoiceName, selectedVoice: voices.find((voice) => voice.name === selectedVoiceName) ?? voiceCandidates[0], voiceCandidates, voiceRate, isSpeaking, speak, previewVoice: () => speak("Hey, it's good to talk with you."), stop, pause, resume, selectVoice, setVoiceRate, getAvailableVoices }
}
