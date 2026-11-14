#!/data/data/com.termux/files/usr/bin/bash
# Install: mkdir -p ~/.termux/boot && ln -sf "$PWD/scripts/termux-boot.sh" ~/.termux/boot/goomysdl
# Requires the Termux:Boot app.

termux-wake-lock 2>/dev/null || true
sleep 15
mkdir -p "$HOME/.goomysdl"

SELF="$(readlink -f "$0" 2>/dev/null || echo "$0")"
ROOT="$(cd "$(dirname "$SELF")/.." 2>/dev/null && pwd || true)"
if [ ! -x "$ROOT/scripts/start.sh" ]; then
  for ROOT in "$HOME/GoomysDL" "$HOME/Downloader" "$HOME/goomysdl"; do
    [ -x "$ROOT/scripts/start.sh" ] && break
  done
fi
if [ -x "$ROOT/scripts/start.sh" ]; then
  "$ROOT/scripts/start.sh" >>"$HOME/.goomysdl/boot.log" 2>&1
else
  echo "GoomysDL not found; reinstall the boot link from the repo." >>"$HOME/.goomysdl/boot.log"
fi
