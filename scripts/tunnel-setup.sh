#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

HOST="${1:-}"
if [ -z "$HOST" ]; then
  echo "Usage: $0 <hostname>"
  echo "Example: $0 dl.example.com"
  exit 1
fi

PORT="${PORT:-3000}"
CFG_DIR="${HOME}/.cloudflared"
CFG="${CFG_DIR}/config.yml"
NAME="goomysdl"

if ! command -v cloudflared >/dev/null; then
  echo "cloudflared tidak terpasang."
  exit 1
fi

mkdir -p "$CFG_DIR"

if [ ! -f "$CFG_DIR/cert.pem" ]; then
  echo "Login ke Cloudflare lewat browser..."
  cloudflared tunnel login
fi

tunnel_id() {
  cloudflared tunnel list --output json 2>/dev/null \
    | NAME="$NAME" node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const t=JSON.parse(s||"[]").find(x=>x.name===process.env.NAME);if(t)process.stdout.write(t.id)}catch{}})'
}

ID=$(tunnel_id)
if [ -z "$ID" ]; then
  echo "Membuat tunnel ${NAME}..."
  cloudflared tunnel create "$NAME" >/dev/null
  ID=$(tunnel_id)
fi
if [ -z "$ID" ]; then
  echo "Gagal membuat tunnel."
  exit 1
fi

if [ ! -f "$CFG_DIR/$ID.json" ]; then
  echo "Credential tunnel hilang: $CFG_DIR/$ID.json"
  echo "Hapus tunnel lama lalu ulangi:"
  echo "  cloudflared tunnel delete --force $NAME"
  exit 1
fi

printf 'tunnel: %s\ncredentials-file: %s/%s.json\ningress:\n  - hostname: %s\n    service: http://127.0.0.1:%s\n  - service: http_status:404\n' \
  "$ID" "$CFG_DIR" "$ID" "$HOST" "$PORT" >"$CFG"

echo "Mengarahkan ${HOST} ke tunnel..."
cloudflared tunnel route dns --overwrite-dns "$NAME" "$HOST"

echo
echo "Selesai. Jalankan ./scripts/start.sh"
echo "URL tetap: https://${HOST}"
