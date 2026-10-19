import { useEffect, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"

import { api, isActive, type Job, type JobEvent, type JobKind, type LiveSegment } from "@/lib/api"

interface LiveState {
  jobId: string
  job: Job
  segments: LiveSegment[]
  text: string
}

/**
 * Latest job of one kind for a meeting. While it is active, follows it over SSE and accumulates
 * what it produces (transcript segments or minutes text). EventSource reconnects by itself and
 * every reconnect starts with a snapshot, so nothing is lost.
 */
export function useMeetingJob(meetingId: string, kind: JobKind) {
  const client = useQueryClient()
  const queryKey = ["meeting", meetingId, "job", kind]
  const { data, isLoading } = useQuery({ queryKey, queryFn: () => api.latestJob(meetingId, kind) })
  const latest = data ?? null
  const [live, setLive] = useState<LiveState | null>(null)
  const activeId = isActive(latest) ? latest!.id : null

  useEffect(() => {
    if (!activeId || !latest) return
    const source = new EventSource(api.jobEventsUrl(activeId))
    source.onmessage = (message) => {
      const event = JSON.parse(message.data) as JobEvent
      setLive((current) => {
        const base: LiveState = current?.jobId === activeId ? current : { jobId: activeId, job: latest, segments: [], text: "" }
        switch (event.type) {
          case "snapshot":
            return { jobId: activeId, job: event.job, segments: event.segments, text: event.text ?? "" }
          case "status":
            return {
              ...base,
              job: {
                ...base.job,
                status: event.status,
                message: event.message,
                progress: event.progress ?? base.job.progress,
                // The status event carries no timestamp; the job started when it first turned "running".
                started_at: base.job.started_at ?? (event.status === "running" ? new Date().toISOString() : null),
              },
            }
          case "segments":
            return { ...base, job: { ...base.job, progress: event.progress }, segments: [...base.segments, ...event.segments] }
          case "token":
            return { ...base, text: base.text + event.text }
          default:
            return { ...base, job: event.job }
        }
      })
      if (event.type === "done" || event.type === "error" || event.type === "cancelled") {
        source.close()
        client.invalidateQueries({ queryKey: ["meeting", meetingId] })
        client.invalidateQueries({ queryKey: ["meetings"] })
      }
    }
    return () => source.close()
    // `latest` only seeds the first state; reconnecting on every refetch would replay the stream.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, meetingId, client])

  const fresh = live && live.jobId === latest?.id ? live : null
  const job = fresh ? fresh.job : latest
  const active = isActive(job)

  /** Call after creating a job so the hook starts following it immediately. */
  const track = (created: Job) => {
    setLive({ jobId: created.id, job: created, segments: [], text: "" })
    client.setQueryData(queryKey, created)
    client.invalidateQueries({ queryKey: ["meeting", meetingId], exact: true })
    client.invalidateQueries({ queryKey: ["meetings"] })
  }

  return {
    job,
    active,
    isLoading,
    liveSegments: active && fresh ? fresh.segments : null,
    liveText: active && fresh ? fresh.text : null,
    track,
  }
}
