#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
VENV="$ROOT/myvenvv"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"

echo "============================================"
echo " TunisIA Investment Platform"
echo "============================================"
echo " Starts backend + frontend only."
echo " Ollama is NOT started here - run 'ollama serve'"
echo " separately if you want live AI. Without it the"
echo " app still works (AI features use a fallback)."
echo "============================================"

# Check that the venv exists
if [ ! -f "$VENV/bin/python" ]; then
    echo "[ERROR] Virtual environment not found at $VENV"
    echo "Run: python -m venv myvenvv && myvenvv/bin/pip install -r requirements.txt"
    exit 1
fi

# Check that npm is available
if ! command -v npm &>/dev/null; then
    echo "[ERROR] npm not found. Install Node.js from https://nodejs.org"
    exit 1
fi

# Install frontend deps if node_modules is missing
if [ ! -d "$FRONTEND/node_modules" ]; then
    echo "[INFO] Installing frontend dependencies..."
    cd "$FRONTEND"
    npm install
fi

# Kill any existing processes on the target ports
for port in 8001 5173; do
    if fuser "$port/tcp" &>/dev/null; then
        echo "[INFO] Port $port in use — killing existing process..."
        fuser -k "$port/tcp" 2>/dev/null
        sleep 1
    fi
done

echo ""
echo "[1/2] Starting backend on http://localhost:8001 ..."
cd "$BACKEND"
"$VENV/bin/python" -m uvicorn main:app --reload --host 127.0.0.1 --port 8001 &
BACKEND_PID=$!

# Give uvicorn a moment to bind
sleep 2

echo "[2/2] Starting frontend on http://localhost:5173 ..."
cd "$FRONTEND"
npm run dev &
FRONTEND_PID=$!

echo ""
echo "============================================"
echo " Backend:   http://localhost:8001/docs"
echo " Frontend:  http://localhost:5173"
echo "============================================"
echo " Press Ctrl+C to stop both servers."
echo "============================================"

# Trap SIGINT/SIGTERM to clean up child processes
cleanup() {
    echo ""
    echo "[INFO] Shutting down..."
    kill "$BACKEND_PID" 2>/dev/null || true
    kill "$FRONTEND_PID" 2>/dev/null || true
    wait "$BACKEND_PID" 2>/dev/null || true
    wait "$FRONTEND_PID" 2>/dev/null || true
    echo "[INFO] Both servers stopped."
    exit 0
}
trap cleanup SIGINT SIGTERM

# Wait for either process to exit
wait
