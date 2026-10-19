import { useDeferredValue, useEffect, useState } from "react"
import { useNavigate } from "react-router"
import { FileText, Library, Moon, Plus, Search, Sun } from "lucide-react"

import {
  Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator, CommandShortcut,
} from "@/components/ui/command"
import { StatusBadge } from "@/components/meetings/status-badge"
import { useTheme } from "@/components/theme-provider"
import { useMeetings } from "@/hooks/use-meetings"
import { formatDate, formatDuration } from "@/lib/format"

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform)
export const paletteShortcut = isMac ? "⌘K" : "Ctrl K"

/** Ctrl/⌘+K: jump to any meeting (searching titles, participants and what was said) or run an action. */
export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate()
  const { resolvedTheme, setTheme } = useTheme()
  const [search, setSearch] = useState("")
  const query = useDeferredValue(search.trim())
  const { data: meetings = [], isFetching } = useMeetings(query.length >= 2 ? query : undefined)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault()
        onOpenChange(!open)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onOpenChange])

  useEffect(() => {
    if (!open) setSearch("")
  }, [open])

  const run = (action: () => void) => {
    onOpenChange(false)
    action()
  }

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Busca rápida" description="Procure reuniões ou execute uma ação">
      {/* Filtering happens on the server, which also searches inside transcripts. */}
      <Command shouldFilter={false}>
      <CommandInput value={search} onValueChange={setSearch} placeholder="Buscar reunião, pessoa ou algo que foi dito…" />
      <CommandList className="max-h-[60vh]">
        <CommandEmpty>{isFetching ? "Buscando…" : "Nada encontrado."}</CommandEmpty>
        {meetings.length > 0 && (
          <CommandGroup heading={query.length >= 2 ? "Resultados" : "Reuniões recentes"}>
            {meetings.slice(0, 8).map((meeting) => (
              <CommandItem key={meeting.id} value={meeting.id} onSelect={() => run(() => navigate(`/reunioes/${meeting.id}`))}>
                <FileText />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-medium">{meeting.title}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {formatDate(meeting.date)} · {formatDuration(meeting.audio_duration)}
                    {meeting.participants.length > 0 && ` · ${meeting.participants.join(", ")}`}
                  </span>
                </div>
                <StatusBadge status={meeting.status} className="hidden sm:inline-flex" />
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        <CommandSeparator />
        <CommandGroup heading="Ações">
          <CommandItem value="nova" onSelect={() => run(() => navigate("/nova"))}>
            <Plus /> Nova reunião
          </CommandItem>
          <CommandItem value="biblioteca" onSelect={() => run(() => navigate("/"))}>
            <Library /> Todas as reuniões
          </CommandItem>
          <CommandItem value="tema" onSelect={() => run(() => setTheme(resolvedTheme === "dark" ? "light" : "dark"))}>
            {resolvedTheme === "dark" ? <Sun /> : <Moon />} Tema {resolvedTheme === "dark" ? "claro" : "escuro"}
          </CommandItem>
        </CommandGroup>
      </CommandList>
      </Command>
    </CommandDialog>
  )
}

export function SearchButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-lg border bg-background px-3 py-2 text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
    >
      <Search className="size-4" />
      <span className="flex-1 text-left">Buscar</span>
      <CommandShortcut className="rounded border bg-muted px-1.5 py-0.5 text-[10px] tracking-normal">{paletteShortcut}</CommandShortcut>
    </button>
  )
}
