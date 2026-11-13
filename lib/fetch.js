import fs from 'node:fs';
import fsp from 'node:fs/promises';
import dns from 'node:dns/promises';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { FFMPEG } from './ytdlp.js';

const MAX_REDIRECTS = 5;
const DEFAULT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

function privateIpv4(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b, c] = parts;
  return a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 0 && (c === 0 || c === 2))
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19))
    || (a === 198 && b === 51 && c === 100)
    || (a === 203 && b === 0 && c === 113)
    || a >= 224;
}

function privateAddress(address) {
  const ip = String(address || '').toLowerCase();
  if (net.isIP(ip) === 4) return privateIpv4(ip);
  if (net.isIP(ip) !== 6) return true;
  if (ip === '::' || ip === '::1') return true;
  if (ip.startsWith('::ffff:')) return privateIpv4(ip.slice(7));
  if (ip.startsWith('fc') || ip.startsWith('fd')) return true;
  if (/^fe[89ab]/.test(ip)) return true;
  if (ip.startsWith('ff')) return true;
  if (ip.startsWith('2001:db8')) return true;
  return false;
}

export async function assertPublicUrl(input) {
  let url;
  try {
    url = input instanceof URL ? input : new URL(String(input));
  } catch {
    throw new Error('Invalid media URL from the scraper.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only http(s) media URLs are supported.');
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new Error('The scraper returned a blocked media host.');
  }
  if (net.isIP(host)) {
    if (privateAddress(host)) throw new Error('The scraper returned a private media host.');
    return url;
  }
  let records;
  try {
    records = await dns.lookup(host, { all: true, verbatim: true });
  } catch {
    throw new Error('Could not resolve the media host.');
  }
  if (!records.length || records.some((record) => privateAddress(record.address))) {
    throw new Error('The scraper returned a blocked media host.');
  }
  return url;
}

function signalFor(signal, timeoutMs) {
  const timeout = timeoutMs ? AbortSignal.timeout(timeoutMs) : null;
  if (signal && timeout) return AbortSignal.any([signal, timeout]);
  return signal || timeout || undefined;
}

function headerObject(headers) {
  const out = { 'User-Agent': DEFAULT_UA, Accept: '*/*' };
  if (headers && typeof headers === 'object') {
    for (const [key, value] of Object.entries(headers)) {
      if (value !== undefined && value !== null) out[key] = String(value);
    }
  }
  return out;
}

