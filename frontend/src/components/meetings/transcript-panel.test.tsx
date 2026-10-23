import { screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { TranscriptPanel } from "@/components/meetings/transcript-panel"
import { mockFetch, renderWithQuery } from "@/test/render"

const transcript = {
  text: "Bom dia a todos.\nO orçamento foi aprovado.\nO orcamento sai sexta.",
  segments: [
    { idx: 0, start: 0, end: 4, text: "Bom dia a todos." },
    { idx: 1, start: 65, end: 70, text: "O orçamento foi aprovado." },
    { idx: 2, start: 70, end: 75, text: "O orcamento sai sexta." },
  ],
}

describe("TranscriptPanel", () => {
  it("plays the audio from the clicked segment", async () => {
    mockFetch({ "/api/meetings/m1/transcript": transcript })
    const onSeek = vi.fn()
    renderWithQuery(<TranscriptPanel meetingId="m1" onSeek={onSeek} />)

    await userEvent.click(await screen.findByText("1:05"))

    expect(onSeek).toHaveBeenCalledWith(65)
    expect(screen.getByText(/3 trechos com marcação de tempo/)).toBeInTheDocument()
  })

  it("search ignores accents and highlights every match", async () => {
    mockFetch({ "/api/meetings/m1/transcript": transcript })
    renderWithQuery(<TranscriptPanel meetingId="m1" />)

    await userEvent.type(await screen.findByLabelText("Buscar na transcrição"), "ORCAMENTO")

    const marks = document.querySelectorAll("mark")
    expect(Array.from(marks, (mark) => mark.textContent)).toEqual(["orçamento", "orcamento"])
  })

  it("offers to paste a transcript when there is none", async () => {
    mockFetch({ "/api/meetings/m1/transcript": { text: "", segments: [] } })
    renderWithQuery(<TranscriptPanel meetingId="m1" />)

    expect(await screen.findByText("Sem transcrição ainda")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Colar transcrição/ })).toBeInTheDocument()
  })
})
