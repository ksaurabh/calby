#!/usr/bin/env bash
#
# run-locally.sh — start the Calby webapp locally (frontend + backend).
#
# Starts the Express API (:3005) and the Vite dev server (:5178) together and
# streams both logs. Press Ctrl-C to stop both.
#
#   ./run-locally.sh
#
set -euo pipefail

cd "$(dirname "$0")"

# --- prerequisites ----------------------------------------------------------
if ! command -v node >/dev/null 2>&1; then
  echo "❌ node is not installed. Install Node.js 18+ and try again." >&2
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "❌ npm is not installed. Install Node.js (which includes npm) and try again." >&2
  exit 1
fi

# --- dependencies -----------------------------------------------------------
if [ ! -d node_modules ]; then
  echo "📦 Installing dependencies (npm install)..."
  npm install
fi

# --- environment ------------------------------------------------------------
if [ ! -f .env ]; then
  echo "⚙️  No .env found — creating one from .env.example."
  cp .env.example .env
  echo "   Edit .env to set GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET for Google sign-in."
fi

# --- run --------------------------------------------------------------------
# Start the backend in the background, the frontend in the foreground, and make
# sure Ctrl-C (or any exit) tears down both.
pids=()

# Recursively kill a process and all of its descendants. npm spawns vite/node
# a few levels deep, so killing just the npm pid would orphan them (and they'd
# keep holding ports 5178/3005).
kill_tree() {
  local pid=$1 child
  for child in $(pgrep -P "$pid" 2>/dev/null); do
    kill_tree "$child"
  done
  kill "$pid" 2>/dev/null || true
}

cleanup() {
  trap - INT TERM EXIT
  echo ""
  echo "🛑 Shutting down..."
  for pid in "${pids[@]}"; do
    kill_tree "$pid"
  done
  wait 2>/dev/null || true
}
trap cleanup INT TERM EXIT

echo "🚀 Starting backend API on http://localhost:3005"
npm run dev:server &
pids+=("$!")

echo "🚀 Starting frontend on http://localhost:5178"
npm run dev &
pids+=("$!")

echo ""
echo "✅ App running:"
echo "   Frontend → http://localhost:5178"
echo "   Backend  → http://localhost:3005"
echo "   Press Ctrl-C to stop."
echo ""

# Block until interrupted (Ctrl-C) or a process exits; cleanup() tears down both.
wait
