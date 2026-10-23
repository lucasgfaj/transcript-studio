/// <reference types="vitest/config" />
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": new URL("./src", import.meta.url).pathname },
  },
  server: {
    port: 5173,
    proxy: { "/api": { target: "http://127.0.0.1:8000", ws: true } },  // ws: live recording socket
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    coverage: { include: ["src/lib/**", "src/components/meetings/**", "src/hooks/**"], reporter: ["text-summary"], thresholds: { lines: 15, functions: 15, branches: 15, statements: 15 } },
  },
})
