#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

STATE="${HOME}/.goomysdl"
for name in tunnel server; do
  [ -f "$STATE/$name.pid" ] || continue
  kill "$(cat "$STATE/$name.pid")" 2>/dev/null || true
  rm -f "$STATE/$name.pid"
done

termux-wake-unlock 2>/dev/null || true
echo "Stopped."
