import { useState } from "react"
import { MessagesSquare } from "lucide-react"

import { AgentChat, type AgentMessage } from "@/components/ui/agent-chat"

/**
 * Chat with the meeting. The AgentChat view is wired now; the Ollama streaming backend
 * (POST /api/meetings/{id}/chat) arrives in phase 7, so replies are a placeholder.
 */
export function ChatPanel() {
  const [messages, setMessages] = useState<AgentMessage[]>([])
  const empty = messages.length === 0

  return (
    <div className="flex h-[60vh] min-h-[420px] flex-col overflow-hidden rounded-xl border bg-white dark:bg-neutral-900">
      {empty && (
        <div className="flex flex-col items-center gap-2 px-6 pt-14 text-center">
          <span className="grid size-11 place-items-center rounded-full bg-muted text-muted-foreground">
            <MessagesSquare className="size-5" />
          </span>
          <div className="font-medium">Pergunte sobre esta reunião</div>
          <p className="max-w-sm text-sm text-muted-foreground">
            "Quais tarefas ficaram com a Ana?" · "Resuma as decisões" · "O que foi dito sobre o orçamento?"
          </p>
        </div>
      )}
      <AgentChat
        className="h-auto flex-1"
        messages={messages}
        status="ready"
        emptyStatePosition="center"
        placeholder="Pergunte algo sobre a reunião…"
        onSend={({ content }) =>
          setMessages((previous) => [
            ...previous,
            { id: crypto.randomUUID(), role: "user", parts: [{ type: "text", text: content }] },
            {
              id: crypto.randomUUID(),
              role: "assistant",
              parts: [{ type: "error", title: "Chat chega na fase 7", message: "A conversa com o Ollama sobre a transcrição e a ata ainda não está ligada." }],
            },
          ])
        }
      />
    </div>
  )
}
