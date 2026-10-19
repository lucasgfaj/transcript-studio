import { useEffect, useRef, useState } from "react"
import { useNavigate } from "react-router"
import { useQueryClient } from "@tanstack/react-query"
import { AlertTriangle, Loader2, Mic, Pause, Play, Radio, Square } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useDocumentTitle } from "@/hooks/use-document-title"
import { useLiveRecorder } from "@/hooks/use-live-recorder"
import { formatClock, splitNames } from "@/lib/format"
import { cn } from "@/lib/utils"

const languages = [
  { value: "pt", label: "Português" },
  { value: "en", label: "Inglês" },
  { value: "es", label: "Espanhol" },
]

function LevelMeter({ level, active }: { level: number; active: boolean }) {
  const bars = 32
  return (
    <div className="flex h-10 items-center justify-center gap-[3px]" aria-hidden>
      {Array.from({ length: bars }, (_, i) => {
        const shape = Math.sin((i / (bars - 1)) * Math.PI)
        const height = active ? 4 + Math.min(1, level * 2.5) * 36 * (0.35 + 0.65 * shape) : 4
        return (
          <span
            key={i}
            className={cn("w-1 rounded-full transition-[height] duration-100", active ? "bg-red-500" : "bg-muted-foreground/30")}
            style={{ height }}
          />
        )
      })}
    </div>
  )
}

export function LivePage() {
  const navigate = useNavigate()
  const client = useQueryClient()
  const live = useLiveRecorder()
  const [title, setTitle] = useState("")
  const [participants, setParticipants] = useState("")
  const [language, setLanguage] = useState("pt")
  const endRef = useRef<HTMLDivElement>(null)
  const recording = live.state === "recording" || live.state === "paused"
  useDocumentTitle(recording ? `🔴 ${formatClock(live.elapsed)} · Ao vivo` : "Ao vivo")

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" })
  }, [live.segments.length])

  // Leaving the page mid-recording would stop it; ask first (the audio so far is kept either way).
  useEffect(() => {
    if (!recording) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [recording])

  useEffect(() => {
    if (live.state !== "saved") return
    client.invalidateQueries({ queryKey: ["meetings"] })
    if (live.result === "saved" && live.meetingId) {
      toast.success("Gravação salva", { description: `${live.segments.length} trechos transcritos ao vivo.` })
      navigate(`/reunioes/${live.meetingId}`)
    } else {
      toast.info("Nada foi gravado.")
    }
  }, [live.state, live.result, live.meetingId, live.segments.length, client, navigate])

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="flex items-center gap-2 font-heading text-2xl font-semibold tracking-tight sm:text-3xl">
          <Radio className="size-6 text-red-500" /> Ao vivo
        </h1>
        <p className="text-sm text-muted-foreground">
          Grave pelo microfone e veja o texto a cada pausa na fala. O áudio vai sendo salvo enquanto você grava.
        </p>
      </div>

      {!recording && live.state !== "saving" && (
        <Card>
          <CardContent className="grid gap-4 sm:grid-cols-[1fr_1fr_150px]">
            <div className="grid gap-2">
              <Label htmlFor="live-title">Título</Label>
              <Input id="live-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Reunião presencial" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="live-people">Participantes</Label>
              <Input id="live-people" value={participants} onChange={(e) => setParticipants(e.target.value)} placeholder="Ana, Bruno" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="live-language">Idioma</Label>
              <select
                id="live-language"
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className="h-9 rounded-lg border bg-background px-3 text-sm"
              >
                {languages.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className={cn(recording && "border-red-500/40")}>
        <CardContent className="flex flex-col items-center gap-5 py-4">
          <LevelMeter level={live.level} active={live.state === "recording"} />
          <div className="flex items-center gap-3">
            {recording && <span className={cn("size-2.5 rounded-full bg-red-500", live.state === "recording" && "animate-pulse")} />}
            <span className="font-mono text-4xl tabular-nums">{formatClock(live.elapsed)}</span>
          </div>

          {(live.state === "idle" || live.state === "error" || live.state === "saved") && (
            <Button
              size="lg"
              className="h-12 rounded-full bg-red-600 px-8 text-base text-white hover:bg-red-700"
              onClick={() => live.start({ title: title.trim(), participants: splitNames(participants), language })}
            >
              <Mic /> Começar a gravar
            </Button>
          )}
          {live.state === "connecting" && (
            <Button size="lg" disabled className="h-12 rounded-full px-8">
              <Loader2 className="animate-spin" /> Preparando o microfone e a GPU…
            </Button>
          )}
          {recording && (
            <div className="flex gap-2">
              <Button variant="outline" size="lg" className="h-12 rounded-full" onClick={live.togglePause}>
                {live.state === "recording" ? <><Pause /> Pausar</> : <><Play /> Continuar</>}
              </Button>
              <Button size="lg" className="h-12 rounded-full bg-red-600 text-white hover:bg-red-700" onClick={live.stop}>
                <Square className="fill-current" /> Parar e salvar
              </Button>
            </div>
          )}
          {live.state === "saving" && (
            <Button size="lg" disabled className="h-12 rounded-full px-8">
              <Loader2 className="animate-spin" /> Terminando os últimos trechos…
            </Button>
          )}

          {live.gpuBusy && recording && (
            <p className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-300">
              <AlertTriangle className="size-3.5" /> A GPU está terminando outra tarefa; o texto pode atrasar alguns segundos.
            </p>
          )}
          {live.error && <p className="text-sm text-red-600 dark:text-red-400">{live.error}</p>}
          {live.state === "paused" && <p className="text-xs text-muted-foreground">Pausado: nada está sendo gravado.</p>}
        </CardContent>
      </Card>

      {(recording || live.state === "saving" || live.segments.length > 0) && (
        <div className="flex flex-col gap-1">
          <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
            <span>Transcrição ao vivo · {live.segments.length} trechos</span>
            <span>Aparece a cada pausa na fala</span>
          </div>
          {live.segments.length === 0 ? (
            <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
              Fale normalmente; o primeiro trecho aparece na primeira pausa.
            </p>
          ) : (
            <ol className="flex flex-col">
              {live.segments.map((segment, index) => (
                <li
                  key={index}
                  className={cn("flex items-start gap-3 rounded-lg px-2 py-1.5", index === live.segments.length - 1 && "animate-in fade-in slide-in-from-bottom-1")}
                >
                  <span className="shrink-0 pt-1 font-mono text-xs tabular-nums text-muted-foreground">{formatClock(segment.start)}</span>
                  <p className="text-[15px] leading-relaxed">{segment.text}</p>
                </li>
              ))}
            </ol>
          )}
          {recording && (
            <p className="flex items-center gap-2 px-2 pt-1 text-xs text-muted-foreground">
              <Loader2 className="size-3 animate-spin" /> ouvindo…
            </p>
          )}
          <div ref={endRef} />
        </div>
      )}
    </div>
  )
}
