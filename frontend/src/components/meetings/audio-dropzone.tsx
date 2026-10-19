import { useRef, useState } from "react"
import { FileAudio, UploadCloud } from "lucide-react"

import { formatBytes } from "@/lib/format"
import { cn } from "@/lib/utils"

const ACCEPT = ".wav,.mp3,.m4a,.ogg,.oga,.opus,.webm,.flac,.aac,.mp4,.mkv,audio/*"

export function AudioDropzone({ file, onFile, disabled }: { file: File | null; onFile: (file: File) => void; disabled?: boolean }) {
  const input = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => input.current?.click()}
      onDragOver={(event) => {
        event.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault()
        setDragging(false)
        const dropped = event.dataTransfer.files[0]
        if (dropped) onFile(dropped)
      }}
      className={cn(
        "group flex w-full flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors",
        dragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-muted/40",
        disabled && "pointer-events-none opacity-60",
      )}
    >
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        hidden
        onChange={(event) => {
          const chosen = event.target.files?.[0]
          if (chosen) onFile(chosen)
          event.target.value = ""
        }}
      />
      {file ? (
        <>
          <span className="grid size-12 place-items-center rounded-full bg-primary/10 text-primary">
            <FileAudio className="size-6" />
          </span>
          <div>
            <div className="font-medium break-all">{file.name}</div>
            <div className="text-sm text-muted-foreground">{formatBytes(file.size)} · clique para trocar</div>
          </div>
        </>
      ) : (
        <>
          <span className="grid size-12 place-items-center rounded-full bg-muted text-muted-foreground transition-colors group-hover:text-primary">
            <UploadCloud className="size-6" />
          </span>
          <div>
            <div className="font-medium">Arraste o áudio aqui ou clique para escolher</div>
            <div className="text-sm text-muted-foreground">WAV, MP3, M4A, OGG, WEBM, FLAC… (vídeo MP4 também)</div>
          </div>
        </>
      )}
    </button>
  )
}
