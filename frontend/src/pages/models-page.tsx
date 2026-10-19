import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { AudioWaveform, Check, Cpu, Download, ExternalLink, HardDrive, Loader2, Sparkles, Star, Trash2, Zap } from "lucide-react"
import { toast } from "sonner"

import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import { useDocumentTitle } from "@/hooks/use-document-title"
import { api, type LlmModel, type PullEvent } from "@/lib/api"
import { formatBytes } from "@/lib/format"
import { cn } from "@/lib/utils"

const statusLabels: Record<string, string> = {
  "pulling manifest": "Lendo o manifesto",
  "verifying sha256 digest": "Verificando",
  "writing manifest": "Finalizando",
  success: "Pronto",
}

function pullLabel(event: PullEvent): string {
  if (event.error) return event.error
  if (event.percent != null) return `Baixando ${event.percent.toFixed(0)}% · ${formatBytes(event.completed)} de ${formatBytes(event.total)}`
  return statusLabels[event.status ?? ""] ?? event.status ?? "Baixando"
}

function Pill({ tone, children }: { tone: "green" | "amber" | "blue" | "muted"; children: React.ReactNode }) {
  const tones = {
    green: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    amber: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
    blue: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
    muted: "bg-muted text-muted-foreground",
  }
  return <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium", tones[tone])}>{children}</span>
}

function usePulls() {
  const client = useQueryClient()
  const [pulls, setPulls] = useState<Record<string, PullEvent>>({})
  const start = async (name: string) => {
    const clean = name.trim()
    if (!clean || pulls[clean]) return
    setPulls((current) => ({ ...current, [clean]: { status: "pulling manifest" } }))
    let failed: string | null = null
    try {
      await api.pullModel(clean, (event) => {
        if (event.error) failed = event.error
        setPulls((current) => ({ ...current, [clean]: event }))
      })
    } catch (error) {
      failed = error instanceof Error ? error.message : String(error)
    }
    if (failed) toast.error(`Não consegui baixar ${clean}`, { description: failed })
    else toast.success(`${clean} instalado`)
    setPulls(({ [clean]: _done, ...rest }) => rest)
    client.invalidateQueries({ queryKey: ["models"] })
  }
  return { pulls, start }
}

function InstalledModel({ model, isDefault, onDefault, onDelete }: {
  model: LlmModel
  isDefault: boolean
  onDefault: () => void
  onDelete: () => void
}) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm font-medium">{model.name}</span>
          {isDefault && <Pill tone="blue"><Star className="size-3 fill-current" /> Padrão da ata</Pill>}
          {model.loaded && <Pill tone="green"><Zap className="size-3" /> Na GPU agora{model.vram ? ` · ${formatBytes(model.vram)}` : ""}</Pill>}
          {model.fits_gpu === true && <Pill tone="muted"><Cpu className="size-3" /> Cabe inteiro na GPU</Pill>}
          {model.fits_gpu === false && <Pill tone="amber">Parte roda na CPU (mais lento)</Pill>}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {[model.parameter_size && `${model.parameter_size} parâmetros`, model.quantization, formatBytes(model.size)].filter(Boolean).join(" · ")}
        </p>
      </div>
      <div className="flex gap-2">
        {!isDefault && (
          <Button variant="outline" size="sm" onClick={onDefault}>
            <Star /> Usar como padrão
          </Button>
        )}
        <Button variant="ghost" size="sm" disabled={isDefault} onClick={onDelete} title={isDefault ? "Escolha outro padrão antes" : "Apagar do disco"}>
          <Trash2 /> Apagar
        </Button>
      </div>
    </div>
  )
}

