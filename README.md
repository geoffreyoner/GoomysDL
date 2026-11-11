# Goomys/DL

Dark, monochrome web app for downloading video and photo from public social media posts. Built on Express, [yt-dlp](https://github.com/yt-dlp/yt-dlp) and FFmpeg.

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
