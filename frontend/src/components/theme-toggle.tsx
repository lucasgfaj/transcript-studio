import { Monitor, Moon, Sun } from "lucide-react"
import { useTheme } from "@/components/theme-provider"

import { Button } from "@/components/ui/button"

const order = ["system", "light", "dark"] as const
const icons = { system: Monitor, light: Sun, dark: Moon }
const labels = { system: "Tema do sistema", light: "Tema claro", dark: "Tema escuro" }

export function ThemeToggle() {
  const { theme = "system", setTheme } = useTheme()
  const current = (order as readonly string[]).includes(theme) ? (theme as (typeof order)[number]) : "system"
  const Icon = icons[current]
  const next = order[(order.indexOf(current) + 1) % order.length]
  return (
    <Button variant="ghost" size="icon-sm" title={labels[current]} aria-label={`${labels[current]} (trocar)`} onClick={() => setTheme(next)}>
      <Icon />
    </Button>
  )
}
