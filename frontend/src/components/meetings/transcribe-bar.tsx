import { useEffect, useState } from "react"
import { AlertTriangle, AudioWaveform, Gauge, Loader2, ScanText, Square, Zap } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import type { Job, TranscriptionMode } from "@/lib/api"
import { formatClock } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { useTranscription } from "@/hooks/use-transcription"

const languages = [
  { value: "pt", label: "Português" },
  { value: "en", label: "Inglês" },
  { value: "es", label: "Espanhol" },
  { value: "", label: "Detectar" },
]

const modes: { value: TranscriptionMode; label: string; hint: string; icon: typeof Zap }[] = [
  { value: "fast", label: "Rápido", hint: "~75x o tempo real · trechos de até 30 s", icon: Zap },
  { value: "detailed", label: "Detalhado", hint: "~32x o tempo real · frase a frase", icon: ScanText },
]

function useElapsed(since: string | null, running: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!running) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [running])
  return since ? Math.max(0, (now - new Date(since).getTime()) / 1000) : 0
}

function LastRun({ job }: { job: Job }) {
  if (job.status === "error") {
    return (
      <p className="flex items-start gap-2 text-sm text-red-600 dark:text-red-400">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" /> A última transcrição falhou: {job.error ?? "erro desconhecido"}
      </p>
    )
  }
  if (job.status === "cancelled") return <p className="text-sm text-muted-foreground">A última transcrição foi cancelada.</p>
  if (job.status !== "done" || !job.elapsed_seconds || !job.audio_seconds) return null
  return (
    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <Gauge className="size-3.5" />
      {formatClock(job.audio_seconds)} de áudio em {job.elapsed_seconds.toFixed(0)} s ·{" "}
      {(job.audio_seconds / job.elapsed_seconds).toFixed(0)}x o tempo real · {job.device === "cuda" ? "GPU" : job.device ?? "?"} ·{" "}
      {job.params.mode === "detailed" ? "detalhado" : "rápido"}
    </p>
  )
}

export function TranscribeBar({ transcription, hasTranscript }: { transcription: ReturnType<typeof useTranscription>; hasTranscript: boolean }) {
  const { job, active, start, cancel } = transcription
  const [mode, setMode] = useState<TranscriptionMode>("fast")
  const [language, setLanguage] = useState("pt")
  const elapsed = useElapsed(job?.started_at ?? null, active)

  if (active && job) {
    const progress = job.progress
    const eta = progress > 0.03 ? (elapsed / progress) * (1 - progress) : null
    return (
      <div className="flex flex-col gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
        <div className="flex items-center gap-3">
          <Loader2 className="size-4 animate-spin text-amber-600 dark:text-amber-400" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">{job.status === "queued" ? "Na fila da GPU" : job.message ?? "Transcrevendo"}</div>
            <div className="text-xs text-muted-foreground tabular-nums">
              {Math.round(progress * 100)}% · {formatClock(elapsed)} decorridos{eta !== null && ` · ~${formatClock(eta)} restantes`}
            </div>
          </div>
          <Button variant="outline" size="sm" disabled={cancel.isPending} onClick={() => cancel.mutate()}>
            <Square className="fill-current" /> Cancelar
          </Button>
        </div>
        <Progress value={progress * 100} />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="flex gap-1 rounded-lg bg-muted p-1" role="radiogroup" aria-label="Modo de transcrição">
          {modes.map((item) => (
            <button
              key={item.value}
              role="radio"
              aria-checked={mode === item.value}
              title={item.hint}
              onClick={() => setMode(item.value)}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors",
                mode === item.value ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <item.icon className="size-3.5" /> {item.label}
            </button>
          ))}
        </div>
        <select
          value={language}
          onChange={(event) => setLanguage(event.target.value)}
          aria-label="Idioma falado"
          className="h-9 rounded-lg border bg-background px-3 text-sm"
        >
          {languages.map((item) => (
            <option key={item.value} value={item.value}>{item.label}</option>
          ))}
        </select>
        <p className="flex-1 text-xs text-muted-foreground">{modes.find((m) => m.value === mode)?.hint}</p>
        <Button
          disabled={start.isPending}
          onClick={() =>
            start.mutate(
              { mode, language: language || null },
              { onError: (error) => toast.error("Não consegui iniciar", { description: error.message }) },
            )
          }
        >
          {start.isPending ? <Loader2 className="animate-spin" /> : <AudioWaveform />}
          {hasTranscript ? "Transcrever de novo" : "Transcrever"}
        </Button>
      </div>
      {job && <LastRun job={job} />}
    </div>
  )
}
