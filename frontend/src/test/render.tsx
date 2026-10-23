import type { ReactElement } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render } from "@testing-library/react"
import { vi } from "vitest"

/** Renders with a fresh React Query client (no retries, so errors show up at once). */
export function renderWithQuery(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

/** Replaces fetch with fixed JSON answers by URL path. */
export function mockFetch(routes: Record<string, unknown>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input)
    if (!(path in routes)) return new Response(JSON.stringify({ detail: "não encontrado" }), { status: 404 })
    return new Response(JSON.stringify(routes[path]), { status: 200, headers: { "Content-Type": "application/json" } })
  })
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}
