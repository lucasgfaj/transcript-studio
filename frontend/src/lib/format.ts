import type { MeetingStatus } from "@/lib/api"

export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mm = String(m).padStart(h ? 2 : 1, "0")
  const ss = String(s).padStart(2, "0")
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

export function formatDuration(seconds: number | null | undefined): string {
  if (!seconds) return "—"
  const minutes = Math.round(seconds / 60)
  if (minutes < 1) return `${Math.round(seconds)} s`
  if (minutes < 60) return `${minutes} min`
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} min`
}

export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes) return "—"
  const units = ["B", "KB", "MB", "GB"]
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value.toFixed(unit ? 1 : 0)} ${units[unit]}`
}

/** "2026-09-24" -> "24 de set. de 2026" without timezone shifts. */
export function formatDate(isoDate: string, style: "long" | "short" = "long"): string {
  const [year, month, day] = isoDate.split("-").map(Number)
  return new Intl.DateTimeFormat("pt-BR", style === "long"
    ? { day: "2-digit", month: "short", year: "numeric" }
    : { day: "2-digit", month: "2-digit" },
  ).format(new Date(year, month - 1, day))
}

export function todayIso(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
}

export function splitNames(value: string): string[] {
  return value.split(",").map((name) => name.trim()).filter(Boolean)
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase()
}

export const statusInfo: Record<MeetingStatus, { label: string; tone: "muted" | "info" | "progress" | "success" | "error" }> = {
  draft: { label: "Rascunho", tone: "muted" },
  audio_ready: { label: "Aguardando transcrição", tone: "info" },
  transcribing: { label: "Transcrevendo", tone: "progress" },
  transcribed: { label: "Transcrita", tone: "info" },
  generating: { label: "Gerando ata", tone: "progress" },
  done: { label: "Ata pronta", tone: "success" },
  error: { label: "Erro", tone: "error" },
}
