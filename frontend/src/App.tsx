import { lazy, Suspense } from "react"
import { BrowserRouter, Link, Route, Routes } from "react-router"

import { AppShell } from "@/components/app-shell"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"

// Each page is its own chunk: the meeting page alone pulls in wavesurfer and the Markdown renderer.
const LibraryPage = lazy(() => import("@/pages/library-page").then((m) => ({ default: m.LibraryPage })))
const NewMeetingPage = lazy(() => import("@/pages/new-meeting-page").then((m) => ({ default: m.NewMeetingPage })))
const LivePage = lazy(() => import("@/pages/live-page").then((m) => ({ default: m.LivePage })))
const ModelsPage = lazy(() => import("@/pages/models-page").then((m) => ({ default: m.ModelsPage })))
const ContextPage = lazy(() => import("@/pages/context-page").then((m) => ({ default: m.ContextPage })))
const MeetingPage = lazy(() => import("@/pages/meeting-page").then((m) => ({ default: m.MeetingPage })))

function PageFallback() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-10 w-1/2" />
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  )
}

function NotFound() {
  return (
    <div className="flex flex-col items-center gap-3 py-24 text-center">
      <div className="font-heading text-xl font-semibold">Página não encontrada</div>
      <Button asChild variant="outline">
        <Link to="/">Ir para as reuniões</Link>
      </Button>
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AppShell>
        <Suspense fallback={<PageFallback />}>
          <Routes>
            <Route path="/" element={<LibraryPage />} />
            <Route path="/nova" element={<NewMeetingPage />} />
            <Route path="/ao-vivo" element={<LivePage />} />
            <Route path="/reunioes/:id" element={<MeetingPage />} />
            <Route path="/modelos" element={<ModelsPage />} />
            <Route path="/contexto" element={<ContextPage />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </AppShell>
    </BrowserRouter>
  )
}
