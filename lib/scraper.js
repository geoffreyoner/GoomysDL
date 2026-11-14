import path from 'node:path';
import { createRequire } from 'node:module';
import { IMAGE_EXTS } from './validate.js';
import { providerFor } from './providers.js';

const require = createRequire(import.meta.url);
const scrapr = require('@coflyn/scrapr');

const MAX_SOURCES = 100;
const DEFAULT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const HLS_TYPE = /m3u8|hls/i;

const METHODS = {
  spotify: [scrapr.spotify.spotidown, scrapr.spotify.spotmate, scrapr.spotify.soundloaders],
  terabox: [scrapr.terabox.sechno],
  threads: [scrapr.threads.threadster],
  pixiv: [scrapr.pixiv.ajax],
  douyin: [scrapr.douyin.direct],
  mediafire: [scrapr.resolver.mediafire],
  pixeldrain: [scrapr.resolver.pixeldrain],
  catbox: [scrapr.resolver.catbox],
  sfile: [scrapr.resolver.sfile],
  gdrive: [scrapr.resolver.gdrive],
  krakenfiles: [scrapr.resolver.krakenfiles],
  doodstream: [scrapr.resolver.doodstream],
  komiku: [scrapr.comic.komiku],
  komikindo: [scrapr.comic.komikindo],
  asurascans: [scrapr.comic.asurascans],
  mangadex: [scrapr.comic.mangadex],
  nimegami: [scrapr.anime.nimegami],
};

const COMIC_IDS = new Set(['komiku', 'komikindo', 'asurascans', 'mangadex']);

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('The platform took too long to respond.')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function isTransient(message) {
  return /timeout|timed out|ECONNRESET|ETIMEDOUT|socket hang up|429|50[234]/i.test(String(message || ''));
}

async function callOne(method, url, timeoutMs) {
  const deadline = timeoutMs ? Date.now() + timeoutMs : null;
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const remaining = deadline ? deadline - Date.now() : 75_000;
    if (remaining <= 0) break;
    try {
      const response = await withTimeout(Promise.resolve().then(() => method(url)), remaining);
      if (!response || response.status !== true) {
        throw new Error(response?.message || 'Extraction failed.');
      }
      return response.result;
    } catch (err) {
      lastError = err;
      if (attempt === 1 || !isTransient(err.message)) break;
      await delay(deadline
        ? Math.min(600, Math.max(0, deadline - Date.now()))
        : 600);
    }
  }
  throw lastError || new Error('Extraction timed out.');
}

