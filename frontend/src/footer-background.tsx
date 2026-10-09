import { useEffect, useRef } from 'react'
import gazeFrames from './gaze-frames.json'

const TAU = Math.PI * 2
const wrappedAngle = (angle: number) => (angle % TAU + TAU) % TAU

function timeForAngle(angle: number) {
  const target = wrappedAngle(angle)
  let nearestTime = gazeFrames[0][1]
  let nearestDistance = Infinity
  for (const [sampleAngle, time] of gazeFrames) {
    const difference = Math.abs(target - sampleAngle)
    const distance = Math.min(difference, TAU - difference)
    if (distance < nearestDistance) { nearestDistance = distance; nearestTime = time }
  }
  return nearestTime + 1 / 240
}

type MotionWindow = Window & { matchMedia: (query: string) => MediaQueryList }

export default function FooterBackground() {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    let frame = 0
    let desiredTime = 0
    let pointer: { x: number; y: number } | null = null
    let disposed = false
    const mobile = (window as MotionWindow).matchMedia('(max-width: 700px)')
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

    const seek = () => {
      frame = 0
      if (disposed || mobile.matches || video.readyState < 2 || video.seeking) return
      if (Math.abs(video.currentTime - desiredTime) > 1 / 48 && video.duration) video.currentTime = Math.min(desiredTime, video.duration - 1 / 24)
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(seek) }
    const updateTarget = () => {
      if (mobile.matches || !pointer) return
      const rect = video.getBoundingClientRect()
      const scale = Math.max(rect.width / 1920, rect.height / 1080)
      const eyeX = rect.left + rect.width / 2 + (948 - 960) * scale
      const eyeY = rect.top + rect.height / 2 + (418 - 540) * scale
      const dx = pointer.x - eyeX
      const dy = pointer.y - eyeY
      if (Math.hypot(dx, dy) > 8) { desiredTime = timeForAngle(Math.atan2(dy, dx)); schedule() }
    }
    const move = (event: PointerEvent) => { pointer = { x: event.clientX, y: event.clientY }; updateTarget() }
    const syncPlayback = () => {
      video.loop = mobile.matches
      if (mobile.matches && !reducedMotion.matches) void video.play().catch(() => undefined)
      else { video.pause(); if (!mobile.matches) { updateTarget(); schedule() } }
    }
    video.addEventListener('seeked', schedule)
    video.addEventListener('loadeddata', syncPlayback)
    mobile.addEventListener('change', syncPlayback)
    reducedMotion.addEventListener('change', syncPlayback)
    window.addEventListener('pointermove', move, { passive: true })
    window.addEventListener('resize', updateTarget)
    window.addEventListener('scroll', updateTarget, { passive: true })
    if (video.readyState >= 2) syncPlayback()
    return () => { disposed = true; cancelAnimationFrame(frame); video.removeEventListener('seeked', schedule); video.removeEventListener('loadeddata', syncPlayback); mobile.removeEventListener('change', syncPlayback); reducedMotion.removeEventListener('change', syncPlayback); window.removeEventListener('pointermove', move); window.removeEventListener('resize', updateTarget); window.removeEventListener('scroll', updateTarget) }
  }, [])

  return <div className="footer-background" aria-hidden="true"><video ref={videoRef} muted playsInline preload="auto" src="/footer-scrub.mp4" /></div>
}
