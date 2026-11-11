#!/data/data/com.termux/files/usr/bin/bash
# Install: cp scripts/termux-boot.sh ~/.termux/boot/goomysdl && chmod +x ~/.termux/boot/goomysdl
# Requires the Termux:Boot app.

termux-wake-lock 2>/dev/null || true
sleep 15
mkdir -p "$HOME/.goomysdl"
"$HOME/Downloader/scripts/start.sh" >>"$HOME/.goomysdl/boot.log" 2>&1
