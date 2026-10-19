import { useDeferredValue, useMemo, useState } from "react"
import { Link } from "react-router"
import { AudioLines, Clock, FileText, NotebookPen, Plus, Search } from "lucide-react"

import { useDocumentTitle } from "@/hooks/use-document-title"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { StatusBadge } from "@/components/meetings/status-badge"
import { useMeetings } from "@/hooks/use-meetings"
import type { Meeting } from "@/lib/api"
import { formatDate, formatDuration, initials } from "@/lib/format"
import { cn } from "@/lib/utils"

type Filter = "all" | "pending" | "done"

const filters: { id: Filter; label: string }[] = [
  { id: "all", label: "Todas" },
  { id: "pending", label: "Sem ata" },
  { id: "done", label: "Com ata" },
]

function Stat({ icon: Icon, label, value }: { icon: typeof Clock; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border bg-card px-3 py-2.5 sm:px-4 sm:py-3">
      <span className="hidden size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground sm:grid">
        <Icon className="size-4" />
      </span>
      <div className="leading-tight">
        <div className="text-lg font-semibold tabular-nums">{value}</div>
        <div className="text-xs text-muted-foreground">{label}</div>
      </div>
    </div>
  )
}

function Participants({ names }: { names: string[] }) {
  if (!names.length) return null
  const shown = names.slice(0, 4)
  return (
    <div className="flex -space-x-1.5">
      {shown.map((name) => (
        <span key={name} title={name} className="grid size-6 place-items-center rounded-full border-2 border-card bg-muted text-[10px] font-medium">
          {initials(name)}
        </span>
      ))}
      {names.length > shown.length && (
        <span className="grid size-6 place-items-center rounded-full border-2 border-card bg-muted text-[10px]">+{names.length - shown.length}</span>
      )}
    </div>
  )
}

function MeetingCard({ meeting }: { meeting: Meeting }) {
  return (
    <Link
      to={`/reunioes/${meeting.id}`}
      className="group flex flex-col gap-3 rounded-xl border bg-card p-4 transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-heading font-semibold tracking-tight group-hover:text-primary">{meeting.title}</h3>
          <p className="text-xs text-muted-foreground">
            {formatDate(meeting.date)} · {formatDuration(meeting.audio_duration)}
          </p>
        </div>
        <StatusBadge status={meeting.status} />
      </div>
      <p className={cn("line-clamp-2 min-h-10 text-sm", meeting.transcript_preview ? "text-muted-foreground" : "text-muted-foreground/50 italic")}>
        {meeting.transcript_preview ?? "Sem transcrição ainda."}
      </p>
      <div className="mt-auto flex items-center justify-between">
        <Participants names={meeting.participants} />
        <div className="ml-auto flex items-center gap-2 text-muted-foreground/70">
          <AudioLines className={cn("size-4", meeting.has_audio && "text-foreground")} aria-label="Áudio" />
          <FileText className={cn("size-4", meeting.has_transcript && "text-foreground")} aria-label="Transcrição" />
          <NotebookPen className={cn("size-4", meeting.has_minutes && "text-foreground")} aria-label="Ata" />
        </div>
      </div>
    </Link>
  )
}

export function LibraryPage() {
  useDocumentTitle("Reuniões")
  const [search, setSearch] = useState("")
  const [filter, setFilter] = useState<Filter>("all")
  const query = useDeferredValue(search.trim())
  const { data, isLoading, isError, error } = useMeetings(query || undefined)

  const meetings = useMemo(
    () => (data ?? []).filter((m) => filter === "all" || (filter === "done" ? m.has_minutes : !m.has_minutes)),
    [data, filter],
  )
  const totalHours = (data ?? []).reduce((sum, m) => sum + (m.audio_duration ?? 0), 0) / 3600

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight sm:text-3xl">Reuniões</h1>
          <p className="text-sm text-muted-foreground">Áudios, transcrições e atas, tudo processado no seu computador.</p>
        </div>
        <Button asChild size="lg">
          <Link to="/nova">
            <Plus /> Nova reunião
          </Link>
        </Button>
      </div>

      {!query && data && (
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          <Stat icon={Clock} label="reuniões" value={String(data.length)} />
          <Stat icon={AudioLines} label="horas de áudio" value={totalHours.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} />
          <Stat icon={NotebookPen} label="com ata pronta" value={String(data.filter((m) => m.has_minutes).length)} />
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar título, pessoa ou trecho falado"
            className="h-10 pl-9"
            aria-label="Buscar reuniões"
          />
        </div>
        <div className="flex gap-1 rounded-lg bg-muted p-1">
          {filters.map((item) => (
            <button
              key={item.id}
              onClick={() => setFilter(item.id)}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm transition-colors",
                filter === item.id ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {isError && <p className="text-sm text-red-600">Não consegui carregar as reuniões: {error.message}</p>}

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-40 rounded-xl" />
          ))}
        </div>
      ) : meetings.length ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {meetings.map((meeting) => (
            <MeetingCard key={meeting.id} meeting={meeting} />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-16 text-center">
          <span className="grid size-12 place-items-center rounded-full bg-muted text-muted-foreground">
            <AudioLines className="size-6" />
          </span>
          <div className="font-medium">{query ? "Nenhuma reunião encontrada" : "Nenhuma reunião ainda"}</div>
          <p className="max-w-sm text-sm text-muted-foreground">
            {query ? "Tente outro termo de busca." : "Envie um áudio ou grave direto pelo navegador para começar."}
          </p>
          {!query && (
            <Button asChild variant="outline">
              <Link to="/nova">
                <Plus /> Nova reunião
              </Link>
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
