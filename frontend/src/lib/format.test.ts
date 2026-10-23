import { describe, expect, it } from "vitest"

import { formatBytes, formatClock, formatDate, formatDuration, initials, splitNames } from "@/lib/format"

describe("formatClock", () => {
  it("shows minutes and seconds, adding hours only when needed", () => {
    expect(formatClock(0)).toBe("0:00")
    expect(formatClock(65.9)).toBe("1:05")
    expect(formatClock(3725)).toBe("1:02:05")
    expect(formatClock(-3)).toBe("0:00")
  })
})

describe("formatDuration", () => {
  it("rounds to seconds, minutes or hours", () => {
    expect(formatDuration(null)).toBe("—")
    expect(formatDuration(20)).toBe("20 s")
    expect(formatDuration(32 * 60)).toBe("32 min")
    expect(formatDuration(70 * 60)).toBe("1 h 10 min")
  })
})

describe("formatBytes", () => {
  it("picks the largest unit", () => {
    expect(formatBytes(undefined)).toBe("—")
    expect(formatBytes(512)).toBe("512 B")
    expect(formatBytes(1536)).toBe("1.5 KB")
    expect(formatBytes(3.3 * 1024 ** 3)).toBe("3.3 GB")
  })
})

describe("formatDate", () => {
  it("keeps the calendar day without timezone shifts", () => {
    expect(formatDate("2026-09-24", "short")).toBe("24/09")
    expect(formatDate("2026-01-01")).toContain("2026")
  })
})

describe("names", () => {
  it("splits a comma list and builds initials", () => {
    expect(splitNames(" Ana , ,Bruno Lima ")).toEqual(["Ana", "Bruno Lima"])
    expect(initials("Bruno Lima Souza")).toBe("BS")
    expect(initials("ana")).toBe("A")
  })
})
