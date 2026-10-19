import { useEffect, useState } from "react"
import Markdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { BookText, Check, Eye, FilePlus2, FileText, Info, Loader2, Pencil, Save, Trash2 } from "lucide-react"
import { toast } from "sonner"

import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { useDocumentTitle } from "@/hooks/use-document-title"
import { api, type ContextFile } from "@/lib/api"
import { cn } from "@/lib/utils"

function FileList({ files, selected, onSelect }: { files: ContextFile[]; selected: string | null; onSelect: (path: string) => void }) {
  return (
    <ul className="flex flex-col gap-0.5">
      {files.map((file) => {
        const depth = file.path.split("/").length - 1
        return (
          <li key={file.path}>
            <button
              onClick={() => onSelect(file.path)}
              className={cn(
                "flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors",
                selected === file.path ? "bg-muted font-medium" : "hover:bg-muted/50",
              )}
              style={{ paddingLeft: 8 + depth * 12 }}
            >
              <FileText className={cn("mt-0.5 size-3.5 shrink-0", file.included ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")} />
              <span className="min-w-0 flex-1">
                <span className="block truncate">{file.path.split("/").pop()}</span>
                <span className="block truncate text-[11px] font-normal text-muted-foreground">
                  {depth > 0 && `${file.path.split("/").slice(0, -1).join("/")} · `}
                  {file.chars.toLocaleString("pt-BR")} car. · {file.included ? "no prompt" : file.reason}
                </span>
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

function Editor({ path, onDeleted }: { path: string; onDeleted: () => void }) {
  const client = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: ["context", "file", path], queryFn: () => api.contextFile(path) })
  const [draft, setDraft] = useState<string | null>(null)
  const [preview, setPreview] = useState(false)
  const [confirm, setConfirm] = useState(false)
  useEffect(() => {
    setDraft(null)
    setPreview(false)
  }, [path])

  const save = useMutation({
    mutationFn: (content: string) => api.saveContextFile(path, content),
    onSuccess: (saved) => {
      client.setQueryData(["context", "file", path], saved)
      client.invalidateQueries({ queryKey: ["context"], exact: true })
      setDraft(null)
      toast.success("Contexto salvo", { description: "Vale para as próximas atas." })
    },
    onError: (error) => toast.error("Não consegui salvar", { description: error.message }),
  })
  const remove = useMutation({
    mutationFn: () => api.deleteContextFile(path),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["context"] })
      toast.success("Arquivo apagado")
      onDeleted()
    },
  })

  if (isLoading || !data) return <Skeleton className="h-80 w-full" />
  const content = draft ?? data.content
  const dirty = draft !== null && draft !== data.content

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="truncate font-mono text-sm">{path}{dirty && <span className="ml-1 text-amber-500">●</span>}</span>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => setPreview(!preview)}>
            {preview ? <><Pencil /> Editar</> : <><Eye /> Visualizar</>}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setConfirm(true)}><Trash2 /> Apagar</Button>
          <Button size="sm" disabled={!dirty || save.isPending} onClick={() => save.mutate(content)}>
            {save.isPending ? <Loader2 className="animate-spin" /> : dirty ? <Save /> : <Check />} {dirty ? "Salvar" : "Salvo"}
          </Button>
        </div>
      </div>
      {preview ? (
        <article className="prose prose-neutral min-h-[50vh] max-w-none rounded-lg border p-4 dark:prose-invert">
          <Markdown remarkPlugins={[remarkGfm]}>{content}</Markdown>
        </article>
      ) : (
        <Textarea
          value={content}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === "s") {
              e.preventDefault()
              if (dirty) save.mutate(content)
            }
          }}
          className="min-h-[50vh] font-mono text-sm leading-relaxed"
          spellCheck={false}
        />
      )}
      <p className="text-[11px] text-muted-foreground">{content.length.toLocaleString("pt-BR")} caracteres · Ctrl+S salva</p>
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apagar {path}?</AlertDialogTitle>
            <AlertDialogDescription>As próximas atas deixam de usar este arquivo para acertar nomes e termos.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => remove.mutate()}>Apagar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export function ContextPage() {
  useDocumentTitle("Contexto")
  const client = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: ["context"], queryFn: api.context })
  const [selected, setSelected] = useState<string | null>(null)
  const [newPath, setNewPath] = useState("")
  const [limit, setLimit] = useState<number | null>(null)

  const create = useMutation({
    mutationFn: (path: string) => api.saveContextFile(path, `# ${path.split("/").pop()!.replace(/\.md$/, "")}\n\n`),
    onSuccess: (file) => {
      client.invalidateQueries({ queryKey: ["context"] })
      setSelected(file.path)
      setNewPath("")
    },
    onError: (error) => toast.error("Não consegui criar", { description: error.message }),
  })
  const saveLimit = useMutation({
    mutationFn: (value: number) => api.updatePreferences({ context_max_chars: value }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["context"] })
      setLimit(null)
      toast.success("Limite salvo")
    },
    onError: (error) => toast.error("Não consegui salvar", { description: error.message }),
  })

  useEffect(() => {
    if (!selected && data?.files.length) setSelected((data.files.find((f) => f.included) ?? data.files[0]).path)
  }, [data, selected])

  if (isLoading || !data) return <Skeleton className="h-96 w-full" />
  const shownLimit = limit ?? data.max_chars
  const usage = Math.min(100, (data.used_chars / data.max_chars) * 100)
  const left = data.files.filter((f) => !f.included && f.reason === "não coube no limite").length

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="flex items-center gap-2 font-heading text-2xl font-semibold tracking-tight sm:text-3xl">
          <BookText className="size-6" /> Contexto
        </h1>
        <p className="text-sm text-muted-foreground">
          Glossário, pessoas e empresas que o modelo consulta para escrever nomes e siglas certos. Nunca vira fato na ata.
        </p>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
            <span>
              <span className="font-medium tabular-nums">{data.used_chars.toLocaleString("pt-BR")}</span> de{" "}
              {data.max_chars.toLocaleString("pt-BR")} caracteres vão para o prompt
            </span>
            {left > 0 && <span className="text-xs text-amber-700 dark:text-amber-300">{left} arquivo(s) ficaram de fora por falta de espaço</span>}
          </div>
          <Progress value={usage} />
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <label htmlFor="context-limit" className="text-xs text-muted-foreground">Limite</label>
            <input
              id="context-limit"
              type="range"
              min={1000}
              max={12000}
              step={500}
              value={shownLimit}
              onChange={(e) => setLimit(Number(e.target.value))}
              className="flex-1 accent-primary"
            />
            <span className="w-28 text-xs tabular-nums">{shownLimit.toLocaleString("pt-BR")} caracteres</span>
            <Button size="sm" variant="outline" disabled={limit === null || saveLimit.isPending} onClick={() => limit && saveLimit.mutate(limit)}>
              Salvar limite
            </Button>
          </div>
          <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
            <Info className="mt-0.5 size-3 shrink-0" /> Mais contexto acerta mais nomes, mas ocupa a janela do modelo (8 mil tokens) e deixa a ata um pouco mais lenta.
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
        <div className="flex flex-col gap-3">
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              const path = newPath.trim().replace(/\.md$/, "") + ".md"
              if (newPath.trim()) create.mutate(path)
            }}
          >
            <Input value={newPath} onChange={(e) => setNewPath(e.target.value)} placeholder="pessoas/ana" className="h-8 text-sm" />
            <Button type="submit" size="sm" variant="secondary" disabled={!newPath.trim()}><FilePlus2 /> Criar</Button>
          </form>
          {data.files.length ? (
            <FileList files={data.files} selected={selected} onSelect={setSelected} />
          ) : (
            <p className="text-sm text-muted-foreground">Nenhum arquivo ainda. Crie um glossário, por exemplo “glossario”.</p>
          )}
        </div>
        {selected ? <Editor path={selected} onDeleted={() => setSelected(null)} /> : <div />}
      </div>
    </div>
  )
}
