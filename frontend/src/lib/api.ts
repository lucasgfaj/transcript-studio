// Typed client for the FastAPI backend (the "model" side of the React view).

export type MeetingStatus =
  | "draft"
  | "audio_ready"
  | "transcribing"
  | "transcribed"
  | "generating"
  | "done"
  | "error"

export type MeetingSource = "upload" | "recording" | "live" | "import" | "manual"

export interface Meeting {
  id: string
  title: string
  participants: string[]
  date: string
  language: string
  source: MeetingSource
  status: MeetingStatus
  audio_filename: string | null
  audio_size: number | null
  audio_duration: number | null
  has_audio: boolean
  has_transcript: boolean
  has_minutes: boolean
  transcript_preview: string | null
  created_at: string
  updated_at: string
}

export interface MeetingInput {
  title: string
  participants: string[]
  date: string
  language?: string
}

export interface Segment {
  idx: number
  start: number | null
  end: number | null
  text: string
}

export interface Transcript {
  text: string
  segments: Segment[]
}

export interface MinutesVersion {
  id: number
  model: string | null
  created_at: string
}

export interface MinutesBundle {
  current: (MinutesVersion & { markdown: string }) | null
  history: MinutesVersion[]
}

export interface Health {
  ok: boolean
  ollama: boolean
  ollama_version: string | null
  default_llm: string
  whisper_model: string
  gpu_job: string | null
  queued_jobs: number
}

export type JobStatus = "queued" | "running" | "done" | "error" | "cancelled"
export type TranscriptionMode = "fast" | "detailed"

export interface Job {
  id: string
  meeting_id: string
  kind: "transcribe"
  status: JobStatus
  params: { language?: string | null; mode?: TranscriptionMode }
  progress: number
  message: string | null
  error: string | null
  audio_seconds: number | null
  elapsed_seconds: number | null
  device: string | null
  created_at: string
  started_at: string | null
  finished_at: string | null
}

export interface LiveSegment {
  start: number
  end: number
  text: string
}

export type JobEvent =
  | { type: "snapshot"; job: Job; segments: LiveSegment[] }
  | { type: "status"; status: JobStatus; message: string }
  | { type: "segments"; segments: LiveSegment[]; progress: number }
  | { type: "done" | "error" | "cancelled"; job: Job }

export const isActive = (job: Job | null | undefined) => job?.status === "queued" || job?.status === "running"

export class ApiError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function errorFrom(response: Response): Promise<ApiError> {
  let message = response.statusText
  try {
    const body = await response.json()
    message = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail)
  } catch {
    /* body was not JSON */
  }
  return new ApiError(response.status, message || `Erro ${response.status}`)
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: init?.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json", ...init.headers } : init?.headers,
  })
  if (!response.ok) throw await errorFrom(response)
  return (response.status === 204 ? undefined : await response.json()) as T
}

/** XHR instead of fetch so long uploads can report progress. */
function upload<T>(method: string, path: string, form: FormData, onProgress?: (fraction: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open(method, path)
    xhr.responseType = "json"
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded / event.total)
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.response as T)
      else reject(new ApiError(xhr.status, xhr.response?.detail ?? `Erro ${xhr.status}`))
    }
    xhr.onerror = () => reject(new ApiError(0, "Falha de rede ao enviar o arquivo."))
    xhr.send(form)
  })
}

export const api = {
  health: () => request<Health>("/api/health"),

  listMeetings: (q?: string) =>
    request<Meeting[]>(`/api/meetings${q ? `?q=${encodeURIComponent(q)}` : ""}`),
  getMeeting: (id: string) => request<Meeting>(`/api/meetings/${id}`),
  createMeeting: (input: MeetingInput) =>
    request<Meeting>("/api/meetings", { method: "POST", body: JSON.stringify(input) }),
  updateMeeting: (id: string, input: Partial<MeetingInput>) =>
    request<Meeting>(`/api/meetings/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
  deleteMeeting: (id: string) => request<void>(`/api/meetings/${id}`, { method: "DELETE" }),

  createFromAudio: (
    file: File,
    fields: { title: string; participants: string[]; date: string; source: MeetingSource },
    onProgress?: (fraction: number) => void,
  ) => {
    const form = new FormData()
    form.append("file", file)
    form.append("title", fields.title)
    form.append("participants", fields.participants.join(","))
    form.append("date", fields.date)
    form.append("source", fields.source)
    return upload<Meeting>("POST", "/api/meetings/from-audio", form, onProgress)
  },
  replaceAudio: (id: string, file: File, onProgress?: (fraction: number) => void) => {
    const form = new FormData()
    form.append("file", file)
    return upload<Meeting>("PUT", `/api/meetings/${id}/audio`, form, onProgress)
  },
  deleteAudio: (id: string) => request<Meeting>(`/api/meetings/${id}/audio`, { method: "DELETE" }),
  audioUrl: (id: string, version: string) => `/api/meetings/${id}/audio?v=${encodeURIComponent(version)}`,
  peaks: (id: string) => request<number[]>(`/api/meetings/${id}/audio/peaks`),

  transcript: (id: string) => request<Transcript>(`/api/meetings/${id}/transcript`),
  saveTranscript: (id: string, text: string) =>
    request<Transcript>(`/api/meetings/${id}/transcript`, { method: "PUT", body: JSON.stringify({ text }) }),

  transcribe: (id: string, options: { mode: TranscriptionMode; language: string | null }) =>
    request<Job>(`/api/meetings/${id}/transcribe`, { method: "POST", body: JSON.stringify(options) }),
  latestJob: (id: string) => request<Job | null>(`/api/meetings/${id}/job`),
  cancelJob: (jobId: string) => request<Job>(`/api/jobs/${jobId}/cancel`, { method: "POST" }),
  jobEventsUrl: (jobId: string) => `/api/jobs/${jobId}/events`,

  minutes: (id: string) => request<MinutesBundle>(`/api/meetings/${id}/minutes`),
  saveMinutes: (id: string, markdown: string) =>
    request<MinutesBundle>(`/api/meetings/${id}/minutes`, { method: "PUT", body: JSON.stringify({ markdown }) }),
}
