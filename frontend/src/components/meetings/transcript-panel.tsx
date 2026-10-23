import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { Check, ChevronDown, ChevronUp, Copy, FileText, LocateFixed, Pencil, Search, X } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { useSaveTranscript, useTranscript } from "@/hooks/use-meetings"
import type { LiveSegment } from "@/lib/api"
import { formatClock } from "@/lib/format"
import { fold, matchRanges } from "@/lib/search"
import { cn } from "@/lib/utils"

interface Line {
  key: string | number
  start: number | null
  end: number | null
  text: string
}

function highlight(text: string, query: string, current: boolean): ReactNode {
  if (!query) return text
  const parts: ReactNode[] = []
  let from = 0
  for (const [start, end] of matchRanges(text, query)) {
    parts.push(text.slice(from, start))
    parts.push(
      <mark key={start} className={cn("rounded px-0.5 text-inherit", current ? "bg-amber-400/70 dark:bg-amber-500/60" : "bg-amber-300/40 dark:bg-amber-400/25")}>
        {text.slice(start, end)}
      </mark>,
    )
    from = end
  }
  parts.push(text.slice(from))
  return parts
}

function SegmentList({ lines, currentTime, follow, onSeek, live, query = "", matchIndex = -1 }: {
  lines: Line[]
  currentTime: number
  follow: boolean
  onSeek?: (seconds: number) => void
  live?: boolean
  query?: string
  matchIndex?: number
}) {
  const activeRef = useRef<HTMLLIElement>(null)
  const matchRef = useRef<HTMLLIElement>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const activeIndex = live ? -1 : lines.findIndex((l) => l.start !== null && l.end !== null && currentTime >= l.start && currentTime < l.end)
  const timed = lines.some((l) => l.start !== null)

  const started = currentTime > 0 // at 0 nothing is playing yet: do not yank the page down on load
  useEffect(() => {
    if (follow && started && !query && activeIndex >= 0) activeRef.current?.scrollIntoView({ block: "center", behavior: "smooth" })
  }, [activeIndex, follow, started, query])
  useEffect(() => {
    if (matchIndex >= 0) matchRef.current?.scrollIntoView({ block: "center", behavior: "smooth" })
  }, [matchIndex, query])
  useEffect(() => {
    if (live) endRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" })
  }, [lines.length, live])

  return (
    <ol className="flex flex-col">
      {lines.map((line, index) => (
        <li
          key={line.key}
          ref={index === matchIndex ? matchRef : index === activeIndex ? activeRef : undefined}
          className={cn(
            "group flex items-start gap-3 rounded-lg px-2 py-1.5 transition-colors",
            index === activeIndex ? "bg-primary/10" : "hover:bg-muted/50",
            index === matchIndex && "ring-1 ring-amber-500/50",
            live && index === lines.length - 1 && "animate-in fade-in slide-in-from-bottom-1",
          )}
        >
          {timed && (
            <button
              className="shrink-0 pt-1 font-mono text-xs tabular-nums text-muted-foreground hover:text-primary disabled:hover:text-muted-foreground"
              disabled={line.start === null || !onSeek}
              onClick={() => line.start !== null && onSeek?.(line.start)}
              title="Ouvir a partir daqui"
            >
              {line.start !== null ? formatClock(line.start) : "--:--"}
            </button>
          )}
          <p className={cn("text-[15px] leading-relaxed", index === activeIndex && "text-foreground")}>
            {highlight(line.text, query, index === matchIndex)}
          </p>
        </li>
      ))}
      <div ref={endRef} />
    </ol>
  )
}

function SearchBox({ value, onChange, count, position, onMove }: {
  value: string
  onChange: (value: string) => void
  count: number
  position: number
  onMove: (delta: number) => void
}) {
  return (
    <div className="flex items-center gap-1">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") onMove(event.shiftKey ? -1 : 1)
            if (event.key === "Escape") onChange("")
          }}
          placeholder="Buscar na transcrição"
          aria-label="Buscar na transcrição"
          className="h-8 w-48 pr-14 pl-8 text-sm"
        />
        {value && (
          <span className="absolute top-1/2 right-2 -translate-y-1/2 text-[11px] tabular-nums text-muted-foreground">
            {count ? `${position + 1}/${count}` : "0"}
          </span>
        )}
      </div>
      {value && (
        <>
          <Button variant="ghost" size="icon-sm" aria-label="Resultado anterior" disabled={!count} onClick={() => onMove(-1)}>
            <ChevronUp />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Próximo resultado" disabled={!count} onClick={() => onMove(1)}>
            <ChevronDown />
          </Button>
        </>
      )}
    </div>
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
  const [query, setQuery] = useState("")
  const [position, setPosition] = useState(0)

  const lines: Line[] = useMemo(() => {
    if (!data) return []
    if (data.segments.length) return data.segments.map((s) => ({ key: s.idx, start: s.start, end: s.end, text: s.text }))
    return data.text.split(/\n+/).filter(Boolean).map((text, i) => ({ key: i, start: null, end: null, text }))
  }, [data])
  const trimmed = query.trim()
  const matches = useMemo(() => {
    if (!trimmed) return []
    const needle = fold(trimmed)
    return lines.flatMap((line, index) => (fold(line.text).includes(needle) ? [index] : []))
  }, [lines, trimmed])

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

  const current = matches.length ? Math.min(position, matches.length - 1) : 0
  return (
    <div className="flex flex-col gap-4">
      <div className="sticky top-14 z-10 -mx-2 flex flex-wrap items-center justify-between gap-2 bg-background/90 px-2 py-2 backdrop-blur lg:top-0">
        <SearchBox
          value={query}
          onChange={(value) => {
            setQuery(value)
            setPosition(0)
          }}
          count={matches.length}
          position={current}
          onMove={(delta) => matches.length && setPosition((current + delta + matches.length) % matches.length)}
        />
        <div className="flex gap-2">
          {data.segments.length > 0 && (
            <Button variant={follow ? "secondary" : "ghost"} size="sm" onClick={() => setFollow(!follow)} title="Rolar junto com o áudio">
              <LocateFixed /> <span className="hidden sm:inline">Seguir áudio</span>
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => navigator.clipboard.writeText(data.text).then(() => toast.success("Copiado"))}>
            <Copy /> <span className="hidden sm:inline">Copiar</span>
          </Button>
          <Button variant="outline" size="sm" onClick={() => setDraft(data.text)}>
            <Pencil /> Editar
          </Button>
        </div>
      </div>
      <p className="-mt-2 text-xs text-muted-foreground">
        {data.segments.length ? `${data.segments.length} trechos com marcação de tempo · clique no horário para ouvir` : "Texto sem marcação de tempo"}
      </p>
      <SegmentList
        lines={lines}
        currentTime={currentTime}
        follow={follow}
        onSeek={onSeek}
        query={trimmed}
        matchIndex={matches.length ? matches[current] : -1}
      />
    </div>
  )
}
