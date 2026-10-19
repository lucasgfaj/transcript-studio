#!/usr/bin/env bash
# Development: API with reload on :8000 and Vite with hot reload on :5173 (open this one).
# Production-like: `./dev.sh build` then `cd backend && uv run transcript-studio` -> http://localhost:8000
set -euo pipefail
cd "$(dirname "$0")"
export PATH="$HOME/.local/bin:$PATH"
[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" >/dev/null

if [ "${1:-}" = "build" ]; then
  (cd frontend && npm run build)
  exit 0
fi

(cd backend && uv run uvicorn transcript_studio.main:app --reload --host 127.0.0.1 --port 8000) &
api=$!
trap 'kill $api 2>/dev/null' EXIT INT TERM
cd frontend && npm run dev -- --host 127.0.0.1
