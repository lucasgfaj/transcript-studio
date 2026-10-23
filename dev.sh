#!/usr/bin/env bash
# ./dev.sh          development: API with reload on :8000 + Vite with hot reload on :5173 (open this one)
# ./dev.sh start    everyday use: builds the interface and serves everything on http://localhost:8000
# ./dev.sh build    only builds the interface (frontend/dist)
# ./dev.sh test     backend tests with coverage + lint, tests, type check and build of the interface
set -euo pipefail
cd "$(dirname "$0")"
export PATH="$HOME/.local/bin:$PATH"
[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" >/dev/null

ensure_dependencies() {
  [ -d backend/.venv ] || (cd backend && uv sync)
  [ -d frontend/node_modules ] || (cd frontend && npm install)
}

open_browser_when_ready() {
  # Waits for the API, then opens the Windows browser (WSL interop) or the Linux one.
  for _ in $(seq 1 60); do
    if curl -sf http://127.0.0.1:8000/api/health >/dev/null; then
      if command -v cmd.exe >/dev/null; then cmd.exe /c start "" "http://localhost:8000" >/dev/null 2>&1
      elif command -v xdg-open >/dev/null; then xdg-open "http://localhost:8000" >/dev/null 2>&1; fi
      return
    fi
    sleep 1
  done
}

case "${1:-dev}" in
  build)
    ensure_dependencies
    (cd frontend && npm run build)
    ;;
  test)
    ensure_dependencies
    (cd backend && uv run pytest -q --cov)
    (cd frontend && npm run lint && npm run coverage && npm run build)
    ;;
  start)
    ensure_dependencies
    (cd frontend && npm run build >/dev/null) && echo "Interface compilada."
    if ! curl -sf -m 3 http://127.0.0.1:11434/api/version >/dev/null; then
      echo "Aviso: o Ollama não respondeu em localhost:11434. Abra o Ollama no Windows para gerar atas e usar o chat."
    fi
    echo "Transcript Studio em http://localhost:8000  (Ctrl+C para parar)"
    open_browser_when_ready &
    cd backend && exec uv run uvicorn transcript_studio.main:app --host 127.0.0.1 --port 8000
    ;;
  dev)
    ensure_dependencies
    (cd backend && uv run uvicorn transcript_studio.main:app --reload --host 127.0.0.1 --port 8000) &
    api=$!
    trap 'kill $api 2>/dev/null' EXIT INT TERM
    cd frontend && npm run dev -- --host 127.0.0.1
    ;;
  *)
    echo "Uso: ./dev.sh [dev|start|build|test]" >&2
    exit 1
    ;;
esac
