import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react"
import WaveSurfer from "wavesurfer.js"
import { Pause, Play, RotateCcw, RotateCw } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useTheme } from "@/components/theme-provider"
import { formatClock } from "@/lib/format"

export interface AudioPlayerHandle {
  seek: (seconds: number) => void
}

const speeds = [1, 1.25, 1.5, 2]

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

/**
 * Streams the audio through a native <audio> element (HTTP Range) and draws server-computed
 * peaks, so a 70-minute meeting never has to be decoded in the browser.
 */
export function AudioPlayer({
  src,
  peaks,
  duration,
  onTime,
  ref,
}: {
  src: string
  peaks: number[] | undefined
  duration: number
  onTime?: (seconds: number) => void
  ref?: Ref<AudioPlayerHandle>
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const waveRef = useRef<WaveSurfer | null>(null)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [speed, setSpeed] = useState(1)
  const { resolvedTheme } = useTheme()

  useImperativeHandle(ref, () => ({
    seek: (seconds) => {
      const audio = audioRef.current
      if (!audio) return
      audio.currentTime = seconds
      void audio.play()
    },
  }))

  useEffect(() => {
    if (!containerRef.current || !audioRef.current || !peaks) return
    const wave = WaveSurfer.create({
      container: containerRef.current,
      media: audioRef.current,
      peaks: [peaks],
      duration,
      height: 64,
      barWidth: 2,
      barGap: 2,
      barRadius: 2,
      cursorWidth: 2,
      normalize: true,
      waveColor: cssVar("--muted-foreground") || "#a3a3a3",
      progressColor: cssVar("--primary") || "#171717",
      cursorColor: cssVar("--primary") || "#171717",
    })
    waveRef.current = wave
    return () => {
      wave.destroy()
      waveRef.current = null
    }
  }, [peaks, duration])

  // Colors come from CSS variables; re-read them after the theme class changes on <html>.
  useEffect(() => {
    const frame = requestAnimationFrame(() =>
      waveRef.current?.setOptions({
        waveColor: cssVar("--muted-foreground"),
        progressColor: cssVar("--primary"),
        cursorColor: cssVar("--primary"),
      }),
    )
    return () => cancelAnimationFrame(frame)
  }, [resolvedTheme])

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = speed
  }, [speed])

  const skip = (delta: number) => {
    const audio = audioRef.current
    if (audio) audio.currentTime = Math.min(Math.max(0, audio.currentTime + delta), duration)
  }

  // Keyboard: Space play/pause, ←/→ 5 s, Shift+←/→ 30 s (ignored while typing or in a dialog).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      if (event.ctrlKey || event.metaKey || event.altKey || target.closest("input, textarea, select, [contenteditable], [role=dialog], [role=menu]")) return
      const audio = audioRef.current
      if (!audio) return
      if (event.key === " " || event.key.toLowerCase() === "k") {
        event.preventDefault()
        if (audio.paused) void audio.play()
        else audio.pause()
      } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault()
        skip((event.key === "ArrowLeft" ? -1 : 1) * (event.shiftKey ? 30 : 5))
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  return (
    <div className="flex flex-col gap-3">
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(event) => {
          setTime(event.currentTarget.currentTime)
          onTime?.(event.currentTarget.currentTime)
        }}
      />
      {peaks ? <div ref={containerRef} className="w-full cursor-pointer" /> : <Skeleton className="h-16 w-full" />}
      <div className="flex items-center gap-1 sm:gap-2">
        <Button variant="ghost" size="icon" aria-label="Voltar 10 segundos" onClick={() => skip(-10)}>
          <RotateCcw />
        </Button>
        <Button
          size="icon-lg"
          className="rounded-full"
          aria-label={playing ? "Pausar" : "Tocar"}
          onClick={() => (playing ? audioRef.current?.pause() : void audioRef.current?.play())}
        >
          {playing ? <Pause /> : <Play className="translate-x-px" />}
        </Button>
        <Button variant="ghost" size="icon" aria-label="Avançar 10 segundos" onClick={() => skip(10)}>
          <RotateCw />
        </Button>
        <span className="ml-1 font-mono text-xs tabular-nums text-muted-foreground sm:text-sm">
          {formatClock(time)} / {formatClock(duration)}
        </span>
        <span className="ml-auto hidden text-[11px] text-muted-foreground lg:inline" title="Atalhos do player">
          Espaço tocar · ←/→ 5 s · Shift 30 s
        </span>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto w-14 font-mono tabular-nums lg:ml-2"
          aria-label="Velocidade de reprodução"
          onClick={() => setSpeed(speeds[(speeds.indexOf(speed) + 1) % speeds.length])}
        >
          {speed}x
        </Button>
      </div>
    </div>
  )
}
