import { useCallback, useEffect, useRef, useState } from "react"

export type MicStatus = "idle" | "requesting" | "ready" | "denied" | "error"

export interface MicDevice {
  id: string
  label: string
}

export interface ScanResult extends MicDevice {
  level: number // 0..1 loudest moment while testing; -1 when the device could not be opened
}

const STORAGE_KEY = "live-microphone"

// Audio thread: downmix, resample to 16 kHz, post PCM16 every 250 ms and the loudness every ~50 ms.
const WORKLET = `
class Pcm16Writer extends AudioWorkletProcessor {
  constructor() {
    super()
    this.ratio = sampleRate / 16000
    this.position = 0
    this.out = new Int16Array(4000)
    this.filled = 0
    this.sum = 0
    this.count = 0
    this.levelEvery = Math.round(sampleRate * 0.05)
  }
  process(inputs) {
    const channels = inputs[0]
    if (!channels || !channels.length) return true
    const input = channels[0]
    for (let i = 0; i < input.length; i++) {
      this.sum += input[i] * input[i]
      if (++this.count >= this.levelEvery) {
        this.port.postMessage({ rms: Math.sqrt(this.sum / this.count) })
        this.sum = 0
        this.count = 0
      }
    }
    for (; this.position < input.length; this.position += this.ratio) {
      const i = Math.floor(this.position)
      const frac = this.position - i
      const next = i + 1 < input.length ? input[i + 1] : input[i]
      const value = Math.max(-1, Math.min(1, input[i] + (next - input[i]) * frac))
      this.out[this.filled++] = value < 0 ? value * 32768 : value * 32767
      if (this.filled === this.out.length) {
        this.port.postMessage({ pcm: this.out.buffer }, [this.out.buffer])
        this.out = new Int16Array(4000)
        this.filled = 0
      }
    }
    this.position -= input.length
    return true
  }
}
registerProcessor("pcm16-writer", Pcm16Writer)
`

/** Loudness in 0..1 on a decibel scale (-60 dB → 0, -10 dB → 1), so normal speech fills the meter. */
function toLevel(rms: number): number {
  const db = 20 * Math.log10(Math.max(rms, 1e-6))
  return Math.min(1, Math.max(0, (db + 60) / 50))
}

function readSaved(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? ""
  } catch {
    return ""
  }
}

/**
 * Opens the chosen microphone as soon as the page loads, so the meter shows the voice before
 * recording starts. `onPcm` receives 16 kHz PCM16 blocks for whoever is recording.
 */
