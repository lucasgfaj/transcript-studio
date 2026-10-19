import { useState } from "react"
import { Check, Copy, FileText, Pencil, X } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { useSaveTranscript, useTranscript } from "@/hooks/use-meetings"
import { formatClock } from "@/lib/format"

export function TranscriptPanel({ meetingId, onSeek }: { meetingId: string; onSeek?: (seconds: number) => void }) {
  const { data, isLoading } = useTranscript(meetingId)
  const save = useSaveTranscript(meetingId)
  const [draft, setDraft] = useState<string | null>(null)

  if (isLoading || !data) return <Skeleton className="h-64 w-full" />

  if (draft !== null) {
    return (
      <div className="flex flex-col gap-3">
        <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} className="min-h-[50vh] font-mono text-sm leading-relaxed" autoFocus />
        <div className="flex justify-end gap-2">
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
    )
  }

  if (!data.text) {
    return (
      <div className="flex flex-col items-center gap-3 py-12 text-center">
        <span className="grid size-12 place-items-center rounded-full bg-muted text-muted-foreground">
          <FileText className="size-6" />
        </span>
        <div className="font-medium">Sem transcrição ainda</div>
        <p className="max-w-sm text-sm text-muted-foreground">
          A transcrição automática com o Whisper na GPU chega na fase 2. Por enquanto você pode colar o texto.
        </p>
        <Button variant="outline" onClick={() => setDraft("")}>
          <Pencil /> Colar transcrição
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigator.clipboard.writeText(data.text).then(() => toast.success("Copiado"))}
        >
          <Copy /> Copiar
        </Button>
        <Button variant="outline" size="sm" onClick={() => setDraft(data.text)}>
          <Pencil /> Editar
        </Button>
      </div>
      {data.segments.length ? (
        <ol className="flex flex-col">
          {data.segments.map((segment) => (
            <li key={segment.idx} className="group flex gap-3 rounded-lg px-2 py-1.5 hover:bg-muted/50">
              <button
                className="shrink-0 pt-0.5 font-mono text-xs tabular-nums text-muted-foreground hover:text-primary"
                onClick={() => segment.start !== null && onSeek?.(segment.start)}
              >
                {segment.start !== null ? formatClock(segment.start) : "--:--"}
              </button>
              <p className="text-[15px] leading-relaxed">{segment.text}</p>
            </li>
          ))}
        </ol>
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
