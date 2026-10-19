import { useRef, useState } from "react"
import { Link, useNavigate, useParams } from "react-router"
import {
  ArrowLeft, CalendarDays, Captions, Clock, Download, FileAudio, FileText, FileType, Loader2, MessagesSquare, MoreHorizontal, NotebookPen,
  Pencil, Trash2, Upload, Users,
} from "lucide-react"
import { toast } from "sonner"

import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { AudioDropzone } from "@/components/meetings/audio-dropzone"
import { AudioPlayer, type AudioPlayerHandle } from "@/components/meetings/audio-player"
import { ChatPanel } from "@/components/meetings/chat-panel"
import { MeetingDetailsDialog } from "@/components/meetings/meeting-details-dialog"
import { MinutesPanel } from "@/components/meetings/minutes-panel"
import { StatusBadge } from "@/components/meetings/status-badge"
import { TranscribeBar } from "@/components/meetings/transcribe-bar"
import { TranscriptPanel } from "@/components/meetings/transcript-panel"
import { useTranscription } from "@/hooks/use-transcription"
import { useDeleteAudio, useDeleteMeeting, useInvalidateMeeting, useMeeting, usePeaks, useTranscript } from "@/hooks/use-meetings"
import { api, type Meeting } from "@/lib/api"
import { formatBytes, formatDate, formatDuration } from "@/lib/format"

