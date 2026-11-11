#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

cd "$(dirname "$0")/.."
STATE="${HOME}/.goomysdl"
mkdir -p "$STATE"

if [ -f "$STATE/server.pid" ] && kill -0 "$(cat "$STATE/server.pid")" 2>/dev/null; then
  echo "Server already running (PID $(cat "$STATE/server.pid"))."
  exit 0
fi

termux-wake-lock 2>/dev/null || true

PORT="${PORT:-3000}"
PORT="$PORT" nohup node server.js >>"$STATE/server.log" 2>&1 &
echo $! >"$STATE/server.pid"
sleep 2

if ! kill -0 "$(cat "$STATE/server.pid")" 2>/dev/null; then
  echo "Server failed to start. See $STATE/server.log"
  exit 1
fi

if ! command -v cloudflared >/dev/null; then
  echo "Local: http://127.0.0.1:${PORT}"
  echo "cloudflared not installed; no public tunnel."
  exit 0
fi

: >"$STATE/tunnel.log"
nohup cloudflared tunnel --url "http://127.0.0.1:${PORT}" >>"$STATE/tunnel.log" 2>&1 &
echo $! >"$STATE/tunnel.pid"

URL=""
for _ in $(seq 1 30); do
  URL=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$STATE/tunnel.log" | head -n 1 || true)
  [ -n "$URL" ] && break
  sleep 1
done

echo "Local: http://127.0.0.1:${PORT}"
if [ -n "$URL" ]; then
  echo "Public: $URL"
else
  echo "Tunnel URL not ready yet. Check: tail -f $STATE/tunnel.log"
fi
