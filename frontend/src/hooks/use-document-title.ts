import { useEffect } from "react"

/** Sets the browser tab title; status prefixes (⏳) make long jobs visible from another tab. */
export function useDocumentTitle(title: string | null | undefined) {
  useEffect(() => {
    document.title = title ? `${title} · Transcript Studio` : "Transcript Studio"
  }, [title])
}
