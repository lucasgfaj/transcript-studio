import { useState, type ReactNode } from "react"
import { Link, NavLink } from "react-router"
import { AudioLines, BookText, Boxes, Library, Menu, Plus, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { ThemeToggle } from "@/components/theme-toggle"
import { useHealth } from "@/hooks/use-meetings"
import { cn } from "@/lib/utils"

const nav = [
  { to: "/", label: "Reuniões", icon: Library, end: true },
  { to: "/nova", label: "Nova reunião", icon: Plus },
  { to: "/modelos", label: "Modelos", icon: Boxes, soon: true },
  { to: "/contexto", label: "Contexto", icon: BookText, soon: true },
]

function OllamaStatus() {
  const { data, isLoading } = useHealth()
  const online = data?.ollama
  return (
    <div className="flex items-center gap-2 rounded-lg border px-3 py-2 text-xs text-muted-foreground">
      <span
        className={cn(
          "size-2 rounded-full",
          isLoading ? "bg-muted-foreground/40" : online ? "bg-emerald-500 shadow-[0_0_8px] shadow-emerald-500/60" : "bg-red-500",
        )}
      />
      <div className="min-w-0 leading-tight">
        <div className="font-medium text-foreground">Ollama {isLoading ? "…" : online ? "online" : "offline"}</div>
        <div className="truncate">{data?.default_llm ?? "verificando"}</div>
        <div className="truncate">
          GPU: {data?.gpu_job ? `ocupada${data.queued_jobs ? ` · ${data.queued_jobs} na fila` : ""}` : "livre"}
        </div>
      </div>
    </div>
  )
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col gap-6 p-4">
      <Link to="/" onClick={onNavigate} className="flex items-center gap-2.5 px-2 pt-1">
        <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
          <AudioLines className="size-4" />
        </span>
        <span className="font-heading text-[15px] font-semibold tracking-tight">Transcript Studio</span>
      </Link>
      <nav className="flex flex-col gap-1">
        {nav.map(({ to, label, icon: Icon, end, soon }) =>
          soon ? (
            <span key={to} className="flex cursor-not-allowed items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground/60">
              <Icon className="size-4" />
              {label}
              <span className="ml-auto rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide">em breve</span>
            </span>
          ) : (
            <NavLink
              key={to}
              to={to}
              end={end}
              onClick={onNavigate}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                  isActive ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )
              }
            >
              <Icon className="size-4" />
              {label}
            </NavLink>
          ),
        )}
      </nav>
      <div className="mt-auto flex flex-col gap-3">
        <OllamaStatus />
        <div className="flex items-center justify-between px-1 text-xs text-muted-foreground">
          <span>100% local</span>
          <ThemeToggle />
        </div>
      </div>
    </div>
  )
}

export function AppShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="min-h-svh bg-background">
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r bg-sidebar lg:block">
        <Sidebar />
      </aside>

      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur lg:hidden">
        <Button variant="ghost" size="icon" aria-label="Abrir menu" onClick={() => setOpen(true)}>
          <Menu />
        </Button>
        <span className="font-heading font-semibold">Transcript Studio</span>
      </header>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 border-r bg-sidebar shadow-xl animate-in slide-in-from-left">
            <Button variant="ghost" size="icon" className="absolute top-3 right-3" aria-label="Fechar menu" onClick={() => setOpen(false)}>
              <X />
            </Button>
            <Sidebar onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}

      <main className="lg:pl-64">
        <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-10 lg:py-10">{children}</div>
      </main>
    </div>
  )
}
