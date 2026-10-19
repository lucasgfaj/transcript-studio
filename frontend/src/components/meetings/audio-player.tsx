import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react"
import WaveSurfer from "wavesurfer.js"
import { Pause, Play, RotateCcw, RotateCw } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
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
  ref,
}: {
  src: string
  peaks: number[] | undefined
  duration: number
  ref?: Ref<AudioPlayerHandle>
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const waveRef = useRef<WaveSurfer | null>(null)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [speed, setSpeed] = useState(1)

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

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = speed
  }, [speed])

  const skip = (delta: number) => {
    const audio = audioRef.current
    if (audio) audio.currentTime = Math.min(Math.max(0, audio.currentTime + delta), duration)
  }

  return (
    <div className="flex flex-col gap-3">
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
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
        <Button
          variant="outline"
          size="sm"
          className="ml-auto w-14 font-mono tabular-nums"
          aria-label="Velocidade de reprodução"
          onClick={() => setSpeed(speeds[(speeds.indexOf(speed) + 1) % speeds.length])}
        >
          {speed}x
        </Button>
      </div>
    </div>
  )
}
