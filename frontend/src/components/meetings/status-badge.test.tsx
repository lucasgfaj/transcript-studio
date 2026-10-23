import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { StatusBadge } from "@/components/meetings/status-badge"

describe("StatusBadge", () => {
  it("shows the status in Portuguese", () => {
    render(<StatusBadge status="transcribing" />)
    expect(screen.getByText("Transcrevendo")).toBeInTheDocument()
  })
})
