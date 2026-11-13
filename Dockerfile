FROM node:24-slim

# shortcut: yt-dlp is fetched from "latest"; pass --build-arg YTDLP_VERSION=<tag> to pin.
ARG YTDLP_VERSION=latest

# shortcut: gallery-dl is installed from PyPI latest; pin with --build-arg if its API changes.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates curl python3 python3-pip zip \
  && curl -fsSL "https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP_VERSION}/yt-dlp_linux" -o /usr/local/bin/yt-dlp \
  && chmod +x /usr/local/bin/yt-dlp \
  && pip3 install --break-system-packages --no-cache-dir gallery-dl \
  && apt-get purge -y curl \
  && apt-get autoremove -y \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --omit=optional
COPY --chown=node:node . .
RUN mkdir -p /app/downloads && chown -R node:node /app/downloads

ENV NODE_ENV=production \
    PORT=3000 \
    YTDLP_PATH=/usr/local/bin/yt-dlp \
    FFMPEG_PATH=/usr/bin/ffmpeg

USER node
EXPOSE 3000
CMD ["node", "server.js"]
