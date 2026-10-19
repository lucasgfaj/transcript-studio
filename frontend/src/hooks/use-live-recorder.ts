import { useCallback, useEffect, useRef, useState } from "react"

export interface LiveSegment {
  start: number
  end: number
  text: string
}

export type LiveState = "idle" | "connecting" | "recording" | "paused" | "saving" | "saved" | "error"

type ServerMessage =
  | { type: "ready"; meeting_id: string; gpu_busy: boolean }
  | { type: "segment"; start: number; end: number; text: string }
  | { type: "saved"; meeting_id: string; segments: number }
  | { type: "discarded" }

// Runs on the audio thread: downmix, resample to 16 kHz and send ~250 ms of PCM16 at a time.
const WORKLET = `
class Pcm16Writer extends AudioWorkletProcessor {
  constructor() {
    super()
    this.ratio = sampleRate / 16000
    this.position = 0
    this.out = new Int16Array(4000)
    this.filled = 0
    this.peak = 0
    this.paused = false
    this.port.onmessage = (e) => { this.paused = e.data === "pause" }
  }
  process(inputs) {
    const channels = inputs[0]
    if (!channels || !channels.length || this.paused) return true
    const input = channels[0]
    for (; this.position < input.length; this.position += this.ratio) {
      const i = Math.floor(this.position)
      const frac = this.position - i
      const next = i + 1 < input.length ? input[i + 1] : input[i]
      const value = Math.max(-1, Math.min(1, input[i] + (next - input[i]) * frac))
      this.peak = Math.max(this.peak, Math.abs(value))
      this.out[this.filled++] = value < 0 ? value * 32768 : value * 32767
      if (this.filled === this.out.length) {
        this.port.postMessage({ pcm: this.out.buffer, peak: this.peak }, [this.out.buffer])
        this.out = new Int16Array(4000)
        this.filled = 0
        this.peak = 0
      }
    }
    this.position -= input.length
    return true
  }
}
registerProcessor("pcm16-writer", Pcm16Writer)
`

function socketUrl(): string {
  return `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/live`
}

/** Microphone → WebSocket → live transcript segments. Audio is also saved on the server as it arrives. */
export function useLiveRecorder() {
  const [state, setState] = useState<LiveState>("idle")
  const [segments, setSegments] = useState<LiveSegment[]>([])
  const [level, setLevel] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [gpuBusy, setGpuBusy] = useState(false)
  const [meetingId, setMeetingId] = useState<string | null>(null)
  const [result, setResult] = useState<"saved" | "discarded" | null>(null)

  const socket = useRef<WebSocket | null>(null)
  const context = useRef<AudioContext | null>(null)
  const node = useRef<AudioWorkletNode | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const timer = useRef(0)
  const stateRef = useRef<LiveState>("idle")
  stateRef.current = state

  const releaseAudio = useCallback(() => {
    window.clearInterval(timer.current)
    node.current?.disconnect()
    stream.current?.getTracks().forEach((track) => track.stop())
    void context.current?.close()
    node.current = null
    stream.current = null
    context.current = null
    setLevel(0)
  }, [])

  useEffect(() => () => {
    releaseAudio()
    socket.current?.close()
  }, [releaseAudio])

  const start = useCallback(async (meta: { title: string; participants: string[]; language: string }) => {
    setError(null)
    setSegments([])
    setResult(null)
    setElapsed(0)
    setState("connecting")
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
      stream.current = media
      const audioContext = new AudioContext()
      context.current = audioContext
      const moduleUrl = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }))
      await audioContext.audioWorklet.addModule(moduleUrl)
      URL.revokeObjectURL(moduleUrl)

      const ws = new WebSocket(socketUrl())
      ws.binaryType = "arraybuffer"
      socket.current = ws
      await new Promise<void>((resolve, reject) => {
        ws.onopen = () => resolve()
        ws.onerror = () => reject(new Error("Não consegui conectar ao servidor."))
      })
      ws.send(JSON.stringify({ type: "start", ...meta }))

      ws.onmessage = (event) => {
        const message = JSON.parse(event.data as string) as ServerMessage
        if (message.type === "ready") {
          setMeetingId(message.meeting_id)
          setGpuBusy(message.gpu_busy)
          const worklet = new AudioWorkletNode(audioContext, "pcm16-writer")
          worklet.port.onmessage = (e: MessageEvent<{ pcm: ArrayBuffer; peak: number }>) => {
            if (ws.readyState === WebSocket.OPEN) ws.send(e.data.pcm)
            setLevel(e.data.peak)
          }
          audioContext.createMediaStreamSource(media).connect(worklet)
          node.current = worklet
          timer.current = window.setInterval(() => {
            if (stateRef.current === "recording") setElapsed((value) => value + 1)
          }, 1000)
          setState("recording")
        } else if (message.type === "segment") {
          setSegments((previous) => [...previous, message])
        } else if (message.type === "saved" || message.type === "discarded") {
          setResult(message.type)
          setState("saved")
          ws.close()
        }
      }
      ws.onclose = () => {
        releaseAudio()
        if (stateRef.current === "recording" || stateRef.current === "paused") {
          setError("A conexão caiu. O que já foi gravado foi salvo.")
          setState("error")
        }
      }
    } catch (err) {
      releaseAudio()
      socket.current?.close()
      setError(err instanceof Error && err.name === "NotAllowedError"
        ? "Permissão do microfone negada. Libere o acesso no navegador."
        : err instanceof Error ? err.message : "Não consegui iniciar a gravação.")
      setState("error")
    }
  }, [releaseAudio])

  const togglePause = useCallback(() => {
    const paused = stateRef.current === "recording"
    node.current?.port.postMessage(paused ? "pause" : "resume")
    setState(paused ? "paused" : "recording")
  }, [])

  const stop = useCallback(() => {
    releaseAudio()
    setState("saving")
    socket.current?.send(JSON.stringify({ type: "stop" }))
  }, [releaseAudio])

  return { state, segments, level, elapsed, error, gpuBusy, meetingId, result, start, togglePause, stop }
}
