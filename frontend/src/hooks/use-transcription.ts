import { useMutation, useQuery } from "@tanstack/react-query"

import { useMeetingJob } from "@/hooks/use-job"
import { api, type TranscriptionMode } from "@/lib/api"

export function useTranscription(meetingId: string) {
  const job = useMeetingJob(meetingId, "transcribe")
  const start = useMutation({
    mutationFn: (options: { mode: TranscriptionMode; language: string | null }) => api.transcribe(meetingId, options),
    onSuccess: job.track,
  })
  const cancel = useMutation({ mutationFn: () => api.cancelJob(job.job!.id) })
  return { ...job, start, cancel }
}

export function useMinutesGeneration(meetingId: string) {
  const job = useMeetingJob(meetingId, "minutes")
  const start = useMutation({
    mutationFn: (model: string | null) => api.generateMinutes(meetingId, model),
    onSuccess: job.track,
  })
  const cancel = useMutation({ mutationFn: () => api.cancelJob(job.job!.id) })
  return { ...job, start, cancel }
}

export function useModels() {
  return useQuery({ queryKey: ["models"], queryFn: api.models, staleTime: 60_000 })
}
