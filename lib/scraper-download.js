import path from 'node:path';
import fsp from 'node:fs/promises';
import {
  downloadHls,
  extensionFromContentType,
  fetchToFile,
} from './fetch.js';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransient(message) {
  return /timeout|timed out|ECONNRESET|ETIMEDOUT|socket hang up|429|50[234]/i.test(String(message || ''));
}

function validExt(ext) {
  return /^[a-z0-9]{1,8}$/i.test(String(ext || ''));
}

function sourceExt(source) {
  if (source.hls) return 'mp4';
  if (validExt(source.ext)) return String(source.ext).toLowerCase();
  return { image: 'jpg', audio: 'mp3', video: 'mp4', file: 'bin' }[source.type] || 'bin';
}

function labelFor(source, fallback, index, count) {
  const base = path.basename(String(source.label || source.filename || fallback), path.extname(String(source.label || source.filename || fallback)));
  if (base && base !== '.') return base;
  return count > 1 ? `${fallback} - ${String(index + 1).padStart(2, '0')}` : fallback;
}

async function downloadOne(source, dest, options) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      if (source.hls) return await downloadHls(source.url, dest, options);
      return await fetchToFile(source.url, dest, options);
    } catch (err) {
      if (attempt === 1 || !isTransient(err.message)) throw err;
      await sleep(700);
    }
  }
  throw new Error('Download failed.');
}

export async function downloadScraperSources(job, {
  maxBytes,
  deadline,
  pushLine,
  onChild,
  onProgress,
}) {
  if (!Array.isArray(job.sources) || !job.sources.length) {
    throw new Error('No download sources were prepared.');
  }
  await fsp.mkdir(job.dir, { recursive: true, mode: 0o700 });
  job.fileLabels = job.fileLabels || {};
  let completed = 0;

  for (let index = 0; index < job.sources.length; index += 1) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error('Download timed out after 10 minutes.');
    const source = job.sources[index];
    const ext = sourceExt(source);
    let stored = `${job.outputBase}_${String(index + 1).padStart(2, '0')}.${ext}`;
    let dest = path.join(job.dir, stored);
    const label = labelFor(source, job.title, index, job.sources.length);
    const budget = maxBytes - completed;
    if (budget <= 0) throw new Error(`Download exceeds the ${Math.round(maxBytes / 1024 / 1024)} MB limit.`);

    pushLine(job, `[fetch] ${String(source.type || 'file').toUpperCase()} ${index + 1}/${job.sources.length}`);
    const result = await downloadOne(source, dest, {
      headers: source.headers,
      maxBytes: budget,
      timeoutMs: Math.max(1000, remaining),
      onChild,
      onProgress: (received, total) => {
        const span = 100 / job.sources.length;
        const within = total ? Math.min(0.99, received / total) : 0.5;
        const progress = index * span + within * span;
        job.progress = Math.max(job.progress, Math.min(99, Math.round(progress)));
        if (onProgress) onProgress(received, total);
      },
    });

    if (!source.hls && (!validExt(path.extname(stored).slice(1)) || path.extname(stored).toLowerCase() === '.bin')) {
      const better = extensionFromContentType(result.contentType)
        || path.extname(result.filename || '').slice(1).toLowerCase();
      if (validExt(better) && better.toLowerCase() !== 'bin') {
        const renamed = `${job.outputBase}_${String(index + 1).padStart(2, '0')}.${better.toLowerCase()}`;
        await fsp.rename(dest, path.join(job.dir, renamed));
        stored = renamed;
        dest = path.join(job.dir, renamed);
      }
    }

    const stat = await fsp.stat(dest);
    if (!stat.size) throw new Error('The media host returned an empty file.');
    completed += stat.size;
    job.fileLabels[stored] = label;
    job.progress = Math.min(99, Math.round(((index + 1) / job.sources.length) * 100));
  }

  return { bytes: completed, files: Object.keys(job.fileLabels) };
}
