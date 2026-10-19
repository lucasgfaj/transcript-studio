import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { api, type MeetingInput } from "@/lib/api"

export const keys = {
  meetings: (q?: string) => ["meetings", q ?? ""] as const,
  meeting: (id: string) => ["meeting", id] as const,
  transcript: (id: string) => ["meeting", id, "transcript"] as const,
  minutes: (id: string) => ["meeting", id, "minutes"] as const,
  peaks: (id: string, version: string) => ["meeting", id, "peaks", version] as const,
  health: ["health"] as const,
}

export function useMeetings(q?: string) {
  return useQuery({
    queryKey: keys.meetings(q),
    queryFn: () => api.listMeetings(q),
    placeholderData: (previous) => previous,
    // Keep status badges current while something is being processed on the GPU.
    refetchInterval: (query) => (query.state.data?.some((m) => m.status === "transcribing" || m.status === "generating") ? 3000 : false),
  })
}

export function useMeeting(id: string) {
  return useQuery({ queryKey: keys.meeting(id), queryFn: () => api.getMeeting(id) })
}

export function useTranscript(id: string) {
  return useQuery({ queryKey: keys.transcript(id), queryFn: () => api.transcript(id) })
}

export function useMinutes(id: string) {
  return useQuery({ queryKey: keys.minutes(id), queryFn: () => api.minutes(id) })
}

export function usePeaks(id: string, version: string | null) {
  return useQuery({
    queryKey: keys.peaks(id, version ?? ""),
    queryFn: () => api.peaks(id),
    enabled: version !== null,
    staleTime: Infinity,
  })
}

export function useHealth() {
  return useQuery({
    queryKey: keys.health,
    queryFn: api.health,
    refetchInterval: (query) => (query.state.data?.gpu_job ? 3000 : 30_000),
    retry: false,
  })
}

/** Any change to one meeting refreshes it and the library list. */
function useInvalidateMeeting() {
  const client = useQueryClient()
  return (id: string) => {
    client.invalidateQueries({ queryKey: ["meeting", id] })
    client.invalidateQueries({ queryKey: ["meetings"] })
  }
}

export function useUpdateMeeting(id: string) {
  const invalidate = useInvalidateMeeting()
  return useMutation({
    mutationFn: (input: Partial<MeetingInput>) => api.updateMeeting(id, input),
    onSuccess: () => invalidate(id),
  })
}

export function useDeleteMeeting() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: api.deleteMeeting,
    onSuccess: (_data, id) => {
      client.removeQueries({ queryKey: ["meeting", id] })
      client.invalidateQueries({ queryKey: ["meetings"] })
    },
  })
}

export function useSaveTranscript(id: string) {
  const invalidate = useInvalidateMeeting()
  return useMutation({ mutationFn: (text: string) => api.saveTranscript(id, text), onSuccess: () => invalidate(id) })
}

export function useSaveMinutes(id: string) {
  const invalidate = useInvalidateMeeting()
  return useMutation({ mutationFn: (markdown: string) => api.saveMinutes(id, markdown), onSuccess: () => invalidate(id) })
}

export function useDeleteAudio(id: string) {
  const invalidate = useInvalidateMeeting()
  return useMutation({ mutationFn: () => api.deleteAudio(id), onSuccess: () => invalidate(id) })
}

export { useInvalidateMeeting }
