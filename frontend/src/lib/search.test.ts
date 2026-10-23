import { describe, expect, it } from "vitest"

import { fold, matchRanges } from "@/lib/search"

describe("fold", () => {
  it("removes accents and case but keeps one character per character", () => {
    expect(fold("Reunião ÀS 9h")).toBe("reuniao as 9h")
    expect(fold("Reunião").length).toBe("Reunião".length)
  })
})

describe("matchRanges", () => {
  it("finds every match ignoring accents and case", () => {
    expect(matchRanges("Orçamento e orcamento", "ORÇAMENTO")).toEqual([[0, 9], [12, 21]])
  })
  it("returns nothing for an empty query", () => {
    expect(matchRanges("texto", "")).toEqual([])
  })
})
