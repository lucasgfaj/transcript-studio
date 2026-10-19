import { Loader2 } from "lucide-react"

import type { MeetingStatus } from "@/lib/api"
import { statusInfo } from "@/lib/format"
import { cn } from "@/lib/utils"

const tones = {
  muted: "bg-muted text-muted-foreground",
  info: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  progress: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  success: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  error: "bg-red-500/10 text-red-700 dark:text-red-300",
}

export function StatusBadge({ status, className }: { status: MeetingStatus; className?: string }) {
  const { label, tone } = statusInfo[status]
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap", tones[tone], className)}>
      {tone === "progress" ? <Loader2 className="size-3 animate-spin" /> : <span className="size-1.5 rounded-full bg-current" />}
      {label}
    </span>
  )
}
