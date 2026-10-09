import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PersonaVoiceProfile } from '../personaConfig'

const voiceStoragePrefix = 'ai-english-friend.voice.'
const rateStoragePrefix = 'ai-english-friend.voice-rate.'
const maleVoiceHints = ['david', 'daniel', 'george', 'james', 'guy', 'mark', 'alex', 'ryan', 'fred', 'tom']
const femaleVoiceHints = ['zira', 'samantha', 'victoria', 'ava', 'emma', 'aria', 'jenny', 'susan', 'hazel', 'karen', 'katie']

function cleanSpeechText(text: string) {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[*_~`>#-]/g, ' ')
    .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, ' ')
    .replace(/[^\p{L}\p{N}\s.,!?;:'"()-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function readStoredVoice(personaSlug: string) {
  if (typeof window === 'undefined') return ''
  try {
    return window.localStorage.getItem(`${voiceStoragePrefix}${personaSlug}`) || ''
  } catch {
    return ''
  }
}

function storeVoice(personaSlug: string, name: string) {
  try {
    const key = `${voiceStoragePrefix}${personaSlug}`
    if (name) window.localStorage.setItem(key, name)
    else window.localStorage.removeItem(key)
  } catch {
    // Voice selection still works for the current session if storage is unavailable.
  }
}

function readStoredRate(personaSlug: string, fallback: number) {
  if (typeof window === 'undefined') return fallback
  try {
    const stored = Number(window.localStorage.getItem(`${rateStoragePrefix}${personaSlug}`))
    return Number.isFinite(stored) ? Math.min(1.25, Math.max(0.75, stored)) : fallback
  } catch {
    return fallback
  }
}

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
  return [...new Map(pool.map((voice) => [voice.name, voice])).values()]
    .sort((left, right) => {
      const score = (voice: SpeechSynthesisVoice) => {
        const name = voice.name.toLowerCase()
        const gender = classifyVoiceGender(voice)
        const genderScore = gender === profile.gender ? 100 : gender === null ? 20 : -40
        const hintScore = profile.nameHints.some((hint) => name.includes(hint)) ? 30 : 0
        const localScore = voice.localService ? 5 : 0
        return genderScore + hintScore + localScore + localeScore(voice.lang)
      }
      return score(right) - score(left)
    })
    .slice(0, 5)
}

export function useLegacySpeechSynthesis(personaSlug = 'thoughtful', profile: PersonaVoiceProfile) {
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const [selectedVoiceState, setSelectedVoiceState] = useState(() => ({ personaSlug, name: readStoredVoice(personaSlug) }))
  const [voiceRateState, setVoiceRateState] = useState(() => ({ personaSlug, value: readStoredRate(personaSlug, profile.preferredRate) }))
  const [isSpeaking, setIsSpeaking] = useState(false)
  const activeUtterance = useRef<SpeechSynthesisUtterance | null>(null)
  const voiceCandidates = useMemo(() => rankVoiceCandidates(voices, profile), [profile, voices])
  const selectedVoiceName = useMemo(() => {
    const stored = readStoredVoice(personaSlug)
    const current = selectedVoiceState.personaSlug === personaSlug ? selectedVoiceState.name : stored
    if (current && voiceCandidates.some((voice) => voice.name === current)) return current
    return voiceCandidates[0]?.name || current || ''
  }, [personaSlug, selectedVoiceState, voiceCandidates])
  const voiceRate = voiceRateState.personaSlug === personaSlug ? voiceRateState.value : readStoredRate(personaSlug, profile.preferredRate)

  const loadVoices = useCallback(() => {
    if (!supported) return
    const nextVoices = window.speechSynthesis.getVoices()
    setVoices(nextVoices)
  }, [supported])

  useEffect(() => {
    if (!supported) return

    const synthesis = window.speechSynthesis
    const initialLoad = window.setTimeout(loadVoices, 0)
    synthesis.addEventListener('voiceschanged', loadVoices)

    return () => {
      window.clearTimeout(initialLoad)
      synthesis.cancel()
      activeUtterance.current = null
      synthesis.removeEventListener('voiceschanged', loadVoices)
    }
  }, [loadVoices, supported])

  const selectVoice = useCallback((name: string) => {
    setSelectedVoiceState({ personaSlug, name })
    storeVoice(personaSlug, name)
  }, [personaSlug])

  const setVoiceRate = useCallback((nextRate: number) => {
    const safeRate = Math.min(1.25, Math.max(0.75, Math.round(nextRate * 20) / 20))
    setVoiceRateState({ personaSlug, value: safeRate })
    try {
      window.localStorage.setItem(`${rateStoragePrefix}${personaSlug}`, String(safeRate))
    } catch {
      // Voice rate still applies for the current session if storage is unavailable.
    }
  }, [personaSlug])

  const speak = useCallback((text: string) => {
    if (!supported) return

    const cleanText = cleanSpeechText(text)
    if (!cleanText) return

    const synthesis = window.speechSynthesis
    synthesis.cancel()

    const utterance = new SpeechSynthesisUtterance(cleanText)
    activeUtterance.current = utterance
    utterance.lang = 'en-US'
    utterance.rate = 0.95
    utterance.pitch = 1
    utterance.volume = 1

    const availableVoices = voices.length > 0 ? voices : synthesis.getVoices()
    const selectedVoice = availableVoices.find((voice) => voice.name === selectedVoiceName)
      ?? voiceCandidates[0]
    if (selectedVoice) utterance.voice = selectedVoice
    utterance.rate = voiceRate

    const clearActiveUtterance = () => {
      if (activeUtterance.current === utterance) {
        activeUtterance.current = null
        setIsSpeaking(false)
      }
    }
    utterance.onstart = () => {
      if (activeUtterance.current === utterance) setIsSpeaking(true)
    }
    utterance.onend = clearActiveUtterance
    utterance.onerror = clearActiveUtterance
    synthesis.speak(utterance)
  }, [selectedVoiceName, supported, voiceCandidates, voices, voiceRate])

  const stop = useCallback(() => {
    if (!supported) return
    window.speechSynthesis.cancel()
    activeUtterance.current = null
    setIsSpeaking(false)
  }, [supported])

  const pause = useCallback(() => {
    if (supported) window.speechSynthesis.pause()
  }, [supported])

  const resume = useCallback(() => {
    if (supported) window.speechSynthesis.resume()
  }, [supported])

  const getAvailableVoices = useCallback(() => {
    if (!supported) return []
    return voices.length > 0 ? voices : window.speechSynthesis.getVoices()
  }, [supported, voices])

  return {
    supported,
    voices,
    selectedVoiceName,
    selectedVoice: voices.find((voice) => voice.name === selectedVoiceName) ?? voiceCandidates[0],
    voiceCandidates,
    voiceRate,
    isSpeaking,
    speak,
    previewVoice: () => speak("Hey, it's good to talk with you."),
    stop,
    pause,
    resume,
    selectVoice,
    setVoiceRate,
    getAvailableVoices,
  }
}

// Keep the established import path compatible while the expressive controller
// remains the single active implementation.
export {
  getVoiceCharacterName,
  inferSpeechMood,
  useKokoroSpeechSynthesis as useSpeechSynthesis,
} from './useKokoroSpeechSynthesis'
export type { VoiceCandidate, SpeechContext, SpeechMood } from './useKokoroSpeechSynthesis'
