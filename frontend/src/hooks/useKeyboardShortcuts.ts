import { useEffect } from 'react'

function isTextEntryTarget(target: EventTarget | null) {
  const element = target as HTMLElement | null
  return element?.tagName === 'INPUT'
    || element?.tagName === 'TEXTAREA'
    || element?.tagName === 'SELECT'
    || element?.tagName === 'BUTTON'
    || Boolean(element?.isContentEditable)
}

export function useVoiceSpaceShortcut(
  enabled: boolean,
  recording: boolean,
  canStart: boolean,
  onStart: () => void,
  onStop: () => void,
  onCancel?: () => void,
  cancelable = recording,
) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!enabled) return

      if (event.key === 'Escape' && cancelable && onCancel) {
        event.preventDefault()
        onCancel()
        return
      }

      if (isTextEntryTarget(event.target)) return

      if (event.code !== 'Space' || event.repeat) return
      if (!recording && !canStart) return
      event.preventDefault()
      if (recording) onStop()
      else onStart()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [canStart, cancelable, enabled, onCancel, onStart, onStop, recording])
}
