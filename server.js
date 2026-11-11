import express from 'express';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { newKey, openSealedStream, sealFile } from './lib/atrest.js';
import { displayNameFor, normalizeInfo, parseMediaUrl, safeName } from './lib/validate.js';
import {
  MAX_FILE_MB,
  YTDLP,
  buildDownloadArgs,
  getSystemInfo,
  inspect,
  parseProgress,
} from './lib/ytdlp.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const DOWNLOADS = path.join(__dirname, 'downloads');
const MAX_CONCURRENT = 2;
const MAX_JOBS = 50;
const JOB_TIMEOUT = 10 * 60 * 1000;
const INSPECT_TTL = 15 * 60 * 1000;
const FILE_TTL = 10 * 60 * 1000;
const MAX_JOB_BYTES = MAX_FILE_MB * 1024 * 1024;
const MIN_FREE_BYTES = 2 * 1024 * 1024 * 1024;

const inspects = new Map();
const jobs = new Map();
const queue = [];
const children = new Set();
let running = 0;
let systemCache = { at: 0, data: null };

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' https: data:; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'",
  );
  next();
});
app.use(express.json({ limit: '8kb' }));

const hits = new Map();
function limitPost(req, res, next) {
  if (req.method !== 'POST') return next();
  const now = Date.now();
  const recent = (hits.get(req.ip) || []).filter((t) => now - t < 60_000);
  if (recent.length >= 15) {
    return res.status(429).json({ error: 'Too many requests. Wait a minute.' });
  }
  recent.push(now);
  hits.set(req.ip, recent);
  return next();
}
app.use('/api', limitPost);

app.use(express.static(path.join(__dirname, 'public')));

function explainError(err) {
  const stderr = typeof err?.stderr === 'string' ? err.stderr : '';
  const lines = stderr.split('\n').map((l) => l.trim()).filter(Boolean);
  const errorLine = [...lines].reverse().find((l) => l.startsWith('ERROR:'));
  let message = errorLine
    ? errorLine.replace(/^ERROR:\s*/, '')
    : String(err?.message || 'Extraction failed.');
  message = message.split('\n')[0].slice(0, 300);
  if (/Unsupported URL/i.test(message)) return 'This URL is not supported by the extractor.';
  if (/Sign in|log in|login|cookies|private|rate.?limit/i.test(message)) {
    return 'This post needs login/cookies or is rate-limited. Public posts only.';
  }
  if (/timed? ?out/i.test(message)) return 'The platform took too long to respond. Try again.';
  return message;
}

app.post('/api/inspect', async (req, res) => {
  let url;
  try {
    url = parseMediaUrl(req.body?.url);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  try {
    const raw = await inspect(url);
    const info = normalizeInfo(raw);
    if (!info.entries.length) {
      return res.status(422).json({ error: 'No downloadable media found at this URL.' });
    }
    const inspectId = randomUUID();
    inspects.set(inspectId, { url, info, createdAt: Date.now() });
    return res.json({ inspectId, ...info });
  } catch (err) {
    return res.status(422).json({ error: explainError(err) });
  }
});

app.post('/api/download', (req, res) => {
  const { inspectId, entryIndex = 0, optionKey } = req.body || {};
  const cached = inspects.get(inspectId);
  if (!cached) {
    return res.status(410).json({ error: 'This analysis expired. Paste the URL again.' });
  }
  const entry = cached.info.entries[Number(entryIndex)];
  if (!entry) return res.status(400).json({ error: 'Invalid entry.' });
  if (jobs.size >= MAX_JOBS) {
    return res.status(429).json({ error: 'Too many jobs in the queue. Wait a moment.' });
  }
  const option = entry.options.find((o) => o.key === optionKey) || entry.options[0];
  const id = randomUUID();
  const job = {
    id,
    status: 'queued',
    progress: 0,
    log: [],
    files: [],
    error: null,
    title: entry.title,
    label: `${entry.title} — ${option.label}`,
    url: cached.url,
    selector: option.selector,
    audio: Boolean(option.audio),
    entryIndex: entry.index,
    dir: path.join(DOWNLOADS, id),
    key: newKey(),
    createdAt: Date.now(),
  };
  jobs.set(id, job);
  queue.push(id);
  pump();
  return res.status(202).json({ jobId: id });
});

app.get('/api/jobs/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found.' });
  return res.json({
    id: job.id,
    status: job.status,
    progress: job.progress,
    label: job.label,
    files: job.files.map(({ name, size }) => ({ name, size })),
    error: job.error,
    log: job.log.slice(-12),
  });
});

app.get('/api/file/:jobId/:name', async (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found.' });
  const name = safeName(req.params.name);
  if (!name) return res.status(400).json({ error: 'Invalid file name.' });
  const file = job.files.find((f) => f.name === name);
  if (!file) return res.status(404).json({ error: 'File not found.' });
  res.attachment(file.name);
  res.setHeader('Content-Length', String(file.size));
  try {
    await pipeline(openSealedStream(file, job.key), res);
  } catch (err) {
    if (!res.headersSent) {
      return res.status(500).json({ error: 'Could not read sealed file.' });
    }
    return res.destroy();
  }
  return undefined;
});

app.get('/api/system', async (req, res) => {
  if (Date.now() - systemCache.at > 60_000) {
    systemCache = { at: Date.now(), data: await getSystemInfo() };
  }
  const diskFree = await freeBytes();
  return res.json({
    ...systemCache.data,
    diskFree,
    running,
    queued: queue.length,
  });
});

