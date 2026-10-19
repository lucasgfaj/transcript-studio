import { useEffect, useRef } from "react"
import { Link } from "react-router"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { AudioWaveform, Cpu, Loader2, Sparkles } from "lucide-react"
import { toast } from "sonner"

import { api, type ActiveJob } from "@/lib/api"
import { cn } from "@/lib/utils"

/**
 * What the GPU is doing right now (it runs one job at a time). Also tells the user when a job
 * finishes while they are on another page.
 */
export function GpuQueue({ onNavigate }: { onNavigate?: () => void }) {
  const client = useQueryClient()
  const { data: jobs = [] } = useQuery({
    queryKey: ["jobs", "active"],
    queryFn: api.activeJobs,
    refetchInterval: (query) => (query.state.data?.length ? 2000 : 10_000),
  })
  const previous = useRef<ActiveJob[]>([])

  useEffect(() => {
    const finished = previous.current.filter((old) => !jobs.some((job) => job.id === old.id))
    previous.current = jobs
    for (const job of finished) {
      void api.getJobSafe(job.id).then((done) => {
        if (!done) return
        client.invalidateQueries({ queryKey: ["meeting", job.meeting_id] })
        client.invalidateQueries({ queryKey: ["meetings"] })
        const what = job.kind === "transcribe" ? "Transcrição" : "Ata"
        if (done.status === "done") toast.success(`${what} pronta`, { description: job.meeting_title })
        else if (done.status === "error") toast.error(`${what} falhou`, { description: `${job.meeting_title}: ${done.error ?? ""}` })
      })
    }
  }, [jobs, client])

  if (!jobs.length) {
    return (
      <div className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
        <Cpu className="size-3.5" /> GPU livre
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1.5 rounded-lg border p-2">
      <div className="flex items-center gap-2 px-1 text-xs font-medium">
        <Cpu className="size-3.5" /> GPU · {jobs.length} {jobs.length === 1 ? "tarefa" : "tarefas"}
      </div>
      {jobs.map((job, index) => {
        const Icon = job.kind === "transcribe" ? AudioWaveform : Sparkles
        const running = job.status === "running"
        return (
          <Link
            key={job.id}
            to={`/reunioes/${job.meeting_id}`}
            onClick={onNavigate}
            className="group flex flex-col gap-1 rounded-md px-1.5 py-1 hover:bg-muted"
          >
            <span className="flex items-center gap-1.5 text-xs">
              {running ? <Loader2 className="size-3 animate-spin text-amber-500" /> : <Icon className="size-3 text-muted-foreground" />}
              <span className="truncate font-medium group-hover:text-primary">{job.meeting_title}</span>
            </span>
            <span className="truncate pl-4.5 text-[11px] text-muted-foreground">
              {running ? job.message ?? "Processando" : `Na fila (${index}º)`}
            </span>
            {running && (
              <span className="ml-4.5 h-1 overflow-hidden rounded-full bg-muted">
                <span className={cn("block h-full rounded-full bg-amber-500 transition-[width]")} style={{ width: `${Math.max(4, job.progress * 100)}%` }} />
              </span>
            )}
          </Link>
        )
      })}
    </div>
  )
}
