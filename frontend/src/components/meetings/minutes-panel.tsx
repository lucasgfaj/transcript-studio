import { useEffect, useState } from "react"
import Markdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { useQuery } from "@tanstack/react-query"
import {
  AlertTriangle, Check, ChevronDown, Copy, History, Loader2, NotebookPen, Pencil, RotateCcw, Sparkles, Square, X,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { useMinutes, useSaveMinutes } from "@/hooks/use-meetings"
import { useMinutesGeneration, useModels } from "@/hooks/use-transcription"
import { api, type MinutesVersion } from "@/lib/api"
import { formatBytes, formatClock } from "@/lib/format"
import { cn } from "@/lib/utils"

function MarkdownView({ markdown, streaming }: { markdown: string; streaming?: boolean }) {
  return (
    <article
      className={cn(
        "prose prose-neutral max-w-none dark:prose-invert prose-headings:font-heading prose-headings:tracking-tight prose-h1:text-2xl prose-li:my-0.5",
        streaming && "[&>*:last-child]:after:ml-0.5 [&>*:last-child]:after:inline-block [&>*:last-child]:after:h-4 [&>*:last-child]:after:w-2 [&>*:last-child]:after:animate-pulse [&>*:last-child]:after:bg-primary [&>*:last-child]:after:align-middle [&>*:last-child]:after:content-['']",
      )}
    >
      <Markdown remarkPlugins={[remarkGfm]}>{markdown}</Markdown>
    </article>
  )
}

function versionLabel(version: MinutesVersion): string {
  const when = new Date(version.created_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })
  const source = version.model === "manual" ? "editada à mão" : version.model === "transcript-mk" ? "importada" : version.model ?? "?"
  return `${when} · ${source}`
}

function useTicker(since: string | null, running: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!running) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [running])
  return since ? Math.max(0, (now - new Date(since).getTime()) / 1000) : 0
}

function ModelPicker({ value, onChange, disabled }: { value: string | null; onChange: (model: string) => void; disabled?: boolean }) {
  const { data } = useModels()
  const models = data?.models ?? []
  const selected = value ?? data?.default ?? ""
  return (
    <select
      value={selected}
      disabled={disabled || !models.length}
      onChange={(event) => onChange(event.target.value)}
      aria-label="Modelo da ata"
      className="h-8 rounded-lg border bg-background px-2 text-sm disabled:opacity-60"
      title={data && !data.available ? "Ollama offline" : "Modelo usado para escrever a ata"}
    >
      {!models.some((m) => m.name === selected) && <option value={selected}>{selected || "Ollama offline"}</option>}
      {models.map((model) => (
        <option key={model.name} value={model.name}>
          {model.name} · {model.parameter_size ?? formatBytes(model.size)}
          {model.name === data?.default ? " (padrão)" : ""}
        </option>
      ))}
    </select>
  )
}

