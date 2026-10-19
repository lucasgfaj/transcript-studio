import { useCallback, useEffect, useRef, useState, type RefObject } from "react"

export interface LiveSegment {
  start: number
  end: number
  text: string
}

export type LiveState = "idle" | "connecting" | "recording" | "paused" | "saving" | "saved" | "error"

type ServerMessage =
  | { type: "ready"; meeting_id: string; gpu_busy: boolean }
  | { type: "segment"; start: number; end: number; text: string }
  | { type: "silence"; silent: boolean }
  | { type: "saved"; meeting_id: string; segments: number }
  | { type: "discarded" }

function socketUrl(): string {
  return `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/live`
}

/**
 * Sends the open microphone (see useMicrophone) to /api/live and collects the live transcript.
 * The server records the audio as it arrives, so a dropped connection keeps what was said.
 */
export function useLiveRecorder(sink: RefObject<((pcm: ArrayBuffer) => void) | null>) {
  const [state, setState] = useState<LiveState>("idle")
  const [segments, setSegments] = useState<LiveSegment[]>([])
  const [elapsed, setElapsed] = useState(0)
  const [sentSeconds, setSentSeconds] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [gpuBusy, setGpuBusy] = useState(false)
  const [serverSilent, setServerSilent] = useState(false)
  const [meetingId, setMeetingId] = useState<string | null>(null)
  const [result, setResult] = useState<"saved" | "discarded" | null>(null)
  const socket = useRef<WebSocket | null>(null)
  const timer = useRef(0)
  const stateRef = useRef<LiveState>("idle")
  stateRef.current = state

  const detach = useCallback(() => {
    sink.current = null
    window.clearInterval(timer.current)
  }, [sink])

  useEffect(() => () => {
    detach()
    socket.current?.close()
  }, [detach])

  const start = useCallback(async (meta: { title: string; participants: string[]; language: string }) => {
    setError(null)
    setSegments([])
    setResult(null)
    setElapsed(0)
    setSentSeconds(0)
    setServerSilent(false)
    setState("connecting")
    const ws = new WebSocket(socketUrl())
    ws.binaryType = "arraybuffer"
    socket.current = ws
    try {
      await new Promise<void>((resolve, reject) => {
        ws.onopen = () => resolve()
        ws.onerror = () => reject(new Error("Não consegui conectar ao servidor (o backend está rodando?)."))
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setState("error")
      return
    }
    ws.send(JSON.stringify({ type: "start", ...meta }))
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data as string) as ServerMessage
      if (message.type === "ready") {
        setMeetingId(message.meeting_id)
        setGpuBusy(message.gpu_busy)
        sink.current = (pcm) => {
          if (stateRef.current !== "recording" || ws.readyState !== WebSocket.OPEN) return
          ws.send(pcm)
          setSentSeconds((value) => value + pcm.byteLength / 2 / 16000)
        }
        timer.current = window.setInterval(() => {
          if (stateRef.current === "recording") setElapsed((value) => value + 1)
        }, 1000)
        setState("recording")
      } else if (message.type === "segment") {
        setSegments((previous) => [...previous, message])
      } else if (message.type === "silence") {
        setServerSilent(message.silent)
      } else {
        setResult(message.type)
        setState("saved")
        ws.close()
      }
    }
    ws.onclose = () => {
      detach()
      if (stateRef.current === "recording" || stateRef.current === "paused" || stateRef.current === "connecting") {
        setError("A conexão com o servidor caiu. O que já foi gravado está salvo.")
        setState("error")
      }
    }
  }, [detach, sink])

  const togglePause = useCallback(() => {
    setState((current) => (current === "recording" ? "paused" : "recording"))
  }, [])

  const stop = useCallback(() => {
    detach()
    setState("saving")
    socket.current?.send(JSON.stringify({ type: "stop" }))
  }, [detach])

  return { state, segments, elapsed, sentSeconds, serverSilent, error, gpuBusy, meetingId, result, start, togglePause, stop }
}
