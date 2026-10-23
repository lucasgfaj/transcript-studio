import { describe, expect, it } from "vitest"

import { readNdjson } from "@/lib/ndjson"

function streamOf(...chunks: string[]): ReadableStream<Uint8Array<ArrayBuffer>> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
}

describe("readNdjson", () => {
  it("emits one event per line, even when a line is split across chunks", async () => {
    const events: unknown[] = []
    await readNdjson(streamOf('{"type":"tok', 'en","text":"Oi"}\n\n{"type":"done"}\n'), (event) => events.push(event))
    expect(events).toEqual([{ type: "token", text: "Oi" }, { type: "done" }])
  })

  it("ignores an unfinished last line", async () => {
    const events: unknown[] = []
    await readNdjson(streamOf('{"a":1}\n{"a":'), (event) => events.push(event))
    expect(events).toEqual([{ a: 1 }])
  })
})