export function MinutesPanel({ meetingId, title, hasTranscript }: { meetingId: string; title: string; hasTranscript: boolean }) {
  const { data, isLoading } = useMinutes(meetingId)
  const save = useSaveMinutes(meetingId)
  const generation = useMinutesGeneration(meetingId)
  const [draft, setDraft] = useState<string | null>(null)
  const [model, setModel] = useState<string | null>(null)
  const [viewing, setViewing] = useState<number | null>(null)
  const elapsed = useTicker(generation.job?.started_at ?? null, generation.active)
  const old = useQuery({
    queryKey: ["meeting", meetingId, "minutes", viewing],
    queryFn: () => api.minutesVersion(meetingId, viewing!),
    enabled: viewing !== null,
  })

  if (isLoading || !data) return <Skeleton className="h-64 w-full" />
  const current = data.current
  const job = generation.job

  const generate = () =>
    generation.start.mutate(model, {
      onSuccess: () => setViewing(null),
      onError: (error) => toast.error("Não consegui iniciar", { description: error.message }),
    })

  const saveDraft = (markdown: string, message: string) =>
    save.mutate(markdown, {
      onSuccess: () => {
        toast.success(message)
        setDraft(null)
        setViewing(null)
      },
      onError: (error) => toast.error("Não consegui salvar", { description: error.message }),
    })

  if (generation.active && job) {
    const text = generation.liveText ?? ""
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 rounded-xl border border-violet-500/30 bg-violet-500/5 p-4">
          <div className="flex items-center gap-3">
            <Loader2 className="size-4 animate-spin text-violet-600 dark:text-violet-400" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{job.status === "queued" ? "Na fila da GPU" : job.message ?? "Gerando"}</div>
              <div className="text-xs text-muted-foreground tabular-nums">
                {job.params.model} · {formatClock(elapsed)} decorridos
              </div>
            </div>
            <Button variant="outline" size="sm" disabled={generation.cancel.isPending} onClick={() => generation.cancel.mutate()}>
              <Square className="fill-current" /> Cancelar
            </Button>
          </div>
          <Progress value={(text ? Math.max(job.progress, 0.72) : job.progress) * 100} />
        </div>
        {text ? (
          <MarkdownView markdown={text} streaming />
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-muted-foreground">
              Reuniões longas são lidas em partes antes de a ata começar a ser escrita.
            </p>
            {Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-5" style={{ width: `${92 - i * 11}%` }} />)}
          </div>
        )}
      </div>
    )
  }

  if (draft !== null) {
    return (
      <div className="flex flex-col gap-3">
        <div className="grid gap-4 lg:grid-cols-2">
          <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} className="min-h-[55vh] font-mono text-sm" autoFocus />
          <div className="hidden max-h-[55vh] overflow-y-auto rounded-lg border p-5 lg:block">
            <MarkdownView markdown={draft} />
          </div>
        </div>
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">Salvar cria uma nova versão; as anteriores ficam no histórico.</p>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setDraft(null)}>
              <X /> Cancelar
            </Button>
            <Button disabled={!draft.trim() || save.isPending} onClick={() => saveDraft(draft, "Ata salva")}>
              <Check /> Salvar versão
            </Button>
          </div>
        </div>
      </div>
    )
  }

  const failed = job && (job.status === "error" || job.status === "cancelled") && (
    <p className={cn("flex items-start gap-2 text-sm", job.status === "error" ? "text-red-600 dark:text-red-400" : "text-muted-foreground")}>
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      {job.status === "error" ? `A última geração falhou: ${job.error}` : "A última geração foi cancelada."}
    </p>
  )

  if (!current) {
    return (
      <div className="flex flex-col items-center gap-4 py-12 text-center">
        <span className="grid size-12 place-items-center rounded-full bg-muted text-muted-foreground">
          <NotebookPen className="size-6" />
        </span>
        <div className="font-medium">Sem ata ainda</div>
        <p className="max-w-sm text-sm text-muted-foreground">
          {hasTranscript
            ? "Gere com o modelo local do Ollama (o texto aparece enquanto é escrito) ou escreva à mão."
            : "Transcreva a reunião primeiro para gerar a ata com IA."}
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <ModelPicker value={model} onChange={setModel} disabled={!hasTranscript} />
          <Button onClick={generate} disabled={!hasTranscript || generation.start.isPending}>
            {generation.start.isPending ? <Loader2 className="animate-spin" /> : <Sparkles />} Gerar com IA
          </Button>
          <Button variant="outline" onClick={() => setDraft(`# ${title}\n\n## Resumo\n\n## Decisões\n\n## Tarefas\n\n- [ ] \n`)}>
            <Pencil /> Escrever à mão
          </Button>
        </div>
        {failed}
      </div>
    )
  }

  const shown = viewing !== null ? old.data : current
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="text-muted-foreground">
              <History /> {viewing !== null ? "Versão antiga" : "Atual"} · {data.history.length}{" "}
              {data.history.length === 1 ? "versão" : "versões"} <ChevronDown />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-72">
            <DropdownMenuLabel>Histórico da ata</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {data.history.map((version, index) => (
              <DropdownMenuItem key={version.id} onSelect={() => setViewing(index === 0 ? null : version.id)}>
                <span className={cn("flex-1 truncate", (viewing ?? current.id) === version.id && "font-medium")}>
                  {versionLabel(version)}
                </span>
                {index === 0 && <span className="text-[10px] uppercase text-muted-foreground">atual</span>}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <div className="flex flex-wrap items-center gap-2">
          {viewing !== null ? (
            <>
              <Button variant="ghost" size="sm" onClick={() => setViewing(null)}>
                <X /> Voltar à atual
              </Button>
              <Button size="sm" disabled={!old.data || save.isPending} onClick={() => old.data && saveDraft(old.data.markdown, "Versão restaurada")}>
                <RotateCcw /> Restaurar esta versão
              </Button>
            </>
          ) : (
            <>
              <ModelPicker value={model} onChange={setModel} disabled={!hasTranscript} />
              <Button variant="outline" size="sm" onClick={generate} disabled={!hasTranscript || generation.start.isPending}>
                <Sparkles /> Gerar de novo
              </Button>
              <Button variant="ghost" size="sm" onClick={() => navigator.clipboard.writeText(current.markdown).then(() => toast.success("Copiado"))}>
                <Copy /> Copiar
              </Button>
              <Button variant="outline" size="sm" onClick={() => setDraft(current.markdown)}>
                <Pencil /> Editar
              </Button>
            </>
          )}
        </div>
      </div>
      {failed}
      {viewing !== null && (
        <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
          Você está vendo uma versão antiga ({old.data ? versionLabel(old.data) : "carregando"}).
        </p>
      )}
      {shown ? <MarkdownView markdown={shown.markdown} /> : <Skeleton className="h-64 w-full" />}
    </div>
  )
}
