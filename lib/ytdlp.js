import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const YTDLP = process.env.YTDLP_PATH || 'yt-dlp';
export const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
export const MAX_FILE_MB = Number(process.env.MAX_FILE_MB) || 500;
export const COOKIES = process.env.YTDLP_COOKIES || '';

const TIKTOK_HOSTS = /(^|\.)tiktok(v)?\.com$/i;
const IMPERSONATE_HOSTS = /(^|\.)(tiktok(v)?\.com|instagram\.com)$/i;

export const IMPERSONATE_TARGETS = ['Chrome-133', 'Chrome-136', 'Safari-18.0'];

export function isTiktokUrl(url) {
  try {
    return TIKTOK_HOSTS.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

function needsImpersonation(url) {
  try {
    return IMPERSONATE_HOSTS.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

function authArgs(url, impersonate = IMPERSONATE_TARGETS[0]) {
  const args = [];
  if (COOKIES) args.push('--cookies', COOKIES);
  if (impersonate && needsImpersonation(url)) args.push('--impersonate', impersonate);
  return args;
}

export function isTransient(err) {
  const text = `${err?.message || ''} ${err?.stderr || ''}`;
  return /HTTP Error (403|429)|403 Forbidden|429 Too Many|challenge|Unexpected response|timed? ?out|ECONNRESET|ENOTFOUND|EAI_AGAIN/i.test(text);
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function inspect(url) {
  const base = [
    '-J',
    '--no-warnings',
    '--playlist-items', '1-50',
    '--socket-timeout', '20',
    '--extractor-retries', '5',
  ];

  let lastError;
  for (let attempt = 0; attempt < IMPERSONATE_TARGETS.length; attempt += 1) {
    const args = [
      ...base,
      ...authArgs(url, IMPERSONATE_TARGETS[attempt]),
      url,
    ];
    try {
      const { stdout } = await execFileAsync(YTDLP, args, {
        maxBuffer: 32 * 1024 * 1024,
        timeout: 90_000,
      });
      return JSON.parse(stdout);
    } catch (err) {
      lastError = err;
      if (attempt === IMPERSONATE_TARGETS.length - 1 || !isTransient(err)) break;
      await delay(1200 * (attempt + 1));
    }
  }
  throw lastError;
}

export function buildDownloadArgs({
  jobDir,
  url,
  selector,
  audio,
  entryIndex,
  outputBase,
  impersonate = IMPERSONATE_TARGETS[0],
}) {
  const args = [
    '--no-warnings',
    '--newline',
    '--no-mtime',
    '--socket-timeout', '20',
    '--retries', '5',
    '--extractor-retries', '5',
    '--max-filesize', `${MAX_FILE_MB}M`,
  ];
  args.push(...authArgs(url, impersonate));
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