export function ModelsPage() {
  useDocumentTitle("Modelos")
  const client = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: ["models"], queryFn: api.models, refetchInterval: 15_000 })
  const { pulls, start } = usePulls()
  const [custom, setCustom] = useState("")
  const [deleting, setDeleting] = useState<string | null>(null)

  const preferences = useMutation({
    mutationFn: api.updatePreferences,
    onSuccess: (_prefs, changes) => {
      client.invalidateQueries({ queryKey: ["models"] })
      client.invalidateQueries({ queryKey: ["health"] })
      if (changes.default_llm) toast.success(`Novas atas usarão ${changes.default_llm}`)
      if (changes.whisper_model) toast.success(`Whisper trocado para ${changes.whisper_model}`, { description: "Carrega quando a GPU estiver livre." })
    },
    onError: (error) => toast.error("Não consegui salvar", { description: error.message }),
  })
  const remove = useMutation({
    mutationFn: api.deleteModel,
    onSuccess: (_r, name) => {
      toast.success(`${name} apagado`)
      client.invalidateQueries({ queryKey: ["models"] })
    },
    onError: (error) => toast.error("Não consegui apagar", { description: error.message }),
  })

  if (isLoading || !data) {
    return <div className="flex flex-col gap-4">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-40" />)}</div>
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight sm:text-3xl">Modelos</h1>
        <p className="text-sm text-muted-foreground">
          Tudo roda na sua GPU de {data.gpu_memory_gb.toLocaleString("pt-BR")} GB. Modelos que cabem inteiros nela são bem mais rápidos.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Sparkles className="size-4" /> Modelo da ata (Ollama)</CardTitle>
          <CardDescription>O padrão é usado ao gerar atas; dá para escolher outro na hora de gerar.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {!data.available && (
            <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">
              O Ollama não está respondendo. Abra o Ollama no Windows e recarregue a página.
            </p>
          )}
          {data.models.map((model) => (
            <InstalledModel
              key={model.name}
              model={model}
              isDefault={model.name === data.default}
              onDefault={() => preferences.mutate({ default_llm: model.name })}
              onDelete={() => setDeleting(model.name)}
            />
          ))}
          {data.available && !data.models.length && <p className="text-sm text-muted-foreground">Nenhum modelo instalado ainda.</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Download className="size-4" /> Baixar modelo</CardTitle>
          <CardDescription>Sugestões para a sua GPU. O download vai para o Ollama no Windows e pode levar alguns minutos.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            {data.catalog.map((item) => {
              const pull = pulls[item.name]
              const fits = item.approx_gb + 1.2 <= data.gpu_memory_gb
              return (
                <div key={item.name} className="flex flex-col gap-2 rounded-xl border p-4">
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-mono text-sm font-medium">{item.name}</span>
                    <span className="flex items-center gap-1 text-xs text-muted-foreground"><HardDrive className="size-3" /> ~{item.approx_gb.toLocaleString("pt-BR")} GB</span>
                  </div>
                  <p className="text-xs text-muted-foreground">{item.description}</p>
                  {!fits && <Pill tone="amber">Não cabe inteiro na GPU</Pill>}
                  {pull ? (
                    <div className="mt-auto flex flex-col gap-1">
                      <Progress value={pull.percent ?? 2} />
                      <span className="text-[11px] text-muted-foreground tabular-nums">{pullLabel(pull)}</span>
                    </div>
                  ) : item.installed ? (
                    <span className="mt-auto flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400"><Check className="size-3.5" /> Instalado</span>
                  ) : (
                    <Button variant="outline" size="sm" className="mt-auto w-fit" disabled={!data.available} onClick={() => void start(item.name)}>
                      <Download /> Baixar
                    </Button>
                  )}
                </div>
              )
            })}
          </div>
          <form
            className="flex flex-col gap-2 sm:flex-row"
            onSubmit={(event) => {
              event.preventDefault()
              void start(custom)
              setCustom("")
            }}
          >
            <Input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Outro modelo do Ollama, ex.: mistral:7b" className="sm:max-w-sm" />
            <Button type="submit" variant="secondary" disabled={!custom.trim() || !data.available}><Download /> Baixar</Button>
            <a href="https://ollama.com/library" target="_blank" rel="noreferrer" className="flex items-center gap-1 self-center text-xs text-muted-foreground hover:text-foreground">
              Ver a biblioteca do Ollama <ExternalLink className="size-3" />
            </a>
          </form>
          {Object.entries(pulls).filter(([name]) => !data.catalog.some((c) => c.name === name)).map(([name, pull]) => (
            <div key={name} className="flex flex-col gap-1 rounded-lg border p-3">
              <span className="font-mono text-sm">{name}</span>
              <Progress value={pull.percent ?? 2} />
              <span className="text-[11px] text-muted-foreground">{pullLabel(pull)}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><AudioWaveform className="size-4" /> Transcrição (Whisper)</CardTitle>
          <CardDescription>Modelos ainda não baixados são baixados na primeira transcrição.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2" role="radiogroup" aria-label="Modelo do Whisper">
          {data.whisper.map((model) => (
            <button
              key={model.name}
              role="radio"
              aria-checked={model.active}
              disabled={preferences.isPending}
              onClick={() => !model.active && preferences.mutate({ whisper_model: model.name })}
              className={cn(
                "flex items-center gap-3 rounded-xl border p-3 text-left transition-colors",
                model.active ? "border-primary bg-primary/5" : "hover:bg-muted/50",
              )}
            >
              <span className={cn("grid size-4 shrink-0 place-items-center rounded-full border", model.active && "border-primary")}>
                {model.active && <span className="size-2 rounded-full bg-primary" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="font-mono text-sm font-medium">{model.name}</span>
                <span className="block text-xs text-muted-foreground">{model.description}</span>
              </span>
              {model.downloaded ? <Pill tone="green">Baixado</Pill> : <Pill tone="muted">Não baixado</Pill>}
            </button>
          ))}
          {preferences.isPending && <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="size-3 animate-spin" /> Salvando…</p>}
        </CardContent>
      </Card>

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apagar {deleting}?</AlertDialogTitle>
            <AlertDialogDescription>O modelo sai do Ollama e libera espaço em disco. Dá para baixar de novo depois.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => deleting && remove.mutate(deleting)}>Apagar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
