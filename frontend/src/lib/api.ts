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

export type JobKind = "transcribe" | "minutes"
export type JobStatus = "queued" | "running" | "done" | "error" | "cancelled"
export type TranscriptionMode = "fast" | "detailed"

export interface Job {
  id: string
  meeting_id: string
  kind: JobKind
  status: JobStatus
  params: { language?: string | null; mode?: TranscriptionMode; model?: string }
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

export interface ActiveJob extends Job {
  meeting_title: string
}

export interface LiveSegment {
  start: number
  end: number
  text: string
}

export type JobEvent =
  | { type: "snapshot"; job: Job; segments: LiveSegment[]; text: string }
  | { type: "status"; status: JobStatus; message: string; progress?: number }
  | { type: "segments"; segments: LiveSegment[]; progress: number }
  | { type: "token"; text: string }
  | { type: "done" | "error" | "cancelled"; job: Job }

const NEWLINE = String.fromCharCode(10)

export const isActive = (job: Job | null | undefined) => job?.status === "queued" || job?.status === "running"

export interface LlmModel {
  name: string
  size: number | null
  parameter_size: string | null
  quantization: string | null
  family: string | null
  loaded: boolean
  vram: number | null
  fits_gpu: boolean | null
}

export interface CatalogModel {
  name: string
  description: string
  approx_gb: number
  installed: boolean
}

export interface WhisperModel {
  name: string
  description: string
  downloaded: boolean
  active: boolean
}

export interface ModelsInfo {
  default: string
  available: boolean
  gpu_memory_gb: number
  models: LlmModel[]
  catalog: CatalogModel[]
  whisper: WhisperModel[]
}

export interface Preferences {
  default_llm: string
  whisper_model: string
  context_max_chars: number
}

export interface PullEvent {
  status?: string
  completed?: number | null
  total?: number | null
  percent?: number | null
  error?: string
}

export interface ContextFile {
  path: string
  chars: number
  included: boolean
  reason: string | null
}

export interface ContextOverview {
  max_chars: number
  used_chars: number
  files: ContextFile[]
}

export interface ChatMessage {
  id: number
  role: "user" | "assistant"
  content: string
  model: string | null
  interrupted: boolean
  created_at: string
}

export type ChatEvent =
  | { type: "status"; message: string }
  | { type: "token"; text: string }
  | { type: "done"; message: ChatMessage }
  | { type: "error"; message: string }

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
  latestJob: (id: string, kind: JobKind) => request<Job | null>(`/api/meetings/${id}/job?kind=${kind}`),
  generateMinutes: (id: string, model: string | null) =>
    request<Job>(`/api/meetings/${id}/minutes/generate`, { method: "POST", body: JSON.stringify({ model }) }),
  minutesVersion: (id: string, versionId: number) =>
    request<MinutesVersion & { markdown: string }>(`/api/meetings/${id}/minutes/${versionId}`),
  exportUrl: (id: string, format: "md" | "docx" | "txt" | "srt") => `/api/meetings/${id}/export?format=${format}`,
  models: () => request<ModelsInfo>("/api/models"),
  deleteModel: (name: string) => request<void>(`/api/models/${encodeURIComponent(name)}`, { method: "DELETE" }),
  /** Streams NDJSON progress from the server while Ollama downloads the model. */
  pullModel: async (name: string, onEvent: (event: PullEvent) => void, signal?: AbortSignal) => {
    const response = await fetch("/api/models/pull", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
      signal,
    })
    if (!response.ok || !response.body) throw await errorFrom(response)
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
    let buffer = ""
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += value
      const lines = buffer.split("\n")
      buffer = lines.pop() ?? ""
      for (const line of lines) if (line.trim()) onEvent(JSON.parse(line) as PullEvent)
    }
  },
  preferences: () => request<Preferences>("/api/preferences"),
  updatePreferences: (changes: Partial<Preferences>) =>
    request<Preferences>("/api/preferences", { method: "PUT", body: JSON.stringify(changes) }),

  chatHistory: (id: string) => request<ChatMessage[]>(`/api/meetings/${id}/chat`),
  clearChat: (id: string) => request<void>(`/api/meetings/${id}/chat`, { method: "DELETE" }),
  /** Streams the answer (NDJSON). Aborting the signal stops the model on the server too. */
  askChat: async (id: string, content: string, onEvent: (event: ChatEvent) => void, signal?: AbortSignal) => {
    const response = await fetch(`/api/meetings/${id}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
      signal,
    })
    if (!response.ok || !response.body) throw await errorFrom(response)
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
    let buffer = ""
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += value
      const lines = buffer.split(NEWLINE)
      buffer = lines.pop() ?? ""
      for (const line of lines) if (line.trim()) onEvent(JSON.parse(line) as ChatEvent)
    }
  },
  context: () => request<ContextOverview>("/api/context"),
  contextFile: (path: string) => request<{ path: string; content: string }>(`/api/context/file?path=${encodeURIComponent(path)}`),
  saveContextFile: (path: string, content: string) =>
    request<{ path: string; content: string }>(`/api/context/file?path=${encodeURIComponent(path)}`, {
      method: "PUT",
      body: JSON.stringify({ content }),
    }),
  deleteContextFile: (path: string) =>
    request<void>(`/api/context/file?path=${encodeURIComponent(path)}`, { method: "DELETE" }),
  activeJobs: () => request<ActiveJob[]>("/api/jobs"),
  /** A finished job, or null if it was deleted with its meeting. */
  getJobSafe: (jobId: string) => request<Job>(`/api/jobs/${jobId}`).catch(() => null),
  cancelJob: (jobId: string) => request<Job>(`/api/jobs/${jobId}/cancel`, { method: "POST" }),
  jobEventsUrl: (jobId: string) => `/api/jobs/${jobId}/events`,

  minutes: (id: string) => request<MinutesBundle>(`/api/meetings/${id}/minutes`),
  saveMinutes: (id: string, markdown: string) =>
    request<MinutesBundle>(`/api/meetings/${id}/minutes`, { method: "PUT", body: JSON.stringify({ markdown }) }),
}
