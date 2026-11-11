import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const YTDLP = process.env.YTDLP_PATH || 'yt-dlp';
export const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
export const MAX_FILE_MB = Number(process.env.MAX_FILE_MB) || 500;

const TIKTOK_HOSTS = /(^|\.)tiktok(v)?\.com$/i;

export function isTiktokUrl(url) {
  try {
    return TIKTOK_HOSTS.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

function isTransient(err) {
  const text = `${err?.message || ''} ${err?.stderr || ''}`;
  return /HTTP Error (403|429)|challenge|Unexpected response|timed? ?out|ECONNRESET|ENOTFOUND|EAI_AGAIN/i.test(text);
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function inspect(url) {
  const args = [
    '-J',
    '--no-warnings',
    '--playlist-items', '1-50',
    '--socket-timeout', '20',
    '--extractor-retries', '5',
  ];
  if (isTiktokUrl(url)) {
    args.push('--impersonate', 'Chrome-133');
  }
  args.push(url);

  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const { stdout } = await execFileAsync(YTDLP, args, {
        maxBuffer: 32 * 1024 * 1024,
        timeout: 90_000,
      });
      return JSON.parse(stdout);
    } catch (err) {
      lastError = err;
      if (attempt === 1 || !isTransient(err)) break;
      await delay(1200);
    }
  }
  throw lastError;
}

export function buildDownloadArgs({ jobDir, url, selector, audio, entryIndex, outputBase }) {
  const args = [
    '--no-warnings',
    '--newline',
    '--no-mtime',
    '--socket-timeout', '20',
    '--retries', '5',
    '--extractor-retries', '5',
    '--max-filesize', `${MAX_FILE_MB}M`,
  ];
  if (isTiktokUrl(url)) {
    args.push('--impersonate', 'Chrome-133');
  }
  if (Number.isInteger(entryIndex)) {
    args.push('--playlist-items', String(entryIndex + 1));
  }
  if (audio) {
    args.push('-x', '--audio-format', 'm4a');
  } else {
    args.push('--merge-output-format', 'mp4');
  }
  const outTemplate = outputBase
    ? `${outputBase}.%(ext)s`
    : '%(title).80s [%(id)s].%(ext)s';
  args.push(
    '-f', selector,
    '-P', jobDir,
    '-o', outTemplate,
    url,
  );
  return args;
}

export function parseProgress(line) {
  const match = String(line || '').match(/\[download\]\s+(\d+(?:\.\d+)?)%/);
  if (!match) return null;
  return Math.min(100, Number(match[1]));
}

async function version(bin, args) {
  try {
    const { stdout } = await execFileAsync(bin, args, { timeout: 10_000 });
    return String(stdout).split('\n')[0].trim();
  } catch {
    return null;
  }
}

export async function getSystemInfo() {
  const [ytdlpVersion, ffmpegLine] = await Promise.all([
    version(YTDLP, ['--version']),
    version(FFMPEG, ['-version']),
  ]);
  const ffmpegVersion = ffmpegLine
    ? (ffmpegLine.match(/ffmpeg version (\S+)/) || [null, ffmpegLine])[1]
    : null;
  return { ytdlp: ytdlpVersion, ffmpeg: ffmpegVersion };
}
