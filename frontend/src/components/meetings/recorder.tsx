import { useEffect, useRef, useState } from "react"
import { Mic, Pause, Play, RotateCcw, Square } from "lucide-react"

import { Button } from "@/components/ui/button"
import { formatClock } from "@/lib/format"
import { cn } from "@/lib/utils"

type State = "idle" | "recording" | "paused" | "done"

function pickMimeType(): string {
  const options = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"]
  return options.find((type) => MediaRecorder.isTypeSupported(type)) ?? ""
}

/** Records the microphone in the browser and hands back a File when stopped. */
export function Recorder({ onRecorded, disabled }: { onRecorded: (file: File | null) => void; disabled?: boolean }) {
  const [state, setState] = useState<State>("idle")
  const [elapsed, setElapsed] = useState(0)
  const [level, setLevel] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])
  const stream = useRef<MediaStream | null>(null)
  const frame = useRef<number>(0)
  const timer = useRef<number>(0)
  const audioContext = useRef<AudioContext | null>(null)

  const cleanup = () => {
    cancelAnimationFrame(frame.current)
    window.clearInterval(timer.current)
    stream.current?.getTracks().forEach((track) => track.stop())
    stream.current = null
    void audioContext.current?.close()
    audioContext.current = null
    setLevel(0)
  }

  useEffect(() => () => cleanup(), [])
  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
  }, [previewUrl])

  const start = async () => {
    setError(null)
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      stream.current = media
      const mimeType = pickMimeType()
      const rec = new MediaRecorder(media, mimeType ? { mimeType, audioBitsPerSecond: 64_000 } : undefined)
      chunks.current = []
      rec.ondataavailable = (event) => event.data.size && chunks.current.push(event.data)
      rec.onstop = () => {
        const type = rec.mimeType || "audio/webm"
        const extension = type.includes("ogg") ? "ogg" : type.includes("mp4") ? "m4a" : "webm"
        const blob = new Blob(chunks.current, { type })
        const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")
        setPreviewUrl(URL.createObjectURL(blob))
        onRecorded(new File([blob], `gravacao-${stamp}.${extension}`, { type }))
        cleanup()
      }
      rec.start(1000)
      recorder.current = rec

      const context = new AudioContext()
      audioContext.current = context
      const analyser = context.createAnalyser()
      analyser.fftSize = 512
      context.createMediaStreamSource(media).connect(analyser)
      const data = new Uint8Array(analyser.fftSize)
      const tick = () => {
        analyser.getByteTimeDomainData(data)
        let peak = 0
        for (const value of data) peak = Math.max(peak, Math.abs(value - 128) / 128)
        setLevel(peak)
        frame.current = requestAnimationFrame(tick)
      }
      tick()

      setElapsed(0)
      timer.current = window.setInterval(() => {
        if (recorder.current?.state === "recording") setElapsed((value) => value + 1)
      }, 1000)
      setState("recording")
      onRecorded(null)
    } catch (err) {
      setError(err instanceof Error && err.name === "NotAllowedError"
        ? "Permissão do microfone negada. Libere o acesso no navegador."
        : "Não consegui acessar o microfone.")
      cleanup()
    }
  }

  const togglePause = () => {
    const rec = recorder.current
    if (!rec) return
    if (rec.state === "recording") {
      rec.pause()
      setState("paused")
    } else {
      rec.resume()
      setState("recording")
    }
  }

  const stop = () => {
    recorder.current?.stop()
    setState("done")
  }

  const reset = () => {
    setPreviewUrl(null)
    setElapsed(0)
    setState("idle")
    onRecorded(null)
  }

  const bars = 28
  return (
    <div className="flex flex-col items-center gap-5 rounded-xl border bg-muted/30 px-6 py-8">
      <div className="flex h-12 items-center gap-[3px]" aria-hidden>
        {Array.from({ length: bars }, (_, i) => {
          const wave = Math.sin((i / bars) * Math.PI)
          const height = state === "recording" ? 6 + level * 44 * (0.4 + 0.6 * wave) * (0.7 + 0.3 * Math.abs(Math.sin(i * 1.7 + level * 9))) : 6
          return (
            <span
              key={i}
              className={cn("w-1 rounded-full transition-[height] duration-100", state === "recording" ? "bg-red-500" : "bg-muted-foreground/30")}
              style={{ height }}
            />
          )
        })}
      </div>
      <div className="font-mono text-3xl tabular-nums">{formatClock(elapsed)}</div>

      {state === "idle" && (
        <Button size="lg" className="rounded-full px-6" onClick={start} disabled={disabled}>
          <Mic /> Começar a gravar
        </Button>
      )}
      {(state === "recording" || state === "paused") && (
        <div className="flex gap-2">
          <Button variant="outline" size="lg" className="rounded-full" onClick={togglePause}>
            {state === "recording" ? <><Pause /> Pausar</> : <><Play /> Continuar</>}
          </Button>
          <Button variant="destructive" size="lg" className="rounded-full" onClick={stop}>
            <Square className="fill-current" /> Parar
          </Button>
        </div>
      )}
      {state === "done" && (
        <div className="flex w-full flex-col items-center gap-3">
          {previewUrl && <audio src={previewUrl} controls className="w-full max-w-md" />}
          <Button variant="ghost" size="sm" onClick={reset} disabled={disabled}>
            <RotateCcw /> Gravar de novo
          </Button>
        </div>
      )}
      {state === "recording" && <p className="text-xs text-muted-foreground">Gravando… o áudio só é enviado quando você salvar.</p>}
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
    </div>
  )
}
