import { useState } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useUpdateMeeting } from "@/hooks/use-meetings"
import type { Meeting } from "@/lib/api"
import { splitNames } from "@/lib/format"

export function MeetingDetailsDialog({ meeting, open, onOpenChange }: { meeting: Meeting; open: boolean; onOpenChange: (open: boolean) => void }) {
  const update = useUpdateMeeting(meeting.id)
  const [title, setTitle] = useState(meeting.title)
  const [participants, setParticipants] = useState(meeting.participants.join(", "))
  const [date, setDate] = useState(meeting.date)

  const save = () =>
    update.mutate(
      { title: title.trim(), participants: splitNames(participants), date },
      {
        onSuccess: () => {
          toast.success("Dados atualizados")
          onOpenChange(false)
        },
        onError: (error) => toast.error("Não consegui salvar", { description: error.message }),
      },
    )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar reunião</DialogTitle>
          <DialogDescription>Título, participantes e data aparecem na biblioteca e na ata.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="edit-title">Título</Label>
            <Input id="edit-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="edit-participants">Participantes</Label>
            <Input id="edit-participants" value={participants} onChange={(e) => setParticipants(e.target.value)} placeholder="Separados por vírgula" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="edit-date">Data</Label>
            <Input id="edit-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={save} disabled={!title.trim() || update.isPending}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