function AudioCard({ meeting, playerRef, onTime }: {
  meeting: Meeting
  playerRef: React.RefObject<AudioPlayerHandle | null>
  onTime: (seconds: number) => void
}) {
  const version = meeting.has_audio ? `${meeting.audio_size}-${meeting.updated_at}` : null
  const { data: peaks } = usePeaks(meeting.id, version)
  const invalidate = useInvalidateMeeting()
  const [progress, setProgress] = useState<number | null>(null)

  const upload = async (file: File) => {
    setProgress(0)
    try {
      await api.replaceAudio(meeting.id, file, setProgress)
      invalidate(meeting.id)
      toast.success("Áudio salvo")
    } catch (error) {
      toast.error("Não consegui salvar o áudio", { description: error instanceof Error ? error.message : String(error) })
    } finally {
      setProgress(null)
    }
  }

  if (!meeting.has_audio || !version) {
    return (
      <Card>
        <CardContent className="grid gap-3">
          <AudioDropzone file={null} onFile={upload} disabled={progress !== null} />
          {progress !== null && <Progress value={progress * 100} />}
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardContent>
        <AudioPlayer ref={playerRef} src={api.audioUrl(meeting.id, version)} peaks={peaks} duration={meeting.audio_duration ?? 0} onTime={onTime} />
      </CardContent>
    </Card>
  )
}

export function MeetingPage() {
  const { id = "" } = useParams()
  const navigate = useNavigate()
  const { data: meeting, isLoading, isError } = useMeeting(id)
  const deleteMeeting = useDeleteMeeting()
  const deleteAudio = useDeleteAudio(id)
  const invalidate = useInvalidateMeeting()
  const playerRef = useRef<AudioPlayerHandle>(null)
  const replaceInput = useRef<HTMLInputElement>(null)
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [replacing, setReplacing] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [tab, setTab] = useState<string | null>(null)
  const transcription = useTranscription(id)
  const timed = (useTranscript(id).data?.segments.length ?? 0) > 0

  if (isLoading) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-80 w-full" />
      </div>
    )
  }
  if (isError || !meeting) {
    return (
      <div className="flex flex-col items-center gap-3 py-20 text-center">
        <div className="font-medium">Reunião não encontrada</div>
        <Button asChild variant="outline">
          <Link to="/">Voltar para a biblioteca</Link>
        </Button>
      </div>
    )
  }

  const replaceAudio = async (file: File) => {
    setReplacing(true)
    try {
      await api.replaceAudio(meeting.id, file)
      invalidate(meeting.id)
      toast.success("Áudio substituído")
    } catch (error) {
      toast.error("Não consegui substituir", { description: error instanceof Error ? error.message : String(error) })
    } finally {
      setReplacing(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Link to="/" className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Reuniões
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="mb-2">
            <StatusBadge status={meeting.status} />
          </div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight break-words sm:text-3xl">{meeting.title}</h1>
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <CalendarDays className="size-4" /> {formatDate(meeting.date)}
            </span>
            {meeting.has_audio && (
              <span className="inline-flex items-center gap-1.5">
                <Clock className="size-4" /> {formatDuration(meeting.audio_duration)}
              </span>
            )}
            {meeting.has_audio && (
              <span className="inline-flex items-center gap-1.5">
                <FileAudio className="size-4" /> {formatBytes(meeting.audio_size)}
              </span>
            )}
            <span className="inline-flex items-center gap-1.5">
              <Users className="size-4" /> {meeting.participants.length ? meeting.participants.join(", ") : "Participantes não informados"}
            </span>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setEditing(true)}>
            <Pencil /> Editar
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">
                <Download /> Exportar
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild disabled={!meeting.has_minutes}>
                <a href={api.exportUrl(meeting.id, "docx")} download>
                  <FileType /> Ata (.docx)
                </a>
              </DropdownMenuItem>
              <DropdownMenuItem asChild disabled={!meeting.has_minutes}>
                <a href={api.exportUrl(meeting.id, "md")} download>
                  <NotebookPen /> Ata (.md)
                </a>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild disabled={!meeting.has_transcript}>
                <a href={api.exportUrl(meeting.id, "txt")} download>
                  <FileText /> Transcrição (.txt)
                </a>
              </DropdownMenuItem>
              <DropdownMenuItem asChild disabled={!timed}>
                <a href={api.exportUrl(meeting.id, "srt")} download title={timed ? undefined : "Transcreva com o Whisper para ter marcações de tempo"}>
                  <Captions /> Legendas (.srt)
                </a>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" aria-label="Mais ações">
                {replacing ? <Loader2 className="animate-spin" /> : <MoreHorizontal />}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => replaceInput.current?.click()}>
                <Upload /> {meeting.has_audio ? "Substituir áudio" : "Enviar áudio"}
              </DropdownMenuItem>
              {meeting.has_audio && (
                <DropdownMenuItem
                  onSelect={() => deleteAudio.mutate(undefined, { onSuccess: () => toast.success("Áudio removido") })}
                >
                  <FileAudio /> Remover áudio
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => setConfirmDelete(true)}>
                <Trash2 /> Excluir reunião
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <input
            ref={replaceInput}
            type="file"
            accept="audio/*,.wav,.mp3,.m4a,.ogg,.webm,.flac,.mp4"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void replaceAudio(file)
              event.target.value = ""
            }}
          />
        </div>
      </div>

      <AudioCard meeting={meeting} playerRef={playerRef} onTime={setCurrentTime} />

      {meeting.has_audio && <TranscribeBar transcription={transcription} hasTranscript={meeting.has_transcript} busy={meeting.status === "generating"} />}

      <Tabs
        value={transcription.active ? "transcript" : tab ?? (meeting.has_minutes || meeting.status === "generating" ? "minutes" : "transcript")}
        onValueChange={setTab}
      >
        <TabsList variant="line" className="w-full justify-start border-b pb-0">
          <TabsTrigger value="transcript">
            <FileText /> Transcrição
          </TabsTrigger>
          <TabsTrigger value="minutes">
            <NotebookPen /> Ata
          </TabsTrigger>
          <TabsTrigger value="chat">
            <MessagesSquare /> Chat
          </TabsTrigger>
        </TabsList>
        <TabsContent value="transcript" className="pt-4">
          <TranscriptPanel
            meetingId={meeting.id}
            onSeek={(seconds) => playerRef.current?.seek(seconds)}
            currentTime={currentTime}
            liveSegments={transcription.liveSegments}
          />
        </TabsContent>
        <TabsContent value="minutes" className="pt-4">
          <MinutesPanel meetingId={meeting.id} title={meeting.title} hasTranscript={meeting.has_transcript} />
        </TabsContent>
        <TabsContent value="chat" className="pt-4">
          <ChatPanel />
        </TabsContent>
      </Tabs>

      {editing && <MeetingDetailsDialog meeting={meeting} open={editing} onOpenChange={setEditing} />}

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir “{meeting.title}”?</AlertDialogTitle>
            <AlertDialogDescription>
              O áudio, a transcrição e todas as versões da ata desta reunião serão apagados do Transcript Studio. Os arquivos
              originais importados do transcript-mk não são afetados.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() =>
                deleteMeeting.mutate(meeting.id, {
                  onSuccess: () => {
                    toast.success("Reunião excluída")
                    navigate("/")
                  },
                })
              }
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