export function useMicrophone() {
  const [status, setStatus] = useState<MicStatus>("idle")
  const [devices, setDevices] = useState<MicDevice[]>([])
  const [deviceId, setDeviceId] = useState<string>(readSaved)
  const [level, setLevel] = useState(0)
  const [suspended, setSuspended] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [db, setDb] = useState(-100)
  const [trackLabel, setTrackLabel] = useState<string | null>(null)
  const [trackMuted, setTrackMuted] = useState(false)
  const [scanning, setScanning] = useState<{ index: number; total: number; label: string } | null>(null)
  const [scanResults, setScanResults] = useState<ScanResult[] | null>(null)
  const onPcm = useRef<((pcm: ArrayBuffer) => void) | null>(null)
  const parts = useRef<{ stream: MediaStream; context: AudioContext; node: AudioWorkletNode } | null>(null)
  const generations = useRef(0)

  const close = useCallback(() => {
    const current = parts.current
    parts.current = null
    if (!current) return
    current.node.port.onmessage = null
    current.node.disconnect()
    current.stream.getTracks().forEach((track) => track.stop())
    void current.context.close()
    setLevel(0)
  }, [])

  const refreshDevices = useCallback(async () => {
    const all = await navigator.mediaDevices.enumerateDevices()
    const inputs = all.filter((d) => d.kind === "audioinput" && d.deviceId)
    setDevices(inputs.map((d, i) => ({ id: d.deviceId, label: d.label || `Microfone ${i + 1}` })))
  }, [])

  const open = useCallback(async (id: string) => {
    close()
    // Only the latest open() may keep its microphone: an older one still awaiting the permission
    // prompt would otherwise leave a second worklet running and every block would be sent twice.
    const generation = ++generations.current
    const stale = () => generation !== generations.current
    setStatus("requesting")
    setError(null)
    let stream: MediaStream | null = null
    let context: AudioContext | null = null
    const discard = () => {
      stream?.getTracks().forEach((track) => track.stop())
      void context?.close()
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: id && id !== "default" ? { exact: id } : undefined,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })
      if (stale()) return discard()
      context = new AudioContext()
      const audio = context
      const url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }))
      await audio.audioWorklet.addModule(url)
      URL.revokeObjectURL(url)
      if (stale()) return discard()
      const node = new AudioWorkletNode(audio, "pcm16-writer")
      node.port.onmessage = (event: MessageEvent<{ rms?: number; pcm?: ArrayBuffer }>) => {
        if (event.data.rms !== undefined) {
          setLevel(toLevel(event.data.rms))
          setDb(Math.round(20 * Math.log10(Math.max(event.data.rms, 1e-6))))
        }
        if (event.data.pcm) onPcm.current?.(event.data.pcm)
      }
      audio.createMediaStreamSource(stream).connect(node)
      // The node must reach the destination or some browsers never run it; it outputs silence.
      node.connect(audio.destination)
      // Created after the permission prompt, the context can start "suspended" and process nothing.
      if (audio.state !== "running") await audio.resume().catch(() => undefined)
      if (stale()) {
        node.disconnect()
        return discard()
      }
      setSuspended(audio.state !== "running")
      audio.onstatechange = () => setSuspended(audio.state !== "running")
      parts.current = { stream, context: audio, node }
      const track = stream.getAudioTracks()[0]
      setTrackLabel(track?.label ?? null)
      setTrackMuted(track?.muted ?? false)
      if (track) {
        // "muted" means the OS or the hardware is delivering no sound (e.g. mic muted in Windows).
        track.onmute = () => setTrackMuted(true)
        track.onunmute = () => setTrackMuted(false)
      }
      stream.getAudioTracks()[0]?.addEventListener("ended", () => {
        setError("O microfone foi desconectado.")
        setStatus("error")
      })
      await refreshDevices()
      setStatus("ready")
    } catch (err) {
      discard()
      if (stale()) return
      const name = err instanceof Error ? err.name : ""
      if (name === "NotAllowedError" || name === "SecurityError") {
        setStatus("denied")
        setError("Permissão do microfone negada. Clique no cadeado da barra de endereço e permita o microfone.")
      } else if (name === "NotFoundError" || name === "OverconstrainedError") {
        setStatus("error")
        setError("Esse microfone não foi encontrado. Escolha outro na lista.")
        await refreshDevices().catch(() => undefined)
      } else {
        setStatus("error")
        setError(err instanceof Error ? err.message : "Não consegui abrir o microfone.")
      }
    }
  }, [close, refreshDevices])

  const choose = useCallback((id: string) => {
    setDeviceId(id)
    try {
      localStorage.setItem(STORAGE_KEY, id)
    } catch {
      /* not persisted in private mode */
    }
    void open(id)
  }, [open])

  /**
   * Opens every microphone for 1.5 s while the user speaks and keeps the one that heard the most.
   * Solves the common case of Chrome defaulting to "Stereo Mix" or a disconnected headset.
   */
  const scan = useCallback(async () => {
    generations.current++
    close()
    setScanResults(null)
    setError(null)
    const all = await navigator.mediaDevices.enumerateDevices()
    const inputs = all.filter((d) => d.kind === "audioinput" && d.deviceId && d.deviceId !== "default" && d.deviceId !== "communications")
    const results: ScanResult[] = []
    for (const [index, device] of inputs.entries()) {
      const label = device.label || `Microfone ${index + 1}`
      setScanning({ index: index + 1, total: inputs.length, label })
      let stream: MediaStream | null = null
      const context = new AudioContext()
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { deviceId: { exact: device.deviceId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        })
        await context.resume()
        const analyser = context.createAnalyser()
        analyser.fftSize = 2048
        context.createMediaStreamSource(stream).connect(analyser)
        const buffer = new Float32Array(analyser.fftSize)
        let loudest = 0
        for (const end = performance.now() + 1500; performance.now() < end; ) {
          await new Promise((resolve) => setTimeout(resolve, 50))
          analyser.getFloatTimeDomainData(buffer)
          let sum = 0
          for (const value of buffer) sum += value * value
          loudest = Math.max(loudest, Math.sqrt(sum / buffer.length))
        }
        results.push({ id: device.deviceId, label, level: toLevel(loudest) })
      } catch {
        results.push({ id: device.deviceId, label, level: -1 })
      } finally {
        stream?.getTracks().forEach((track) => track.stop())
        void context.close()
      }
    }
    setScanning(null)
    setScanResults(results)
    const best = results.reduce<ScanResult | null>((top, r) => (!top || r.level > top.level ? r : top), null)
    if (best && best.level > 0.2) choose(best.id)
    else void open(deviceId)
    return results
  }, [close, choose, open, deviceId])

  /** Some browsers keep the context suspended until a click; the page offers a button for it. */
  const resume = useCallback(async () => {
    await parts.current?.context.resume()
    setSuspended(parts.current?.context.state !== "running")
  }, [])

  useEffect(() => {
    void open(readSaved())
    const onChange = () => void refreshDevices().catch(() => undefined)
    navigator.mediaDevices.addEventListener("devicechange", onChange)
    return () => {
      navigator.mediaDevices.removeEventListener("devicechange", onChange)
      generations.current++  // an open() still in flight becomes stale and cleans up after itself
      close()
    }
  }, [open, close, refreshDevices])

  const selected = devices.find((d) => d.id === deviceId) ? deviceId : devices[0]?.id ?? ""
  return {
    status, devices, deviceId: selected, level, db, suspended, error, onPcm, trackLabel, trackMuted,
    scanning, scanResults, scan, choose, retry: () => open(deviceId), resume,
  }
}
