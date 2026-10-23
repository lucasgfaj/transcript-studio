/** Reads a newline-delimited JSON stream, calling `onEvent` for every complete line. */
export async function readNdjson<T>(body: ReadableStream<Uint8Array<ArrayBuffer>>, onEvent: (event: T) => void): Promise<void> {
  const reader = body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ""
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += value
    const lines = buffer.split("\n")
    buffer = lines.pop() ?? ""
    for (const line of lines) if (line.trim()) onEvent(JSON.parse(line) as T)
  }
}
