import { useEffect, useRef, useState } from "react"
import { useNavigate } from "react-router"
import { useQueryClient } from "@tanstack/react-query"
import { AlertTriangle, Loader2, Mic, MicOff, Pause, Play, Radio, RefreshCw, ScanSearch, Square, Volume2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useDocumentTitle } from "@/hooks/use-document-title"
import { useLiveRecorder } from "@/hooks/use-live-recorder"
import { useMicrophone } from "@/hooks/use-microphone"
import { formatClock, splitNames } from "@/lib/format"
import { cn } from "@/lib/utils"

const languages = [
  { value: "pt", label: "Português" },
  { value: "en", label: "Inglês" },
  { value: "es", label: "Espanhol" },
]

/** Bars follow the microphone in real time (~20 updates per second), recording or not. */
function LevelMeter({ level, recording }: { level: number; recording: boolean }) {
  const bars = 40
  return (
    <div className="flex h-14 items-center justify-center gap-[3px]" aria-hidden>
      {Array.from({ length: bars }, (_, i) => {
        const shape = Math.sin((i / (bars - 1)) * Math.PI)
        const jitter = 0.75 + 0.25 * Math.sin(i * 1.7 + level * 9)
        const height = 4 + level * 52 * (0.25 + 0.75 * shape) * jitter
        return (
          <span
            key={i}
            className={cn(
              "w-1 rounded-full transition-[height] duration-75",
              recording ? "bg-red-500" : level > 0.15 ? "bg-emerald-500" : "bg-muted-foreground/40",
            )}
            style={{ height }}
          />
        )
      })}
    </div>
  )
}

function MicrophonePicker({ mic, disabled }: { mic: ReturnType<typeof useMicrophone>; disabled: boolean }) {
  return (
    <div className="grid gap-2">
      <Label htmlFor="live-mic" className="flex items-center gap-1.5">
        <Mic className="size-3.5" /> Microfone
      </Label>
      <div className="flex gap-2">
        <select
          id="live-mic"
          value={mic.deviceId}
          disabled={disabled || mic.status === "requesting" || !mic.devices.length}
          onChange={(event) => mic.choose(event.target.value)}
          className="h-9 min-w-0 flex-1 rounded-lg border bg-background px-3 text-sm disabled:opacity-60"
        >
          {!mic.devices.length && <option value="">{mic.status === "requesting" ? "Abrindo o microfone…" : "Nenhum microfone encontrado"}</option>}
          {mic.devices.map((device) => (
            <option key={device.id} value={device.id}>{device.label}</option>
          ))}
        </select>
        <Button variant="outline" size="icon" disabled={disabled || !!mic.scanning} onClick={() => void mic.retry()} title="Reabrir o microfone" aria-label="Reabrir o microfone">
          <RefreshCw className={cn(mic.status === "requesting" && "animate-spin")} />
        </Button>
      </div>
      <Button variant="secondary" size="sm" className="w-fit" disabled={disabled || !!mic.scanning} onClick={() => void mic.scan()}>
        {mic.scanning ? <Loader2 className="animate-spin" /> : <ScanSearch />}
        {mic.scanning ? `Testando ${mic.scanning.index} de ${mic.scanning.total}: fale sem parar…` : "Encontrar meu microfone"}
      </Button>
      {mic.scanning && <p className="truncate text-xs text-muted-foreground">Ouvindo: {mic.scanning.label}</p>}
      {mic.scanResults && !mic.scanning && <ScanResults results={mic.scanResults} chosen={mic.deviceId} />}
    </div>
  )
}

