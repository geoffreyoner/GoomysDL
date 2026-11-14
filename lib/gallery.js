import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { IMAGE_EXTS } from './validate.js';
import { COOKIES } from './ytdlp.js';

const execFileAsync = promisify(execFile);

export const GALLERYDL = process.env.GALLERYDL_PATH || 'gallery-dl';

const INSTAGRAM = /(^|\.)(instagram\.com|instagr\.am)$/i;
const TIKTOK = /(^|\.)tiktok(v)?\.com$/i;
const IMAGE_FILTER = "extension in ('jpg','jpeg','png','webp','gif','heic','avif')";

let available;

function cookiesFor(url) {
  try {
    return COOKIES && INSTAGRAM.test(new URL(url).hostname) ? COOKIES : null;
  } catch {
    return null;
  }
}

export function isGalleryPhotoUrl(url) {
  try {
    const { hostname, pathname } = new URL(url);
    if (TIKTOK.test(hostname)) return /\/photo\//i.test(pathname);
    if (INSTAGRAM.test(hostname)) return /^\/p\//i.test(pathname);
    return false;
  } catch {
    return false;
  }
}

export async function galleryAvailable() {
  if (available === undefined) {
    try {
      await execFileAsync(GALLERYDL, ['--version'], { timeout: 10_000 });
      available = true;
    } catch {
      available = false;
    }
  }
  return available;
}

function parseOutput(stdout) {
  try {
    const value = JSON.parse(stdout);
    return Array.isArray(value) ? value : [value];
  } catch {
    const items = [];
    for (const line of String(stdout).split('\n')) {
      const text = line.trim();
      if (!text) continue;
      try {
        const value = JSON.parse(text);
        items.push(...(Array.isArray(value) ? value : [value]));
      } catch {
      }
    }
    return items;
  }
}

export async function galleryInspect(url, { timeoutMs = 90_000 } = {}) {
  const args = ['-j', '--no-download', '--retries', '3'];
  const cookies = cookiesFor(url);
  if (cookies) args.push('--cookies', cookies);
  args.push(url);

  const { stdout, stderr } = await execFileAsync(GALLERYDL, args, {
    maxBuffer: 32 * 1024 * 1024,
    timeout: timeoutMs,
  });
  const items = parseOutput(stdout);
  const failure = items.find((item) => Array.isArray(item) && item[0] === -1);
  if (failure) throw new Error(failure[1]?.message || 'Photo extraction failed.');

  const meta = items.find((item) => Array.isArray(item) && item[0] === 2)?.[1] || {};
  const images = items
    .filter((item) => Array.isArray(item) && item[0] === 3 && typeof item[1] === 'string')
    .filter((item) => IMAGE_EXTS.has(String(item[2]?.extension || '').toLowerCase()));
  if (!images.length) {
    const errorLine = String(stderr).split('\n').filter((l) => /\[error\]/i.test(l)).at(-1);
    throw new Error(errorLine
      ? errorLine.replace(/^.*\[error\]\s*/, '').slice(0, 300)
      : 'No photos found at this URL.');
  }

  const first = images[0][2] || {};
  const title = first.desc || first.caption || first.description || first.title
    || meta.desc || meta.caption || meta.description || meta.title || 'Photos';
  const author = meta.author?.uniqueId || meta.author?.nickname || meta.username || 'Unknown';
  const id = String(meta.id || first.id || '');
  const platform = INSTAGRAM.test(new URL(url).hostname) ? 'Instagram' : 'TikTok';

  return {
    id,
    title,
    uploader: author,
    extractor_key: platform,
    thumbnail: images[0][1],
    webpage_url: url,
    entries: [{
      id,
      title,
      ext: String(first.extension || 'jpg').toLowerCase(),
      thumbnail: images[0][1],
      gallery: true,
      galleryCount: images.length,
    }],
  };
}

export function buildGalleryArgs({ jobDir, url, outputBase }) {
  const args = [
    '-D', jobDir,
    '-f', `${outputBase}_{num}.{extension}`,
    '--filter', IMAGE_FILTER,
    '--retries', '3',
  ];
  const cookies = cookiesFor(url);
  if (cookies) args.push('--cookies', cookies);
  args.push(url);
  return args;
}
