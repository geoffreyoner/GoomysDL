import path from 'node:path';
import { providerFor } from './providers.js';

export const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'avif']);

const ALLOWED_HOSTS = [
  /(^|\.)tiktokv?\.com$/i,
  /(^|\.)instagram\.com$/i,
  /(^|\.)instagr\.am$/i,
  /(^|\.)x\.com$/i,
  /(^|\.)twitter\.com$/i,
  /(^|\.)t\.co$/i,
  /(^|\.)youtube\.com$/i,
  /(^|\.)youtu\.be$/i,
  /(^|\.)facebook\.com$/i,
  /(^|\.)fb\.watch$/i,
  /(^|\.)fb\.com$/i,
  /(^|\.)reddit\.com$/i,
  /(^|\.)redd\.it$/i,
  /(^|\.)vimeo\.com$/i,
  /(^|\.)twitch\.tv$/i,
  /(^|\.)soundcloud\.com$/i,
  /(^|\.)dailymotion\.com$/i,
  /(^|\.)dai\.ly$/i,
];

export function parseMediaUrl(input) {
  if (typeof input !== 'string') throw new Error('URL is required.');
  const raw = input.trim();
  if (!raw) throw new Error('URL is required.');
  if (raw.length > 2048) throw new Error('URL is too long.');
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('Not a valid URL.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only http(s) URLs are supported.');
  }
  const host = url.hostname.toLowerCase();
  if (!host.includes('.') || (!ALLOWED_HOSTS.some((pattern) => pattern.test(host)) && !providerFor(url.href))) {
    throw new Error('This platform is not supported.');
  }
  return url.href;
}

export function safeName(name) {
  if (typeof name !== 'string') return null;
  const base = name.split(/[\\/]/).pop().trim();
  if (!base || base === '.' || base === '..') return null;
  if (/[\x00-\x1f\x7f]/.test(base)) return null;
  if (base.length > 200) return null;
  return base;
}

export function displayNameFor(title, fileName, used) {
  const ext = (path.extname(fileName).slice(1).toLowerCase() || 'bin').replace(/[^a-z0-9]/g, '');
  const base = String(title || 'media')
    .replace(/[\\/\x00-\x1f\x7f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 150) || 'media';
  let name = `${base}.${ext}`;
  for (let n = 2; used.has(name); n += 1) name = `${base} (${n}).${ext}`;
  used.add(name);
  return name;
}

function pickThumb(item) {
  if (item.thumbnail) return item.thumbnail;
  const thumbs = Array.isArray(item.thumbnails) ? item.thumbnails : [];
  for (let i = thumbs.length - 1; i >= 0; i -= 1) {
    if (thumbs[i] && thumbs[i].url) return thumbs[i].url;
  }
  return null;
}

function detectImage(item, formats) {
  const ext = String(item.ext || '').toLowerCase();
  if (IMAGE_EXTS.has(ext)) return true;
  const hasVideo = formats.some((f) => f.vcodec && f.vcodec !== 'none');
  if (hasVideo) return false;
  return formats.length === 0 || formats.some((f) => IMAGE_EXTS.has(String(f.ext || '').toLowerCase()));
}

function buildVideoOptions(formats) {
  const options = [
    { key: 'best', label: 'BEST / MP4', selector: 'bv*+ba/b', note: 'Highest available, merged', audio: false },
  ];
  const heights = [...new Set(
    formats
      .filter((f) => f.vcodec && f.vcodec !== 'none' && Number(f.height) > 0)
      .map((f) => Number(f.height)),
  )]
    .sort((a, b) => b - a)
    .filter((h) => h >= 240 && h <= 4320)
    .slice(0, 3);
  for (const height of heights) {
    options.push({
      key: `h${height}`,
      label: `${height}P / MP4`,
      selector: `bv*[height<=${height}]+ba/b[height<=${height}]`,
      note: 'Video + audio',
      audio: false,
    });
  }
  options.push({
    key: 'audio',
    label: 'AUDIO / M4A',
    selector: 'bestaudio/best',
    note: 'Audio track only',
    audio: true,
  });
  return options;
}

export function normalizeInfo(info) {
  if (!info || typeof info !== 'object') throw new Error('Extractor returned no metadata.');
  const rawEntries = Array.isArray(info.entries) ? info.entries : [];
  const list = rawEntries.length ? rawEntries : [info];
  const entries = [];
  for (let index = 0; index < Math.min(list.length, 50); index += 1) {
    const item = list[index];
    if (!item) continue;
    const formats = Array.isArray(item.formats) ? item.formats : [];
    const isImage = detectImage(item, formats);
    const ext = String(item.ext || '').toLowerCase();
    const gallery = Boolean(item.gallery);
    const galleryCount = Number(item.galleryCount) || 0;
    entries.push({
      index,
      id: item.id || '',
      title: item.title || item.description || `Item ${String(index + 1).padStart(2, '0')}`,
      type: isImage ? 'image' : 'video',
      duration: Number.isFinite(item.duration) ? item.duration : null,
      ext,
      gallery,
      galleryCount,
      thumbnail: pickThumb(item) || pickThumb(info) || null,
      options: isImage
        ? [{
          key: 'image',
          label: gallery ? `ALL PHOTOS${galleryCount ? ` / ${galleryCount} FILES` : ''}` : 'ORIGINAL / IMAGE',
          selector: 'b',
          note: gallery ? 'Original files, no re-encode' : 'No re-encode',
          audio: false,
        }]
        : buildVideoOptions(formats),
    });
  }
  return {
    title: info.title || info.description || info.fulltitle || 'Untitled media',
    author: info.uploader || info.channel || info.creator || info.uploader_id || 'Unknown',
    platform: info.extractor_key || info.extractor || 'Unknown',
    duration: Number.isFinite(info.duration) ? info.duration : null,
    thumbnail: pickThumb(info),
    webpageUrl: info.webpage_url || info.original_url || null,
    entries,
  };
}