function ScanResults({ results, chosen }: { results: ReturnType<typeof useMicrophone>["scanResults"] & object; chosen: string }) {
  const heard = results.some((r) => r.level > 0.2)
  return (
    <div className="flex flex-col gap-1 rounded-lg border p-2 text-xs">
      <span className={cn("font-medium", heard ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400")}>
        {heard ? "Escolhi o microfone que mais captou a sua voz:" : "Nenhum microfone captou som. Veja as dicas abaixo."}
      </span>
      {results.map((result) => (
        <div key={result.id} className="flex items-center gap-2">
          <span className={cn("min-w-0 flex-1 truncate", result.id === chosen && heard && "font-medium")}>
            {result.id === chosen && heard ? "✓ " : ""}{result.label}
          </span>
          {result.level < 0 ? (
            <span className="text-muted-foreground">não abriu</span>
          ) : (
            <span className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
              <span className={cn("block h-full", result.level > 0.2 ? "bg-emerald-500" : "bg-muted-foreground/40")} style={{ width: `${Math.max(3, result.level * 100)}%` }} />
            </span>
          )}
        </div>
      ))}
    </div>
  )
}

function Diagnostics({ mic }: { mic: ReturnType<typeof useMicrophone> }) {
  if (mic.status !== "ready") return null
  return (
    <p className="max-w-full truncate text-center text-[11px] text-muted-foreground tabular-nums">
      Chrome está usando: {mic.trackLabel ?? "?"} · {mic.db <= -99 ? "sem sinal" : `${mic.db} dB`}
    </p>
  )
}

function NoSoundTips() {
  return (
    <ul className="max-w-md list-disc space-y-1 pl-5 text-left text-xs text-muted-foreground">
      <li>Use “Encontrar meu microfone” e fale enquanto ele testa cada um.</li>
      <li>Windows: Configurações → Privacidade e segurança → Microfone → ative “Permitir que aplicativos da área de trabalho acessem o microfone”.</li>
      <li>Windows: Configurações → Sistema → Som → Entrada: confira se o volume não está zerado ou mudo.</li>
      <li>Chrome: clique no cadeado da barra de endereço → Microfone → escolha o dispositivo certo.</li>
      <li>Se o fone tem botão de mudo, desligue-o.</li>
    </ul>
  )
}

export function LivePage() {
  const navigate = useNavigate()
  const client = useQueryClient()
  const mic = useMicrophone()
  const live = useLiveRecorder(mic.onPcm)
  const [title, setTitle] = useState("")
  const [participants, setParticipants] = useState("")
  const [language, setLanguage] = useState("pt")
  const [heard, setHeard] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)
  const recording = live.state === "recording" || live.state === "paused"
  const busy = recording || live.state === "connecting" || live.state === "saving"
  useDocumentTitle(recording ? `🔴 ${formatClock(live.elapsed)} · Ao vivo` : "Ao vivo")

  useEffect(() => {
    if (mic.level > 0.25) setHeard(true)
  }, [mic.level])

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
      toast.info("Nada foi gravado.", { description: "Nenhum áudio chegou ao servidor. Confira o microfone escolhido." })
    }
  }, [live.state, live.result, live.meetingId, live.segments.length, client, navigate])

  const micReady = mic.status === "ready" && !mic.suspended

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

      {!busy && (
        <Card>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="live-title">Título</Label>
              <Input id="live-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Reunião presencial" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="live-people">Participantes</Label>
              <Input id="live-people" value={participants} onChange={(e) => setParticipants(e.target.value)} placeholder="Ana, Bruno" />
            </div>
            <MicrophonePicker mic={mic} disabled={busy} />
            <div className="grid gap-2">
              <Label htmlFor="live-language">Idioma falado</Label>
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
        <CardContent className="flex flex-col items-center gap-4 py-4">
          <LevelMeter level={live.state === "paused" ? 0 : mic.level} recording={live.state === "recording"} />
          <Diagnostics mic={mic} />
          {mic.trackMuted && (
            <p className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
              <MicOff className="size-4" /> O sistema está silenciando este microfone (mudo no Windows ou no fone).
            </p>
          )}
          {recording && live.serverSilent && (
            <div className="flex flex-col items-center gap-2 rounded-lg border border-red-500/40 bg-red-500/5 p-3">
              <p className="flex items-center gap-2 text-sm font-medium text-red-600 dark:text-red-400">
                <AlertTriangle className="size-4" /> O servidor está recebendo só silêncio deste microfone.
              </p>
              <p className="text-xs text-muted-foreground">Pare a gravação e use “Encontrar meu microfone”.</p>
            </div>
          )}

          {!busy && mic.status === "ready" && !mic.suspended && (
            <p className={cn("flex items-center gap-1.5 text-sm", heard ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")}>
              <Volume2 className="size-4" />
              {heard ? "Estou ouvindo você. Pode gravar." : "Fale algo para testar: as barras devem subir com a sua voz."}
            </p>
          )}
          {!busy && mic.status === "ready" && !heard && mic.db <= -70 && <NoSoundTips />}
          {mic.suspended && mic.status === "ready" && (
            <Button variant="outline" onClick={() => void mic.resume()}>
              <Volume2 /> Ativar o áudio do navegador
            </Button>
          )}
          {(mic.status === "denied" || mic.status === "error") && (
            <p className="flex max-w-md items-start gap-2 text-center text-sm text-red-600 dark:text-red-400">
              <MicOff className="mt-0.5 size-4 shrink-0" /> {mic.error}
            </p>
          )}

          <div className="flex items-center gap-3">
            {recording && <span className={cn("size-2.5 rounded-full bg-red-500", live.state === "recording" && "animate-pulse")} />}
            <span className="font-mono text-4xl tabular-nums">{formatClock(live.elapsed)}</span>
          </div>

          {(live.state === "idle" || live.state === "error" || live.state === "saved") && (
            <Button
              size="lg"
              disabled={!micReady}
              className="h-12 rounded-full bg-red-600 px-8 text-base text-white hover:bg-red-700"
              onClick={() => live.start({ title: title.trim(), participants: splitNames(participants), language })}
            >
              <Mic /> Começar a gravar
            </Button>
          )}
          {live.state === "connecting" && (
            <Button size="lg" disabled className="h-12 rounded-full px-8">
              <Loader2 className="animate-spin" /> Preparando a GPU…
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

          {recording && (
            <p className="text-xs text-muted-foreground tabular-nums">
              {live.state === "paused" ? "Pausado: nada está sendo gravado." : `${live.sentSeconds.toFixed(0)} s de áudio enviados ao servidor`}
            </p>
          )}
          {recording && live.elapsed >= 3 && live.sentSeconds < 1 && (
            <p className="flex items-center gap-2 text-xs text-red-600 dark:text-red-400">
              <AlertTriangle className="size-3.5" /> Nenhum áudio está saindo do microfone. Pare e escolha outro.
            </p>
          )}
          {live.gpuBusy && recording && (
            <p className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-300">
              <AlertTriangle className="size-3.5" /> A GPU está terminando outra tarefa; o texto pode atrasar alguns segundos.
            </p>
          )}
          {live.error && <p className="text-sm text-red-600 dark:text-red-400">{live.error}</p>}
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
