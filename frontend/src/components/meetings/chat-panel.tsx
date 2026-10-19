import { useCallback, useMemo, useRef, useState, type ReactNode } from "react"
import Markdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Loader2, MessagesSquare, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { AgentChat, type AgentMessage, type ChatStatus } from "@/components/ui/agent-chat"
import { useTranscript } from "@/hooks/use-meetings"
import { api, type ChatMessage, type Segment } from "@/lib/api"

const SUGGESTIONS = [
  "Quais foram as decisões?",
  "Liste as tarefas e os responsáveis",
  "O que ficou pendente?",
  "Resuma em 5 tópicos",
]

const TIMESTAMP = /\[(\d{1,2}:\d{2}(?::\d{2})?)\]/g

function toSeconds(clock: string): number {
  return clock.split(":").map(Number).reduce((total, part) => total * 60 + part, 0)
}

function clock(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  const mm = String(m).padStart(2, "0")
  const ss = String(s).padStart(2, "0")
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

/** Same rule as the server: a cited time moves to the start of the segment that contains it. */
function snap(seconds: number, segments: Segment[]): number {
  const timed = segments.filter((s) => s.start !== null && s.end !== null)
  if (!timed.length) return seconds
  const inside = timed.find((s) => seconds >= s.start! && seconds < s.end!)
  if (inside) return inside.start!
  return timed.reduce((best, s) => (Math.abs(s.start! - seconds) < Math.abs(best - seconds) ? s.start! : best), timed[0].start!)
}

/** Assistant answers as Markdown; [12:34] citations become links that play the audio from there. */
function useAnswerRenderer(segments: Segment[], onSeek?: (seconds: number) => void) {
  return useCallback(
    (text: string): ReactNode => (
      <div className="prose prose-sm prose-neutral max-w-none dark:prose-invert prose-p:my-1.5 prose-ul:my-1.5 prose-li:my-0.5">
        <Markdown
          remarkPlugins={[remarkGfm]}
          components={{
            a: ({ href, children }) =>
              href?.startsWith("#t=") ? (
                <button
                  type="button"
                  onClick={() => onSeek?.(Number(href.slice(3)))}
                  className="rounded bg-primary/10 px-1 font-mono text-[12px] text-primary no-underline hover:bg-primary/20"
                  title="Ouvir este trecho"
                >
                  {children}
                </button>
              ) : (
                <a href={href} target="_blank" rel="noreferrer">{children}</a>
              ),
          }}
        >
          {text.replace(TIMESTAMP, (_match, cited: string) => {
            const at = snap(toSeconds(cited), segments)
            return `[${clock(at)}](#t=${at})`
          })}
        </Markdown>
      </div>
    ),
    [segments, onSeek],
  )
}

function toAgent(message: ChatMessage): AgentMessage {
  const text = message.interrupted ? `${message.content}\n\n_(resposta interrompida)_` : message.content
  return { id: String(message.id), role: message.role, parts: [{ type: "text", text }] }
}

/** Conversation about the meeting, answered by the local LLM from the minutes and transcript excerpts. */
export function ChatPanel({ meetingId, ready, onSeek }: { meetingId: string; ready: boolean; onSeek?: (seconds: number) => void }) {
  const client = useQueryClient()
  const { data: history = [], isLoading } = useQuery({ queryKey: ["meeting", meetingId, "chat"], queryFn: () => api.chatHistory(meetingId) })
  const [pending, setPending] = useState<{ question: string; answer: string; note: string | null } | null>(null)
  const [status, setStatus] = useState<ChatStatus>("ready")
  const [error, setError] = useState<{ title: string; message: string } | undefined>()
  const abort = useRef<AbortController | null>(null)
  const { data: transcript } = useTranscript(meetingId)
  const renderAnswer = useAnswerRenderer(transcript?.segments ?? [], onSeek)

  const messages = useMemo(() => {
    const list = history.map(toAgent)
    if (pending) {
      list.push({ id: "pending-question", role: "user", parts: [{ type: "text", text: pending.question }] })
      list.push({
        id: "pending-answer",
        role: "assistant",
        parts: [{ type: "text", text: pending.answer || `_${pending.note ?? "Pensando…"}_` }],
      })
    }
    return list
  }, [history, pending])

  const send = async (question: string) => {
    if (!ready || status !== "ready") return
    setError(undefined)
    setPending({ question, answer: "", note: null })
    setStatus("submitted")
    const controller = new AbortController()
    abort.current = controller
    try {
      await api.askChat(meetingId, question, (event) => {
        if (event.type === "status") setPending((p) => p && { ...p, note: event.message })
        else if (event.type === "token") {
          setStatus("streaming")
          setPending((p) => p && { ...p, answer: p.answer + event.text })
        } else if (event.type === "error") setError({ title: "O modelo não respondeu", message: event.message })
      }, controller.signal)
    } catch (err) {
      if (!controller.signal.aborted) {
        setError({ title: "Não consegui perguntar", message: err instanceof Error ? err.message : String(err) })
      }
    } finally {
      abort.current = null
      await client.invalidateQueries({ queryKey: ["meeting", meetingId, "chat"] })
      setPending(null)
      setStatus("ready")
    }
  }

  const clear = async () => {
    await api.clearChat(meetingId)
    await client.invalidateQueries({ queryKey: ["meeting", meetingId, "chat"] })
    setError(undefined)
    toast.success("Conversa apagada")
  }

  const empty = !isLoading && messages.length === 0

  return (
    <div className="flex h-[65vh] min-h-[460px] flex-col overflow-hidden rounded-xl border bg-white dark:bg-neutral-900">
      {!empty && (
        <div className="flex items-center justify-between border-b px-4 py-2 text-xs text-muted-foreground">
          <span>Respostas com base na ata e nos trechos da transcrição · clique no horário para ouvir</span>
          <Button variant="ghost" size="xs" disabled={status !== "ready"} onClick={() => void clear()}>
            <Trash2 /> Limpar
          </Button>
        </div>
      )}
      {empty && (
        <div className="flex flex-col items-center gap-3 px-6 pt-12 text-center">
          <span className="grid size-11 place-items-center rounded-full bg-muted text-muted-foreground">
            <MessagesSquare className="size-5" />
          </span>
          <div className="font-medium">Pergunte sobre esta reunião</div>
          {ready ? (
            <div className="flex max-w-md flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => void send(suggestion)}
                  className="rounded-full border px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          ) : (
            <p className="max-w-sm text-sm text-muted-foreground">Transcreva a reunião primeiro para poder conversar sobre ela.</p>
          )}
        </div>
      )}
      {isLoading ? (
        <div className="flex flex-1 items-center justify-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
      ) : (
        <AgentChat
          className="h-auto flex-1"
          messages={messages}
          status={status}
          error={error}
          emptyStatePosition="center"
          placeholder={ready ? "Pergunte algo sobre a reunião…" : "Transcreva a reunião para conversar"}
          renderText={renderAnswer}
          onSend={({ content }) => void send(content)}
          onStop={() => abort.current?.abort()}
        />
      )}
    </div>
  )
}
