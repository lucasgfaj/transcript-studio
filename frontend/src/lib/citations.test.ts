import { describe, expect, it } from "vitest"

import { linkCitations, snapToSegment, toSeconds } from "@/lib/citations"

const segments = [
  { start: 30, end: 60 },
  { start: 60, end: 95 },
  { start: null, end: null },
]

describe("toSeconds", () => {
  it("reads mm:ss and h:mm:ss", () => {
    expect(toSeconds("01:05")).toBe(65)
    expect(toSeconds("1:02:05")).toBe(3725)
  })
})

describe("snapToSegment", () => {
  it("moves a time inside a segment to its start", () => {
    expect(snapToSegment(38, segments)).toBe(30)
  })
  it("uses the closest segment start when no segment contains it", () => {
    expect(snapToSegment(200, segments)).toBe(60)
    expect(snapToSegment(5, segments)).toBe(30)
  })
  it("keeps the time when nothing is timed", () => {
    expect(snapToSegment(42, [])).toBe(42)
  })
})

describe("linkCitations", () => {
  it("turns [mm:ss] into links to the start of the cited segment", () => {
    expect(linkCitations("Aprovado [00:38] e depois [1:01:00].", segments))
      .toBe("Aprovado [00:30](#t=30) e depois [01:00](#t=60).")
  })
  it("leaves other brackets alone", () => {
    expect(linkCitations("Ver [anexo] e [x:10].", segments)).toBe("Ver [anexo] e [x:10].")
  })
})
