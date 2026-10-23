import "@testing-library/jest-dom/vitest"
import { cleanup } from "@testing-library/react"
import { afterEach, vi } from "vitest"

afterEach(cleanup)

// jsdom has no layout: scrolling the current segment into view is a no-op in tests.
Element.prototype.scrollIntoView = () => {}
afterEach(() => vi.unstubAllGlobals())
