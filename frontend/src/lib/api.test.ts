import { describe, expect, it, vi } from "vitest"

import { api, ApiError, isActive, type ChatEvent } from "@/lib/api"

describe("api", () => {
  it("turns the server's detail into an ApiError", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ detail: "Reunião não encontrada." }), { status: 404 })))

    const error = await api.getMeeting("x").catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 404, message: "Reunião não encontrada." })
  })

  it("sends JSON bodies and accepts empty 204 answers", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }))
    vi.stubGlobal("fetch", fetchMock)

    await expect(api.clearChat("m1")).resolves.toBeUndefined()
    await api.updatePreferences({ default_llm: "qwen" })

    const [path, init] = fetchMock.mock.calls[1] as unknown as [string, RequestInit]
    expect(path).toBe("/api/preferences")
    expect(init.method).toBe("PUT")
    expect(init.headers).toMatchObject({ "Content-Type": "application/json" })
  })

  it("streams the chat answer event by event", async () => {
    const body = ['{"type":"status","message":"Lendo"}\n{"type":"tok', 'en","text":"Oi"}\n']
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      start(controller) {
        for (const chunk of body) controller.enqueue(encoder.encode(chunk))
        controller.close()
      },
    })
    vi.stubGlobal("fetch", vi.fn(async () => new Response(stream, { status: 200 })))
    const events: ChatEvent[] = []

    await api.askChat("m1", "Quais tarefas?", (event) => events.push(event))

    expect(events).toEqual([{ type: "status", message: "Lendo" }, { type: "token", text: "Oi" }])
  })

  it("knows which jobs are still running", () => {
    expect(isActive(null)).toBe(false)
    expect(isActive({ status: "queued" } as never)).toBe(true)
    expect(isActive({ status: "done" } as never)).toBe(false)
  })
})
