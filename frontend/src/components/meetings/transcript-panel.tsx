import { useEffect, useRef, useState } from "react"
import { Check, Copy, FileText, LocateFixed, Pencil, X } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { useSaveTranscript, useTranscript } from "@/hooks/use-meetings"
import type { LiveSegment } from "@/lib/api"
import { formatClock } from "@/lib/format"
import { cn } from "@/lib/utils"

interface Line {
  key: string | number
  start: number | null
  end: number | null
  text: string
}

function SegmentList({ lines, currentTime, follow, onSeek, live }: {
  lines: Line[]
  currentTime: number
  follow: boolean
  onSeek?: (seconds: number) => void
  live?: boolean
}) {
  const activeRef = useRef<HTMLLIElement>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const activeIndex = live ? -1 : lines.findIndex((l) => l.start !== null && l.end !== null && currentTime >= l.start && currentTime < l.end)

  useEffect(() => {
    if (follow && activeIndex >= 0) activeRef.current?.scrollIntoView({ block: "center", behavior: "smooth" })
  }, [activeIndex, follow])
  useEffect(() => {
    if (live) endRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" })
  }, [lines.length, live])

  return (
    <ol className="flex flex-col">
      {lines.map((line, index) => (
        <li
          key={line.key}
          ref={index === activeIndex ? activeRef : undefined}
          className={cn(
            "group flex gap-3 rounded-lg px-2 py-1.5 transition-colors",
            index === activeIndex ? "bg-primary/10" : "hover:bg-muted/50",
            live && index === lines.length - 1 && "animate-in fade-in slide-in-from-bottom-1",
          )}
        >
          <button
            className="shrink-0 pt-0.5 font-mono text-xs tabular-nums text-muted-foreground hover:text-primary disabled:hover:text-muted-foreground"
            disabled={line.start === null || !onSeek}
            onClick={() => line.start !== null && onSeek?.(line.start)}
            title="Ouvir a partir daqui"
          >
            {line.start !== null ? formatClock(line.start) : "--:--"}
          </button>
          <p className={cn("text-[15px] leading-relaxed", index === activeIndex && "text-foreground")}>{line.text}</p>
        </li>
      ))}
      <div ref={endRef} />
    </ol>
  )
}

export function TranscriptPanel({ meetingId, onSeek, currentTime = 0, liveSegments }: {
  meetingId: string
  onSeek?: (seconds: number) => void
  currentTime?: number
  liveSegments?: LiveSegment[] | null
}) {
  const { data, isLoading } = useTranscript(meetingId)
  const save = useSaveTranscript(meetingId)
  const [draft, setDraft] = useState<string | null>(null)
  const [follow, setFollow] = useState(true)

  if (liveSegments) {
    return liveSegments.length ? (
      <SegmentList live lines={liveSegments.map((s, i) => ({ key: i, ...s }))} currentTime={0} follow={false} />
    ) : (
      <div className="flex flex-col gap-2">
        {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-5" style={{ width: `${90 - i * 12}%` }} />)}
      </div>
    )
  }

  if (isLoading || !data) return <Skeleton className="h-64 w-full" />

  if (draft !== null) {
    return (
      <div className="flex flex-col gap-3">
        <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} className="min-h-[50vh] font-mono text-sm leading-relaxed" autoFocus />
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">{data.segments.length > 0 && "Editar o texto livremente remove as marcações de tempo."}</p>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setDraft(null)}>
              <X /> Cancelar
            </Button>
            <Button
              disabled={save.isPending}
              onClick={() =>
                save.mutate(draft, {
                  onSuccess: () => {
                    toast.success("Transcrição salva")
                    setDraft(null)
                  },
                  onError: (error) => toast.error("Não consegui salvar", { description: error.message }),
                })
              }
            >
              <Check /> Salvar
            </Button>
          </div>
        </div>
      </div>
    )
  }

  if (!data.text) {
    return (
      <div className="flex flex-col items-center gap-3 py-12 text-center">
        <span className="grid size-12 place-items-center rounded-full bg-muted text-muted-foreground">
          <FileText className="size-6" />
        </span>
        <div className="font-medium">Sem transcrição ainda</div>
        <p className="max-w-sm text-sm text-muted-foreground">Clique em Transcrever acima para gerar com o Whisper na GPU, ou cole um texto.</p>
        <Button variant="outline" onClick={() => setDraft("")}>
          <Pencil /> Colar transcrição
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          {data.segments.length ? `${data.segments.length} trechos com marcação de tempo` : "Texto sem marcação de tempo"}
        </span>
        <div className="flex gap-2">
          {data.segments.length > 0 && (
            <Button variant={follow ? "secondary" : "ghost"} size="sm" onClick={() => setFollow(!follow)} title="Rolar junto com o áudio">
              <LocateFixed /> Seguir áudio
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => navigator.clipboard.writeText(data.text).then(() => toast.success("Copiado"))}>
            <Copy /> Copiar
          </Button>
          <Button variant="outline" size="sm" onClick={() => setDraft(data.text)}>
            <Pencil /> Editar
          </Button>
        </div>
      </div>
      {data.segments.length ? (
        <SegmentList
          lines={data.segments.map((s) => ({ key: s.idx, start: s.start, end: s.end, text: s.text }))}
          currentTime={currentTime}
          follow={follow}
          onSeek={onSeek}
        />
      ) : (
        <div className="max-w-none space-y-3 text-[15px] leading-relaxed">
          {data.text.split(/\n+/).map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </div>
      )}
    </div>
  )
}