function filenameFromDisposition(header) {
  if (!header) return null;
  const star = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (star) {
    try {
      return decodeURIComponent(star[1].replace(/["']/g, ''));
    } catch {
      return null;
    }
  }
  const plain = header.match(/filename="?([^";]+)"?/i);
  return plain ? plain[1].trim() : null;
}

async function openResponse(rawUrl, headers, signal) {
  let current = new URL(rawUrl);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    current = await assertPublicUrl(current);
    const response = await fetch(current, {
      method: 'GET',
      redirect: 'manual',
      headers: headerObject(headers),
      signal,
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      await response.body?.cancel().catch(() => {});
      if (!location) throw new Error('The media host returned an empty redirect.');
      current = new URL(location, current);
      continue;
    }
    return { response, url: current };
  }
  throw new Error('The media host redirected too many times.');
}

export async function fetchToFile(rawUrl, dest, options = {}) {
  const { headers, maxBytes, signal, timeoutMs, onProgress } = options;
  const limit = Number(maxBytes) || 0;
  const requestSignal = signalFor(signal, timeoutMs);
  let opened;
  try {
    opened = await openResponse(rawUrl, headers, requestSignal);
    const { response, url } = opened;
    if (!response.ok) throw new Error(`The media host responded ${response.status}.`);
    const length = Number(response.headers.get('content-length') || 0);
    if (limit && length > limit) throw new Error('This file exceeds the download size limit.');
    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    if (/text\/html|application\/xhtml\+xml/i.test(contentType)) {
      throw new Error('The media host returned a web page instead of a file.');
    }
    if (!response.body) throw new Error('The media host returned an empty response.');

    let received = 0;
    const limiter = new Transform({
      transform(chunk, encoding, callback) {
        received += chunk.length;
        if (limit && received > limit) {
          callback(new Error('This file exceeds the download size limit.'));
          return;
        }
        if (onProgress) onProgress(received, length || null);
        callback(null, chunk);
      },
    });
    await pipeline(
      Readable.fromWeb(response.body),
      limiter,
      fs.createWriteStream(dest, { mode: 0o600 }),
    );
    return {
      bytes: received,
      contentType,
      filename: filenameFromDisposition(response.headers.get('content-disposition')),
      url: url.href,
    };
  } catch (err) {
    await fsp.rm(dest, { force: true }).catch(() => {});
    throw err;
  }
}

function headerString(headers) {
  return Object.entries(headerObject(headers))
    .filter(([key]) => !/^(host|content-length)$/i.test(key))
    .map(([key, value]) => `${key}: ${value}\r\n`)
    .join('');
}

export async function downloadHls(rawUrl, dest, options = {}) {
  const { headers, maxBytes, signal, timeoutMs, onProgress, onChild } = options;
  const url = await assertPublicUrl(rawUrl);
  const limit = Number(maxBytes) || 0;
  const args = [
    '-y',
    '-hide_banner',
    '-loglevel', 'error',
    '-headers', headerString(headers),
    '-i', url.href,
    '-c', 'copy',
    '-movflags', '+faststart',
    dest,
  ];

  await new Promise((resolve, reject) => {
    const child = spawn(FFMPEG, args, { env: process.env });
    if (onChild) onChild(child);
    let stderr = '';
    let settled = false;
    let timer;
    let sizeTimer;
    const finish = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(sizeTimer);
      if (signal) signal.removeEventListener('abort', onAbort);
      if (onChild) onChild(null, child);
      if (err) reject(err);
      else resolve();
    };
    const onAbort = () => {
      child.kill('SIGKILL');
      finish(new Error('Download aborted.'));
    };
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }
    if (timeoutMs) {
      timer = setTimeout(() => {
        child.kill('SIGKILL');
        finish(new Error('The media host took too long to respond.'));
      }, Math.max(1000, timeoutMs));
    }
    if (limit || onProgress) {
      sizeTimer = setInterval(async () => {
        const stat = await fsp.stat(dest).catch(() => null);
        if (!stat) return;
        if (onProgress) onProgress(stat.size, null);
        if (limit && stat.size > limit) {
          child.kill('SIGKILL');
          finish(new Error('This file exceeds the download size limit.'));
        }
      }, 1000);
    }
    child.stderr.on('data', (chunk) => {
      stderr = `${stderr}${chunk.toString()}`.slice(-8000);
    });
    child.on('error', (err) => finish(err));
    child.on('close', (code) => {
      if (settled) return;
      if (code === 0) {
        finish(null);
      } else {
        const line = stderr.split('\n').map((item) => item.trim()).filter(Boolean).at(-1);
        finish(new Error(line ? line.slice(0, 300) : 'HLS download failed.'));
      }
    });
  }).catch(async (err) => {
    await fsp.rm(dest, { force: true }).catch(() => {});
    throw err;
  });

  const stat = await fsp.stat(dest).catch(() => null);
  if (!stat || stat.size === 0) {
    await fsp.rm(dest, { force: true }).catch(() => {});
    throw new Error('The media host returned an empty file.');
  }
  if (limit && stat.size > limit) {
    await fsp.rm(dest, { force: true }).catch(() => {});
    throw new Error('This file exceeds the download size limit.');
  }
  return { bytes: stat.size, contentType: '', filename: null, url: url.href };
}

export function extensionFromContentType(contentType) {
  const type = String(contentType || '').toLowerCase().split(';')[0].trim();
  const map = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/avif': 'avif',
    'image/heic': 'heic',
    'audio/mpeg': 'mp3',
    'audio/mp4': 'm4a',
    'audio/aac': 'aac',
    'audio/ogg': 'ogg',
    'audio/flac': 'flac',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'video/quicktime': 'mov',
    'application/pdf': 'pdf',
    'application/zip': 'zip',
  };
  return map[type] || '';
}

