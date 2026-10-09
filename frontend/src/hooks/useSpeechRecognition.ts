import { useCallback, useEffect, useRef, useState } from 'react'

type SpeechAlternative = { transcript: string }
type SpeechResult = { isFinal: boolean; length: number; [index: number]: SpeechAlternative }
type SpeechResultEvent = { results: ArrayLike<SpeechResult> }
type SpeechErrorEvent = { error?: string }

interface BrowserSpeechRecognition {
  continuous: boolean
  interimResults: boolean
  lang: string
  onend: (() => void) | null
  onerror: ((event: SpeechErrorEvent) => void) | null
  onresult: ((event: SpeechResultEvent) => void) | null
  onstart: (() => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}

type SpeechRecognitionConstructor = new () => BrowserSpeechRecognition
type SpeechRecognitionWindow = Window & { SpeechRecognition?: SpeechRecognitionConstructor; webkitSpeechRecognition?: SpeechRecognitionConstructor }

const permissionMessage = 'Microphone permission was denied. Please allow microphone access to use voice input.'
const unsupportedMessage = 'Speech recognition is not supported in this browser.'

function getRecognitionConstructor() {
  const speechWindow = window as SpeechRecognitionWindow
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition
}

function errorMessage(error: string | undefined) {
  switch (error) {
    case 'not-allowed':
    case 'service-not-allowed': return permissionMessage
    case 'audio-capture': return 'I could not find a microphone. Please check your microphone and try again.'
    case 'network': return 'Speech recognition needs a network connection in this browser.'
    case 'language-not-supported': return 'English speech recognition is not supported by this browser.'
    default: return 'I could not hear that clearly. Please try again.'
  }
}

function mergeFinalTranscript(existing: string, incoming: string) {
  const current = existing.trim()
  const next = incoming.trim()
  if (!current) return next
  if (!next || next === current) return current
  if (next.startsWith(current)) return next
  if (current.endsWith(next)) return current
  return `${current} ${next}`
}

export function useSpeechRecognition(onError?: (message: string) => void) {
  const [isListening, setIsListening] = useState(false)
  const [finalTranscript, setFinalTranscript] = useState('')
  const [interimTranscript, setInterimTranscript] = useState('')
  const [error, setError] = useState<string | null>(null)
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null)
  const finalTranscriptRef = useRef('')
  const shouldContinueRef = useRef(false)
  const restartAttemptsRef = useRef(0)
  const restartTimerRef = useRef<number | null>(null)

  const clearRestartTimer = useCallback(() => {
    if (restartTimerRef.current !== null) {
      window.clearTimeout(restartTimerRef.current)
      restartTimerRef.current = null
    }
  }, [])

  const resetTranscript = useCallback(() => {
    finalTranscriptRef.current = ''
    setFinalTranscript('')
    setInterimTranscript('')
    setError(null)
  }, [])

  const stopListening = useCallback(() => {
    shouldContinueRef.current = false
    restartAttemptsRef.current = 0
    clearRestartTimer()
    if (recognitionRef.current) recognitionRef.current.stop()
    else setIsListening(false)
  }, [clearRestartTimer])

  const cancelListening = useCallback(() => {
    shouldContinueRef.current = false
    restartAttemptsRef.current = 0
    clearRestartTimer()
    setIsListening(false)
    recognitionRef.current?.abort()
  }, [clearRestartTimer])

  const startListening = useCallback(() => {
    const Recognition = getRecognitionConstructor()
    if (!Recognition) {
      setError(unsupportedMessage)
      setIsListening(false)
      onError?.(unsupportedMessage)
      return
    }
    if (shouldContinueRef.current || isListening) return

    clearRestartTimer()
    resetTranscript()
    shouldContinueRef.current = true
    restartAttemptsRef.current = 0

    const recognition = new Recognition()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = 'en-US'
    recognition.onstart = () => setIsListening(true)
    recognition.onresult = (event) => {
      let nextFinal = ''
      let nextInterim = ''
      for (let index = 0; index < event.results.length; index += 1) {
        const result = event.results[index]
        const transcript = result[0]?.transcript?.trim() || ''
        if (result.isFinal) nextFinal += `${transcript} `
        else nextInterim += `${transcript} `
      }
      restartAttemptsRef.current = 0
      const mergedFinal = mergeFinalTranscript(finalTranscriptRef.current, nextFinal)
      finalTranscriptRef.current = mergedFinal
      setFinalTranscript(mergedFinal)
      setInterimTranscript(nextInterim.trim())
    }
    recognition.onerror = (event) => {
      if (event.error === 'no-speech' || event.error === 'aborted') return
      shouldContinueRef.current = false
      clearRestartTimer()
      setIsListening(false)
      const message = errorMessage(event.error)
      setError(message)
      onError?.(message)
      console.error('Speech recognition error:', event.error)
    }
    recognition.onend = () => {
      if (!shouldContinueRef.current) {
        setIsListening(false)
        return
      }
      if (restartAttemptsRef.current >= 3) {
        shouldContinueRef.current = false
        setIsListening(false)
        const message = 'Speech recognition stopped. Tap the microphone to start again.'
        setError(message)
        onError?.(message)
        return
      }
      restartAttemptsRef.current += 1
      clearRestartTimer()
      restartTimerRef.current = window.setTimeout(() => {
        try { recognition.start() } catch { const message = 'Speech recognition could not restart. Please try again.'; shouldContinueRef.current = false; setIsListening(false); setError(message); onError?.(message) }
      }, 150)
    }

    recognitionRef.current = recognition
    setIsListening(true)
    try {
      recognition.start()
    } catch (startError) {
      shouldContinueRef.current = false
      setIsListening(false)
      const message = startError instanceof DOMException && startError.name === 'NotAllowedError' ? permissionMessage : 'Speech recognition could not start. Please try again.'
      setError(message)
      onError?.(message)
    }
  }, [clearRestartTimer, isListening, onError, resetTranscript])

  useEffect(() => {
    return () => {
      shouldContinueRef.current = false
      clearRestartTimer()
      recognitionRef.current?.abort()
      recognitionRef.current = null
    }
  }, [clearRestartTimer])

  return {
    supported: typeof window !== 'undefined' && Boolean(getRecognitionConstructor()),
    isListening,
    finalTranscript,
    interimTranscript,
    transcript: `${finalTranscript}${finalTranscript && interimTranscript ? ' ' : ''}${interimTranscript}`.trim(),
    error,
    startListening,
    stopListening,
    cancelListening,
    resetTranscript,
  }
}