function pump() {
  while (running < MAX_CONCURRENT && queue.length) {
    const id = queue.shift();
    const job = jobs.get(id);
    if (!job) continue;
    running += 1;
    runJob(job).finally(() => {
      running -= 1;
      pump();
    });
  }
}

function pushLine(job, line) {
  const text = String(line).replace(/\s+$/, '');
  if (!text) return;
  job.log.push(text);
  if (job.log.length > 120) job.log.shift();
  const progress = parseProgress(text);
  if (progress !== null) job.progress = progress;
}

function splitLines(onLine) {
  let buffer = '';
  return (chunk) => {
    buffer += chunk.toString();
    const parts = buffer.split(/\r?\n/);
    buffer = parts.pop();
    for (const line of parts) onLine(line);
  };
}

async function freeBytes() {
  try {
    const stat = await fs.statfs(DOWNLOADS);
    return stat.bavail * stat.bsize;
  } catch {
    return null;
  }
}

async function listFiles(dir) {
  const out = [];
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (!entry.isFile() || entry.name.startsWith('.')) continue;
    const stat = await fs.stat(path.join(dir, entry.name)).catch(() => null);
    if (!stat) continue;
    const name = safeName(entry.name);
    if (!name) continue;
    out.push({ name, size: stat.size });
  }
  return out;
}

async function runJob(job) {
  job.status = 'running';
  job.startedAt = Date.now();
  await fs.mkdir(job.dir, { recursive: true, mode: 0o700 }).catch(() => {});
  const free = await freeBytes();
  if (free !== null && free < MIN_FREE_BYTES) {
    job.status = 'error';
    job.error = 'Not enough disk space on the server.';
    return;
  }
  const args = buildDownloadArgs({
    jobDir: job.dir,
    url: job.url,
    selector: job.selector,
    audio: job.audio,
    entryIndex: job.entryIndex,
    outputBase: randomUUID(),
  });
  const child = spawn(YTDLP, args, { env: process.env });
  children.add(child);
  let settled = false;
  let timer = null;
  const finish = async (code) => {
    if (settled) return;
    settled = true;
    if (timer) clearTimeout(timer);
    children.delete(child);
    if (code === 0) {
      const plainFiles = await listFiles(job.dir);
      const totalBytes = plainFiles.reduce((sum, file) => sum + file.size, 0);
      if (plainFiles.length === 0) {
        job.status = 'error';
        job.error = 'Download finished but no file was produced.';
      } else if (totalBytes > MAX_JOB_BYTES) {
        job.status = 'error';
        job.error = `Download exceeds the ${MAX_FILE_MB} MB limit.`;
        await fs.rm(job.dir, { recursive: true, force: true }).catch(() => {});
      } else {
        pushLine(job, `[seal] encrypting ${plainFiles.length} file(s) at rest…`);
        try {
          const used = new Set();
          for (const file of plainFiles) {
            const name = displayNameFor(job.title, file.name, used);
            const sealed = await sealFile(path.join(job.dir, file.name), job.key);
            job.files.push({ name, size: file.size, ...sealed });
          }
          job.status = 'done';
          job.progress = 100;
          pushLine(job, '[seal] AES-256-GCM at rest · key held in memory');
        } catch {
          job.status = 'error';
          job.error = 'Failed to encrypt the file at rest.';
          await fs.rm(job.dir, { recursive: true, force: true }).catch(() => {});
        }
      }
    } else {
      job.status = 'error';
      const errorLine = [...job.log].reverse().find((l) => /error/i.test(l));
      job.error = (errorLine || 'Download failed.').replace(/^ERROR:\s*/, '').slice(0, 300);
    }
  };
  timer = setTimeout(() => {
    pushLine(job, '[timeout] killed after 10 minutes');
    child.kill('SIGKILL');
  }, JOB_TIMEOUT);
  child.stdout.on('data', splitLines((line) => pushLine(job, line)));
  child.stderr.on('data', splitLines((line) => pushLine(job, line)));
  child.on('error', (err) => {
    pushLine(job, err.message);
    finish(-1);
  });
  await new Promise((resolve) => {
    child.on('close', (code) => finish(code).finally(resolve));
  });
}

async function cleanup() {
  const now = Date.now();
  for (const [id, entry] of inspects) {
    if (now - entry.createdAt > INSPECT_TTL) inspects.delete(id);
  }
  for (const [id, job] of jobs) {
    if ((job.status === 'done' || job.status === 'error') && now - job.createdAt > FILE_TTL) {
      jobs.delete(id);
      await fs.rm(job.dir, { recursive: true, force: true }).catch(() => {});
    }
  }
  for (const [ip, times] of hits) {
    const recent = times.filter((t) => now - t < 60_000);
    if (recent.length) hits.set(ip, recent);
    else hits.delete(ip);
  }
}

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  console.error('[server]', err.message);
  return res.status(err.status || 500).json({ error: 'Server error.' });
});

await fs.mkdir(DOWNLOADS, { recursive: true, mode: 0o700 });
for (const entry of await fs.readdir(DOWNLOADS, { withFileTypes: true })) {
  if (entry.isDirectory()) {
    await fs.rm(path.join(DOWNLOADS, entry.name), { recursive: true, force: true }).catch(() => {});
  }
}
setInterval(cleanup, 60 * 1000).unref();

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Goomys/DL running at http://localhost:${PORT}`);
});

function shutdown() {
  for (const child of children) child.kill('SIGKILL');
  server.close(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
