# Goomys/DL

Web app for downloading video and photo from public social media posts. Built on Express, [yt-dlp](https://github.com/yt-dlp/yt-dlp) and FFmpeg.

## Features

- Inspect a post and list available formats before downloading
- Queued jobs with live progress, 2 concurrent downloads
- Downloads sealed with AES-256-GCM at rest, keys held in memory only
- Files are stored under random names; original titles stay in memory only
- Files auto-delete after 10 minutes; analysis expires after 15 minutes
- Host allowlist (TikTok, Instagram, X/Twitter, YouTube, Facebook, Reddit, Vimeo, Twitch, SoundCloud, Dailymotion)
- Per-IP rate limit, 500 MB max file size, disk-space guard

## Requirements

- Node.js 24+
- `yt-dlp` and `ffmpeg` on `PATH`

## Run locally

```bash
npm install
npm test
npm start
```

Open http://localhost:3000.

Environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `YTDLP_PATH` | `yt-dlp` | Path to the yt-dlp binary |
| `FFMPEG_PATH` | `ffmpeg` | Path to the ffmpeg binary |
| `MAX_FILE_MB` | `500` | Max download size per job |
| `YTDLP_COOKIES` | (none) | Path to a Netscape `cookies.txt` for private/age-gated posts |

Instagram and TikTok use browser impersonation automatically. Public Instagram posts often work without a session, but private posts, stories and age-gated content need cookies from a logged-in account:

```bash
export YTDLP_COOKIES="$HOME/cookies.txt"
```

Export cookies from your browser in Netscape format. Cookies are session credentials: use a throwaway account, keep volume low, never commit the file (it is gitignored).

## Docker

```bash
docker build -t goomysdl .
docker run --rm -p 3000:3000 goomysdl
```

The image runs as a non-root user. Do not mount a persistent volume over `downloads/`: the app wipes it on startup and the encryption keys only live in memory.

## Run on a phone (Termux)

```bash
./scripts/start.sh   # starts the server + a Cloudflare quick tunnel, prints the public URL
./scripts/stop.sh    # stops both
```

Logs are written to `~/.goomysdl/`. The quick-tunnel URL changes on every restart.

### Fixed URL with a named tunnel

1. Buy a domain and add it to your Cloudflare account (free plan).
2. Create the tunnel and DNS route:

   ```bash
   ./scripts/tunnel-setup.sh dl.example.com
   ```

   The first run opens a Cloudflare login link. After that, config is written to `~/.cloudflared/config.yml`.
3. Start as usual; `start.sh` prefers the named tunnel once the config exists:

   ```bash
   ./scripts/start.sh
   ```

The public URL then stays `https://dl.example.com` across restarts.

For auto-start on boot, install the **Termux:Boot** app and copy the boot script:

```bash
cp scripts/termux-boot.sh ~/.termux/boot/goomysdl
chmod +x ~/.termux/boot/goomysdl
```

Also disable Android battery optimization for Termux so the process is not killed.

## Notes

- Public posts only. Private, age-gated or login-required content cannot be fetched.
- The allowlist intentionally blocks arbitrary URLs to prevent SSRF against internal networks.
- Only download content you have the right to use, and respect each platform's terms of service.
