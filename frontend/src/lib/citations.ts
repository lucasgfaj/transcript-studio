/** [12:34] citations in chat answers, linked to the start of the transcript segment they point to. */
export interface TimedSpan {
  start: number | null
  end: number | null
}

const TIMESTAMP = /\[(\d{1,2}:\d{2}(?::\d{2})?)\]/g

export function toSeconds(clock: string): number {
  return clock.split(":").map(Number).reduce((total, part) => total * 60 + part, 0)
}

function clock(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  const mm = String(m).padStart(2, "0")
  const ss = String(s).padStart(2, "0")
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

/** Same rule as the server: a cited time moves to the start of the segment that contains it. */
export function snapToSegment(seconds: number, segments: TimedSpan[]): number {
  const timed = segments.filter((s) => s.start !== null && s.end !== null)
  if (!timed.length) return seconds
  const inside = timed.find((s) => seconds >= s.start! && seconds < s.end!)
  if (inside) return inside.start!
  return timed.reduce((best, s) => (Math.abs(s.start! - seconds) < Math.abs(best - seconds) ? s.start! : best), timed[0].start!)
}

/** Markdown links `[mm:ss](#t=seconds)` that the chat renders as play buttons. */
export function linkCitations(text: string, segments: TimedSpan[]): string {
  return text.replace(TIMESTAMP, (_match, cited: string) => {
    const at = snapToSegment(toSeconds(cited), segments)
    return `[${clock(at)}](#t=${at})`
  })
}
