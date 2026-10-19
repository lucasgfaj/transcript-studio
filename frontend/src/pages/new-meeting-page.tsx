import { useState } from "react"
import { useNavigate } from "react-router"
import { useQueryClient } from "@tanstack/react-query"
import { ArrowRight, FileText, Loader2, Mic, Upload } from "lucide-react"
import { toast } from "sonner"

import { useDocumentTitle } from "@/hooks/use-document-title"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { AudioDropzone } from "@/components/meetings/audio-dropzone"
import { Recorder } from "@/components/meetings/recorder"
import { api, type MeetingSource } from "@/lib/api"
import { splitNames, todayIso } from "@/lib/format"

export function NewMeetingPage() {
  useDocumentTitle("Nova reunião")
  const navigate = useNavigate()
  const client = useQueryClient()
  const [title, setTitle] = useState("")
  const [participants, setParticipants] = useState("")
  const [date, setDate] = useState(todayIso())
  const [mode, setMode] = useState<"upload" | "record">("upload")
  const [uploaded, setUploaded] = useState<File | null>(null)
  const [recorded, setRecorded] = useState<File | null>(null)
  const [progress, setProgress] = useState<number | null>(null)

  const file = mode === "upload" ? uploaded : recorded
  const busy = progress !== null

  const finish = (id: string) => {
    client.invalidateQueries({ queryKey: ["meetings"] })
    navigate(`/reunioes/${id}`)
  }

  const save = async () => {
    if (!file) return
    setProgress(0)
    try {
      const source: MeetingSource = mode === "upload" ? "upload" : "recording"
      const meeting = await api.createFromAudio(file, { title: title.trim(), participants: splitNames(participants), date, source }, setProgress)
      toast.success("Reunião criada", { description: "O áudio está salvo. A transcrição automática chega na próxima fase." })
      finish(meeting.id)
    } catch (error) {
      toast.error("Não consegui salvar", { description: error instanceof Error ? error.message : String(error) })
      setProgress(null)
    }
  }

  const createTextOnly = async () => {
    try {
      const meeting = await api.createMeeting({ title: title.trim() || "Reunião sem áudio", participants: splitNames(participants), date })
      finish(meeting.id)
    } catch (error) {
      toast.error("Não consegui criar", { description: error instanceof Error ? error.message : String(error) })
    }
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight sm:text-3xl">Nova reunião</h1>
        <p className="text-sm text-muted-foreground">Envie um arquivo de áudio ou grave agora pelo microfone.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Dados da reunião</CardTitle>
          <CardDescription>Se ficar sem título, uso o nome do arquivo.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-[1fr_180px]">
          <div className="grid gap-2 sm:col-span-2">
            <Label htmlFor="title">Título</Label>
            <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex.: Comitê de obras — outubro" disabled={busy} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="participants">Participantes</Label>
            <Input id="participants" value={participants} onChange={(e) => setParticipants(e.target.value)} placeholder="Ana, Bruno, Carla" disabled={busy} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="date">Data</Label>
            <Input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} disabled={busy} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Tabs value={mode} onValueChange={(value) => setMode(value as "upload" | "record")}>
            <TabsList className="mb-4 w-full sm:w-fit">
              <TabsTrigger value="upload" disabled={busy}>
                <Upload /> Enviar arquivo
              </TabsTrigger>
              <TabsTrigger value="record" disabled={busy}>
                <Mic /> Gravar agora
              </TabsTrigger>
            </TabsList>
            <TabsContent value="upload">
              <AudioDropzone file={uploaded} onFile={setUploaded} disabled={busy} />
            </TabsContent>
            <TabsContent value="record" forceMount className="data-[state=inactive]:hidden">
              <Recorder onRecorded={setRecorded} disabled={busy} />
            </TabsContent>
          </Tabs>

          {busy && (
            <div className="mt-5 grid gap-2">
              <div className="flex justify-between text-sm">
                <span>{progress < 1 ? "Enviando…" : "Processando o áudio…"}</span>
                <span className="tabular-nums text-muted-foreground">{Math.round(progress * 100)}%</span>
              </div>
              <Progress value={progress * 100} />
            </div>
          )}

          <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
            <Button variant="ghost" onClick={createTextOnly} disabled={busy}>
              <FileText /> Criar só com texto
            </Button>
            <Button size="lg" onClick={save} disabled={!file || busy}>
              {busy ? <Loader2 className="animate-spin" /> : <ArrowRight />}
              Salvar reunião
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
