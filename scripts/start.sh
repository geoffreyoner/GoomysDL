#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

cd "$(dirname "$0")/.."
STATE="${HOME}/.goomysdl"
CFG="${HOME}/.cloudflared/config.yml"
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

if [ -f "$STATE/tunnel.pid" ] && kill -0 "$(cat "$STATE/tunnel.pid")" 2>/dev/null; then
  echo "Tunnel already running (PID $(cat "$STATE/tunnel.pid"))."
else
  : >"$STATE/tunnel.log"
  if [ -f "$CFG" ]; then
    nohup cloudflared tunnel --config "$CFG" run >>"$STATE/tunnel.log" 2>&1 &
  else
    nohup cloudflared tunnel --url "http://127.0.0.1:${PORT}" >>"$STATE/tunnel.log" 2>&1 &
  fi
  echo $! >"$STATE/tunnel.pid"
fi

echo "Local: http://127.0.0.1:${PORT}"
if [ -f "$CFG" ]; then
  HOST=$(grep -m1 'hostname:' "$CFG" | awk '{print $2}' || true)
  if [ -n "$HOST" ]; then
    echo "Public: https://${HOST}"
  else
    echo "Named tunnel config found but no hostname. Check $CFG"
  fi
else
  URL=""
  for _ in $(seq 1 30); do
    URL=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$STATE/tunnel.log" | head -n 1 || true)
    [ -n "$URL" ] && break
    sleep 1
  done
  if [ -n "$URL" ]; then
    echo "Public: $URL"
  else
    echo "Tunnel URL not ready yet. Check: tail -f $STATE/tunnel.log"
  fi
fi
