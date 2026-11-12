import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react"
import WaveSurfer from "wavesurfer.js"
import RegionsPlugin, { type Region } from "wavesurfer.js/dist/plugins/regions.esm.js"
import { Download, Pause, Play, RotateCcw, RotateCw, Scissors, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useTheme } from "@/components/theme-provider"
import { formatClock } from "@/lib/format"

export interface AudioPlayerHandle {
  seek: (seconds: number) => void
}

const speeds = [1, 1.25, 1.5, 2]
const regionColor = "color-mix(in oklab, var(--primary) 22%, transparent)"
const minClip = 0.5

type Clip = { start: number; end: number }

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
  clipUrl,
  ref,
}: {
  src: string
  peaks: number[] | undefined
  duration: number
  onTime?: (seconds: number) => void
  /** When given, the scissors button lets the user mark an excerpt on the waveform and download it. */
  clipUrl?: (clip: Clip) => string
  ref?: Ref<AudioPlayerHandle>
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const waveRef = useRef<WaveSurfer | null>(null)
  const regionsRef = useRef<ReturnType<typeof RegionsPlugin.create> | null>(null)
  const [clip, setClip] = useState<Clip | null>(null)
  const cutting = clip !== null
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
    // One excerpt at a time: a new drag replaces the previous selection.
    const regions = wave.registerPlugin(RegionsPlugin.create())
    regionsRef.current = regions
    const sync = (region: Region) => setClip({ start: region.start, end: region.end })
    regions.on("region-created", (region) => {
      for (const other of regions.getRegions()) if (other !== region) other.remove()
      sync(region)
    })
    regions.on("region-update", sync)
    regions.on("region-updated", sync)
    return () => {
      wave.destroy()
      waveRef.current = null
      regionsRef.current = null
    }
  }, [peaks, duration])

  // While cutting, dragging across the waveform marks a new excerpt (a plain click still seeks).
  useEffect(() => {
    const regions = regionsRef.current
    if (!cutting || !regions) return
    return regions.enableDragSelection({ color: regionColor }, 3)
  }, [cutting, peaks, duration])

  const region = () => regionsRef.current?.getRegions()[0]

  const startCut = () => {
    const regions = regionsRef.current
    if (!regions) return
    const start = Math.min(audioRef.current?.currentTime ?? 0, Math.max(duration - minClip, 0))
    const end = Math.min(start + 60, duration)
    regions.clearRegions()
    regions.addRegion({ start, end, color: regionColor })
    setClip({ start, end })
  }

  const cancelCut = () => {
    regionsRef.current?.clearRegions()
    setClip(null)
  }

  const setEdge = (side: "start" | "end") => {
    const current = region()
    const now = audioRef.current?.currentTime ?? 0
    if (!current) return
    const start = side === "start" ? Math.min(now, current.end - minClip) : current.start
    const end = side === "end" ? Math.max(now, current.start + minClip) : current.end
    current.setOptions({ start: Math.max(start, 0), end: Math.min(end, duration) })
    setClip({ start: current.start, end: current.end })
  }

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
        {clipUrl && (
          <Button
            variant={cutting ? "secondary" : "ghost"}
            size="icon"
            className="ml-auto lg:ml-2"
            aria-label={cutting ? "Fechar corte" : "Cortar trecho do áudio"}
            title={cutting ? "Fechar corte" : "Cortar trecho do áudio"}
            aria-pressed={cutting}
            disabled={!peaks}
            onClick={() => (cutting ? cancelCut() : startCut())}
          >
            <Scissors />
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          className={clipUrl ? "w-14 font-mono tabular-nums" : "ml-auto w-14 font-mono tabular-nums lg:ml-2"}
          aria-label="Velocidade de reprodução"
          onClick={() => setSpeed(speeds[(speeds.indexOf(speed) + 1) % speeds.length])}
        >
          {speed}x
        </Button>
      </div>
      {clip && clipUrl && (
        <div className="flex flex-col gap-2 rounded-lg border bg-muted/40 p-2.5">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Scissors className="size-4 text-muted-foreground" />
            <span className="font-mono tabular-nums">
              {formatClock(clip.start)} – {formatClock(clip.end)}
            </span>
            <span className="text-muted-foreground tabular-nums">({formatClock(clip.end - clip.start)})</span>
            <div className="flex flex-wrap items-center gap-1 sm:ml-auto">
              <Button variant="ghost" size="sm" title="Marca o início onde o player está agora" onClick={() => setEdge("start")}>
                Início aqui
              </Button>
              <Button variant="ghost" size="sm" title="Marca o fim onde o player está agora" onClick={() => setEdge("end")}>
                Fim aqui
              </Button>
              <Button variant="outline" size="sm" onClick={() => region()?.play(true)}>
                <Play /> Ouvir trecho
              </Button>
              <Button size="sm" asChild>
                <a href={clipUrl({ start: Math.round(clip.start * 100) / 100, end: Math.round(clip.end * 100) / 100 })} download>
                  <Download /> Baixar trecho
                </a>
              </Button>
              <Button variant="ghost" size="icon-sm" aria-label="Cancelar corte" onClick={cancelCut}>
                <X />
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Arraste na onda para marcar o trecho, puxe as bordas para ajustar, ou toque o áudio e use “Início aqui” / “Fim aqui”.
            O áudio salvo na reunião não muda.
          </p>
        </div>
      )}
    </div>
  )
}