async function runProvider(provider, url, timeoutMs) {
  const methods = METHODS[provider.id] || [];
  const deadline = timeoutMs ? Date.now() + timeoutMs : null;
  let lastError;
  for (const method of methods) {
    const remaining = deadline ? deadline - Date.now() : 75_000;
    if (remaining <= 0) break;
    try {
      return await callOne(method, url, deadline ? remaining : undefined);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error('Extraction failed.');
}

function cleanText(value, max = 200) {
  return String(value || '')
    .replace(/[\x00-\x1f\x7f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function authorName(result) {
  const author = result?.author;
  if (typeof author === 'string') return cleanText(author);
  if (author && typeof author === 'object') {
    return cleanText(author.name || author.username || author.id || '');
  }
  return cleanText(result?.artist || result?.channel || result?.uploader || '');
}

function extFromUrl(rawUrl) {
  try {
    const name = path.basename(new URL(rawUrl).pathname);
    const ext = path.extname(name).slice(1).toLowerCase();
    return /^[a-z0-9]{1,8}$/.test(ext) ? ext : '';
  } catch {
    return '';
  }
}

function normalizeType(download, provider) {
  const type = String(download?.type || '').toLowerCase();
  const url = String(download?.url || '');
  const ext = extFromUrl(url);
  const hls = HLS_TYPE.test(type) || HLS_TYPE.test(download?.quality || '') || /\.m3u8(?:$|\?)/i.test(url);
  if (hls) return 'video';
  if (IMAGE_EXTS.has(type) || ['image', 'photo', 'picture', 'cover'].includes(type) || IMAGE_EXTS.has(ext)) {
    return 'image';
  }
  if (['audio', 'mp3', 'music', 'track', 'sound'].includes(type) || /\.(mp3|m4a|aac|flac|ogg|opus|wav)(?:$|\?)/i.test(url)) {
    return 'audio';
  }
  if (['video', 'mp4', 'webm', 'movie', 'stream'].includes(type) || /\.(mp4|webm|mkv|mov)(?:$|\?)/i.test(url)) {
    return 'video';
  }
  return COMIC_IDS.has(provider.id) ? 'image' : 'file';
}

function sanitizeHeaders(headers, provider, inputUrl) {
  const out = {
    'User-Agent': DEFAULT_UA,
    Accept: '*/*',
  };
  if (provider.referer) out.Referer = COMIC_IDS.has(provider.id) ? inputUrl : provider.referer;
  if (headers && typeof headers === 'object') {
    for (const [key, value] of Object.entries(headers)) {
      const lower = key.toLowerCase();
      if (!['user-agent', 'referer', 'origin', 'accept', 'accept-language'].includes(lower)) continue;
      if (value !== undefined && value !== null && String(value).length < 1000) {
        out[key] = String(value);
      }
    }
  }
  return out;
}

function sourceFromDownload(download, provider, inputUrl, index) {
  if (!download || typeof download.url !== 'string' || !/^https?:\/\//i.test(download.url)) return null;
  if (/^(magnet|torrent):/i.test(download.url)) return null;
  if (provider.id === 'spotify' && /cover/i.test(download.quality || '')) return null;
  const type = normalizeType(download, provider);
  const directLink = /\.(mp4|webm|mkv|m3u8)(?:$|\?)/i.test(download.url)
    || /direct (hls|mp4|stream)/i.test(download.quality || '');
  if (String(download.type || '').toLowerCase() === 'link' && !directLink) return null;
  const filename = cleanText(download.filename || download.title || '', 180);
  const hls = HLS_TYPE.test(download.type || '') || HLS_TYPE.test(download.quality || '') || /\.m3u8(?:$|\?)/i.test(download.url);
  return {
    url: download.url,
    type,
    filename: filename || null,
    ext: hls ? 'mp4' : (extFromUrl(download.url) || { image: 'jpg', audio: 'mp3', video: 'mp4', file: 'bin' }[type]),
    quality: cleanText(download.quality || '', 80) || null,
    hls,
    size: download.size || null,
    headers: sanitizeHeaders(download.headers, provider, inputUrl),
    order: index,
  };
}

function dedupeByUrl(sources) {
  const seen = new Set();
  return sources.filter((source) => {
    if (seen.has(source.url)) return false;
    seen.add(source.url);
    return true;
  });
}

function teraboxSources(sources) {
  const groups = new Map();
  for (const source of sources) {
    const key = (source.filename || source.url).toLowerCase();
    const list = groups.get(key) || [];
    list.push(source);
    groups.set(key, list);
  }
  return [...groups.values()].map((group) => (
    group.find((source) => !source.hls) || group[0]
  ));
}

function dedupeByName(sources) {
  const groups = new Map();
  for (const source of sources) {
    const key = source.filename ? source.filename.toLowerCase() : null;
    if (!key) return sources;
    const list = groups.get(key) || [];
    list.push(source);
    groups.set(key, list);
  }
  return [...groups.values()].map((group) => (
    group.find((source) => !source.hls) || group[0]
  ));
}

function collectionType(sources) {
  if (sources.every((source) => source.type === 'image')) return 'image';
  if (sources.every((source) => source.type === 'audio')) return 'audio';
  if (sources.every((source) => source.type === 'file')) return 'file';
  if (sources.every((source) => source.type === 'video')) return 'video';
  return 'file';
}

function labelForCollection(type, count) {
  const files = `${count} FILE${count === 1 ? '' : 'S'}`;
  if (type === 'image') return `ALL PHOTOS / ${files}`;
  if (type === 'audio') return `ALL AUDIO / ${files}`;
  if (type === 'video') return `ALL VIDEOS / ${files}`;
  return `ALL FILES / ${files}`;
}

function labelForSingle(source) {
  if (source.type === 'image') return 'ORIGINAL / IMAGE';
  if (source.type === 'audio') return 'AUDIO / MP3';
  if (source.type === 'video') return source.hls ? 'VIDEO / HLS' : 'VIDEO / MP4';
  return 'DOWNLOAD / FILE';
}

function labelForOption(source, index) {
  return source.quality || `${source.type.toUpperCase()} ${index + 1}`;
}

export function normalizeScraperResult(provider, inputUrl, result) {
  if (!result || typeof result !== 'object') throw new Error('Extractor returned no metadata.');
  if (provider.id === 'spotify' && (result.type === 'playlist' || Number(result.trackCount) > 1 || result.tracks?.length > 1)) {
    throw new Error('Spotify album atau playlist belum didukung. Tempel URL satu track.');
  }

  let downloads = Array.isArray(result.downloads) ? result.downloads : [];
  if (!downloads.length && result.url) {
    downloads = [{ url: result.url, type: result.type, filename: result.filename, size: result.size }];
  }
  if (provider.id === 'gdrive') downloads = downloads.slice(0, 1);

  let sources = downloads
    .map((download, index) => sourceFromDownload(download, provider, inputUrl, index))
    .filter(Boolean);
  sources = dedupeByUrl(sources);
  if (provider.id === 'terabox') sources = teraboxSources(sources);
  else if (sources.some((source) => source.filename)) sources = dedupeByName(sources);
  if (!sources.length) throw new Error('No downloadable media found at this URL.');
  sources = sources.slice(0, MAX_SOURCES);

  const imageCollection = sources.length > 1 && sources.every((source) => source.type === 'image');
  const fileCollection = sources.length > 1
    && sources.some((source) => source.type === 'file')
    && new Set(sources.map((source) => source.filename || source.url)).size > 1;
  const options = provider.mode === 'options'
    || (provider.mode === 'auto' && sources.length > 1 && sources.every((source) => ['video', 'audio'].includes(source.type)) && !imageCollection);
  const collection = provider.mode === 'collection'
    || (provider.mode === 'auto' && (imageCollection || fileCollection));

  const mode = collection ? 'collection' : (options ? 'options' : 'single');
  const selected = mode === 'single' ? [sources[0]] : sources;
  const type = mode === 'collection'
    ? collectionType(selected)
    : selected.every((source) => source.type === 'image')
      ? 'image'
      : selected[0].type;

  const title = cleanText(result.title || result.name || result.filename || provider.name);
  const author = authorName(result);
  const thumbnail = result.thumbnail
    || selected.find((source) => source.type === 'image')?.url
    || null;

  const planOptions = {};
  let publicOptions;
  if (mode === 'collection') {
    planOptions.all = selected;
    publicOptions = [{
      key: 'all',
      label: labelForCollection(type, selected.length),
      note: 'ZIP archive, original files',
      audio: false,
    }];
  } else if (mode === 'options') {
    publicOptions = selected.map((source, index) => {
      planOptions[`q${index + 1}`] = [source];
      return {
        key: `q${index + 1}`,
        label: labelForOption(source, index),
        note: source.filename || (source.hls ? 'HLS stream' : 'Direct file'),
        audio: source.type === 'audio',
      };
    });
  } else {
    planOptions.main = selected;
    publicOptions = [{
      key: 'main',
      label: labelForSingle(selected[0]),
      note: selected[0].filename || 'Original file, no re-encode',
      audio: selected[0].type === 'audio',
    }];
  }

  for (const source of selected) {
    source.label = source.filename
      ? path.basename(source.filename, path.extname(source.filename))
      : title;
  }
  if (mode === 'collection' && selected.length > 1) {
    selected.forEach((source, index) => {
      if (!source.filename) source.label = `${title} - ${String(index + 1).padStart(2, '0')}`;
    });
  }

  const info = {
    title,
    author,
    platform: provider.name,
    duration: Number.isFinite(result.duration) ? result.duration : null,
    thumbnail,
    webpageUrl: inputUrl,
    entries: [{
      index: 0,
      id: cleanText(result.id || '', 120),
      title,
      type,
      duration: Number.isFinite(result.duration) ? result.duration : null,
      ext: selected[0].ext || 'bin',
      gallery: mode === 'collection',
      galleryCount: mode === 'collection' ? selected.length : 0,
      thumbnail,
      options: publicOptions,
    }],
  };

  return {
    info,
    plan: {
      provider: provider.id,
      mode,
      entries: [{ index: 0, options: planOptions }],
    },
  };
}

export async function scraperInspect(inputUrl, { timeoutMs } = {}) {
  const provider = providerFor(inputUrl);
  if (!provider) throw new Error('This platform is not supported.');
  if (provider.id === 'nimegami' && !new URL(inputUrl).pathname.includes('/download/')) {
    throw new Error('Nimegami: paste an episode download link, not the series page.');
  }
  const result = await runProvider(provider, inputUrl, timeoutMs);
  return normalizeScraperResult(provider, inputUrl, result);
}
