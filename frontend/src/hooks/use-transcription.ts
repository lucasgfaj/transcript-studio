import { useEffect, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { api, isActive, type Job, type JobEvent, type LiveSegment, type TranscriptionMode } from "@/lib/api"

/**
 * Latest transcription job of a meeting. While it is active, follows it over SSE and
 * accumulates the segments as Whisper produces them.
 */
export function useTranscription(meetingId: string) {
  const client = useQueryClient()
  const jobQuery = useQuery({ queryKey: ["meeting", meetingId, "job"], queryFn: () => api.latestJob(meetingId) })
  const job = jobQuery.data ?? null
  const [live, setLive] = useState<{ jobId: string; job: Job; segments: LiveSegment[] } | null>(null)

  const activeId = isActive(job) ? job!.id : null

  useEffect(() => {
    if (!activeId) return
    const source = new EventSource(api.jobEventsUrl(activeId))
    const refresh = () => {
      client.invalidateQueries({ queryKey: ["meeting", meetingId] })
      client.invalidateQueries({ queryKey: ["meetings"] })
    }
    source.onmessage = (message) => {
      const event = JSON.parse(message.data) as JobEvent
      setLive((current) => {
        const base = current?.jobId === activeId ? current : { jobId: activeId, job: job!, segments: [] }
        switch (event.type) {
          case "snapshot":
            return { jobId: activeId, job: event.job, segments: event.segments }
          case "status":
            return { ...base, job: { ...base.job, status: event.status, message: event.message } }
          case "segments":
            return { ...base, job: { ...base.job, progress: event.progress }, segments: [...base.segments, ...event.segments] }
          default:
            return { ...base, job: event.job }
        }
      })
      if (event.type === "done" || event.type === "error" || event.type === "cancelled") {
        source.close()
        refresh()
      }
    }
    // EventSource reconnects by itself; a reconnect replays the snapshot, so nothing is lost.
    return () => source.close()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, meetingId, client])

  const current = live && live.jobId === job?.id ? live.job : job

  const start = useMutation({
    mutationFn: (options: { mode: TranscriptionMode; language: string | null }) => api.transcribe(meetingId, options),
    onSuccess: (created) => {
      setLive({ jobId: created.id, job: created, segments: [] })
      client.setQueryData(["meeting", meetingId, "job"], created)
      client.invalidateQueries({ queryKey: ["meeting", meetingId] })
      client.invalidateQueries({ queryKey: ["meetings"] })
    },
  })

  const cancel = useMutation({ mutationFn: () => api.cancelJob(current!.id) })

  return {
    job: current,
    active: isActive(current),
    liveSegments: live && live.jobId === job?.id && isActive(current) ? live.segments : null,
    start,
    cancel,
    isLoading: jobQuery.isLoading,
  }
}
