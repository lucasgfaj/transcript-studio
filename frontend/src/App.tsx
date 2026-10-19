import { BrowserRouter, Link, Route, Routes } from "react-router"

import { AppShell } from "@/components/app-shell"
import { Button } from "@/components/ui/button"
import { LibraryPage } from "@/pages/library-page"
import { MeetingPage } from "@/pages/meeting-page"
import { NewMeetingPage } from "@/pages/new-meeting-page"

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
        <Routes>
          <Route path="/" element={<LibraryPage />} />
          <Route path="/nova" element={<NewMeetingPage />} />
          <Route path="/reunioes/:id" element={<MeetingPage />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </AppShell>
    </BrowserRouter>
  )
}
