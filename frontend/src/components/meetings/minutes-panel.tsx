import { useState } from "react"
import Markdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { Check, Copy, Download, History, NotebookPen, Pencil, Sparkles, X } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { useMinutes, useSaveMinutes } from "@/hooks/use-meetings"
import { slugFile } from "@/lib/download"

function MarkdownView({ markdown }: { markdown: string }) {
  return (
    <article className="prose prose-neutral max-w-none dark:prose-invert prose-headings:font-heading prose-headings:tracking-tight prose-h1:text-2xl prose-li:my-0.5">
      <Markdown remarkPlugins={[remarkGfm]}>{markdown}</Markdown>
    </article>
  )
}

export function MinutesPanel({ meetingId, title }: { meetingId: string; title: string }) {
  const { data, isLoading } = useMinutes(meetingId)
  const save = useSaveMinutes(meetingId)
  const [draft, setDraft] = useState<string | null>(null)

  if (isLoading || !data) return <Skeleton className="h-64 w-full" />
  const current = data.current

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
            <Button
              disabled={!draft.trim() || save.isPending}
              onClick={() =>
                save.mutate(draft, {
                  onSuccess: () => {
                    toast.success("Ata salva")
                    setDraft(null)
                  },
                  onError: (error) => toast.error("Não consegui salvar", { description: error.message }),
                })
              }
            >
              <Check /> Salvar versão
            </Button>
          </div>
        </div>
      </div>
    )
  }

  if (!current) {
    return (
      <div className="flex flex-col items-center gap-3 py-12 text-center">
        <span className="grid size-12 place-items-center rounded-full bg-muted text-muted-foreground">
          <NotebookPen className="size-6" />
        </span>
        <div className="font-medium">Sem ata ainda</div>
        <p className="max-w-sm text-sm text-muted-foreground">
          A geração com o Ollama, com o texto aparecendo enquanto é escrito, chega na fase 3. Você já pode escrever ou colar uma ata.
        </p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setDraft(`# ${title}\n\n## Resumo\n\n## Decisões\n\n## Tarefas\n\n- [ ] \n`)}>
            <Pencil /> Escrever ata
          </Button>
          <Button disabled title="Fase 3">
            <Sparkles /> Gerar com IA
          </Button>
        </div>
      </div>
    )
  }

  const download = () => {
    const blob = new Blob([current.markdown], { type: "text/markdown;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const link = Object.assign(document.createElement("a"), { href: url, download: `${slugFile(title)}-ata.md` })
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <History className="size-3.5" />
          {data.history.length} {data.history.length === 1 ? "versão" : "versões"} · {current.model ?? "manual"} ·{" "}
          {new Date(current.created_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
        </span>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => navigator.clipboard.writeText(current.markdown).then(() => toast.success("Copiado"))}>
            <Copy /> Copiar
          </Button>
          <Button variant="ghost" size="sm" onClick={download}>
            <Download /> .md
          </Button>
          <Button variant="outline" size="sm" onClick={() => setDraft(current.markdown)}>
            <Pencil /> Editar
          </Button>
        </div>
      </div>
      <MarkdownView markdown={current.markdown} />
    </div>
  )
}
