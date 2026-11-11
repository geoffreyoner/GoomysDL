const $ = (id) => document.getElementById(id);

const el = {
  form: $('analyze-form'),
  url: $('url'),
  analyzeBtn: $('analyze-btn'),
  notice: $('notice'),
  result: $('result'),
  platformTag: $('platform-tag'),
  thumbWrap: $('thumb-wrap'),
  thumb: $('thumb'),
  thumbTag: $('thumb-tag'),
  thumbType: $('thumb-type'),
  title: $('result-title'),
  metaTable: $('meta-table'),
  outputMode: $('output-mode'),
  entries: $('entries'),
  singleControls: $('single-controls'),
  formats: $('formats'),
  downloadBtn: $('download-btn'),
  downloadLabel: $('download-label'),
  jobPanel: $('job-panel'),
  jobStatus: $('job-status'),
  jobLabel: $('job-label'),
  meter: $('meter'),
  meterFill: $('meter-fill'),
  jobLog: $('job-log'),
  faq: $('faq'),
  clock: $('clock'),
  statYtdlp: $('stat-ytdlp'),
  statFfmpeg: $('stat-ffmpeg'),
  statDisk: $('stat-disk'),
  statJobs: $('stat-jobs'),
};

let inspect = null;
let selectedOption = null;
let pollTimer = null;
let currentJobId = null;
let autoSavedJob = null;
let busy = false;

function showNotice(message) {
  el.notice.textContent = message;
  el.notice.hidden = false;
}

function clearNotice() {
  el.notice.hidden = true;
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[i]}`;
}

function mediaType(entries) {
  if (entries.length > 1) return 'CAROUSEL';
  return entries[0]?.type === 'image' ? 'PHOTO' : 'VIDEO';
}

function metaCell(label, value) {
  const wrap = document.createElement('div');
  wrap.className = 'meta-cell';
  const dt = document.createElement('dt');
  dt.textContent = label;
  const dd = document.createElement('dd');
  dd.textContent = value || '—';
  wrap.append(dt, dd);
  return wrap;
}

function setThumb(targetImg, targetWrap, url) {
  targetWrap.classList.remove('no-img');
  if (!url) {
    targetImg.removeAttribute('src');
    targetWrap.classList.add('no-img');
    return;
  }
  targetImg.src = url;
  targetImg.addEventListener('error', () => targetWrap.classList.add('no-img'), { once: true });
}

function renderResult(data) {
  const entries = data.entries || [];
  const type = mediaType(entries);

  el.platformTag.textContent = String(data.platform || 'PARSED').toUpperCase();
  el.title.textContent = data.title || 'Untitled media';
  el.thumbTag.textContent = 'PREVIEW';
  el.thumbType.textContent = type;
  setThumb(el.thumb, el.thumbWrap, data.thumbnail);
  el.thumb.alt = entries.length === 1 ? data.title || 'Media preview' : 'Post preview';

  const totalDuration = data.duration
    || entries.reduce((sum, entry) => sum + (Number.isFinite(entry.duration) ? entry.duration : 0), 0);

  el.metaTable.replaceChildren(
    metaCell('SOURCE', data.platform),
    metaCell('AUTHOR', data.author),
    metaCell('DURATION', totalDuration > 0 ? formatDuration(totalDuration) : '—'),
    metaCell('ITEMS', String(entries.length).padStart(2, '0')),
    metaCell('TYPE', type),
    metaCell('HOST', (() => {
      try {
        return new URL(data.webpageUrl || window.location.href).hostname.replace(/^www\./, '');
      } catch {
        return '—';
      }
    })()),
  );

  el.outputMode.textContent = `${entries.length > 1 ? 'CAROUSEL' : 'SINGLE'} / ${type}`;
  el.entries.replaceChildren();
  el.formats.replaceChildren();
  selectedOption = null;

  if (entries.length > 1) {
    el.entries.hidden = false;
    el.singleControls.hidden = true;
    for (const entry of entries) {
      el.entries.append(buildEntry(entry));
    }
  } else {
    el.entries.hidden = true;
    el.singleControls.hidden = false;
    const entry = entries[0];
    if (entry) buildFormats(entry);
    el.downloadLabel.textContent = entry?.type === 'image' ? 'SAVE IMAGE' : 'EXTRACT MEDIA';
  }

  el.result.hidden = false;
  el.result.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function buildEntry(entry) {
  const article = document.createElement('article');
  article.className = 'entry';

  const figure = document.createElement('figure');
  const img = document.createElement('img');
  img.alt = entry.title || `Item ${entry.index + 1}`;
  img.loading = 'lazy';
  setThumb(img, figure, entry.thumbnail);
  figure.append(img);

  const index = document.createElement('span');
  index.className = 'entry-index';
  index.textContent = `#${String(entry.index + 1).padStart(2, '0')}`;
  figure.append(index);

  const foot = document.createElement('div');
  foot.className = 'entry-foot';
  const type = document.createElement('span');
  type.textContent = String(entry.type || 'media').toUpperCase();
  const button = document.createElement('button');
  button.className = 'entry-btn';
  button.type = 'button';
  button.textContent = 'SAVE ↓';
  button.addEventListener('click', () => {
    startDownload(entry.index, entry.options[0]?.key || 'best');
  });
  foot.append(type, button);

  article.append(figure, foot);
  return article;
}

function buildFormats(entry) {
  const options = entry.options || [];
  options.forEach((option, i) => {
    const row = document.createElement('label');
    row.className = 'format-row';

    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'format';
    input.value = option.key;
    if (i === 0) {
      input.checked = true;
      selectedOption = option.key;
    }

    const key = document.createElement('span');
    key.className = 'format-key';
    key.textContent = String.fromCharCode(65 + i);

    const label = document.createElement('span');
    label.className = 'format-label';
    label.textContent = option.label;

    const note = document.createElement('span');
    note.className = 'format-note';
    note.textContent = option.note || '';

    const mark = document.createElement('span');
    mark.className = 'format-mark';

    row.append(input, key, label, note, mark);
    el.formats.append(row);
  });
}

el.formats.addEventListener('change', (event) => {
  if (event.target.name === 'format') selectedOption = event.target.value;
});

function setControlsDisabled(disabled) {
  el.downloadBtn.disabled = disabled;
  el.entries.querySelectorAll('.entry-btn').forEach((button) => {
    button.disabled = disabled;
  });
}

async function analyze(url) {
  clearNotice();
  el.analyzeBtn.disabled = true;
  el.analyzeBtn.firstElementChild.textContent = 'ANALYZING';
  el.url.disabled = true;
  try {
    const response = await fetch('/api/inspect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const data = await response.json().catch(() => ({ error: 'Server returned an invalid response.' }));
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
    inspect = data;
    if (!busy) {
      el.jobPanel.hidden = true;
      currentJobId = null;
    }
    renderResult(data);
  } catch (err) {
    showNotice(err.message);
  } finally {
    el.analyzeBtn.disabled = false;
    el.analyzeBtn.firstElementChild.textContent = 'ANALYZE';
    el.url.disabled = false;
  }
}

el.form.addEventListener('submit', (event) => {
  event.preventDefault();
  const url = el.url.value.trim();
  if (url) analyze(url);
});

el.downloadBtn.addEventListener('click', () => {
  if (!inspect || busy) return;
  startDownload(0, selectedOption);
});

async function startDownload(entryIndex, optionKey) {
  if (!inspect || busy) return;
  busy = true;
  setControlsDisabled(true);
  clearNotice();
  el.jobPanel.hidden = false;
  el.jobStatus.textContent = 'QUEUED';
  el.jobLabel.textContent = inspect.entries[entryIndex]?.title || 'Preparing transfer…';
  el.meterFill.style.width = '0%';
  el.meter.setAttribute('aria-valuenow', '0');
  el.jobLog.textContent = '[queued] waiting for a worker…';
  el.jobPanel.scrollIntoView({ behavior: 'smooth', block: 'center' });

  try {
    const response = await fetch('/api/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inspectId: inspect.inspectId, entryIndex, optionKey }),
    });
    const data = await response.json().catch(() => ({ error: 'Server returned an invalid response.' }));
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
    currentJobId = data.jobId;
    pollJob(data.jobId);
  } catch (err) {
    failJob(err.message);
  }
}

function failJob(message) {
  busy = false;
  setControlsDisabled(false);
  el.jobStatus.textContent = 'FAILED';
  el.jobLog.textContent = `[error] ${message}`;
  showNotice(message);
}

function pollJob(jobId) {
  clearTimeout(pollTimer);
  const tick = async () => {
    try {
      const response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`);
      const data = await response.json().catch(() => ({ error: 'Server returned an invalid response.' }));
      if (!response.ok) throw new Error(data.error || 'Job lost.');

      renderJob(data);

      if (data.status === 'done') {
        busy = false;
        setControlsDisabled(false);
        if (currentJobId && autoSavedJob !== currentJobId) {
          autoSavedJob = currentJobId;
          autoSaveFiles(data.files || [], currentJobId);
        }
        refreshSystem();
        return;
      }
      if (data.status === 'error') {
        busy = false;
        setControlsDisabled(false);
        showNotice(data.error || 'Download failed.');
        return;
      }
      pollTimer = setTimeout(tick, 900);
    } catch (err) {
      failJob(err.message);
    }
  };
  tick();
}

function renderJob(data) {
  const status = String(data.status || 'queued').toUpperCase();
  el.jobStatus.textContent = status === 'RUNNING' ? 'TRANSFERRING' : status;
  if (data.label) el.jobLabel.textContent = data.label;

  const percent = data.status === 'done' ? 100 : (Number(data.progress) || 0);
  el.meterFill.style.width = `${percent}%`;
  el.meter.setAttribute('aria-valuenow', String(Math.round(percent)));
  el.jobLog.textContent = (data.log || []).join('\n') || '[queued] waiting for a worker…';
}

function autoSaveFiles(files, jobId) {
  if (!files.length) return;
  el.jobStatus.textContent = 'SAVING';
  el.jobLog.textContent += '\n[auto] handing file to browser…\n[auto] refreshing in 8s for a fresh session';
  files.forEach((file, index) => {
    setTimeout(() => {
      const link = document.createElement('a');
      link.href = `/api/file/${encodeURIComponent(jobId)}/${encodeURIComponent(file.name)}`;
      link.download = file.name;
      link.style.display = 'none';
      document.body.append(link);
      link.click();
      link.remove();
    }, 400 + index * 500);
  });
  setTimeout(() => window.location.reload(), 8000);
}

async function refreshSystem() {
  try {
    const response = await fetch('/api/system');
    if (!response.ok) return;
    const data = await response.json();
    el.statYtdlp.textContent = data.ytdlp ? `YT-DLP ${data.ytdlp}` : 'YT-DLP MISSING';
    el.statFfmpeg.textContent = data.ffmpeg || 'MISSING';
    el.statDisk.textContent = formatBytes(data.diskFree);
    el.statJobs.textContent = `RUN ${data.running ?? 0} · WAIT ${data.queued ?? 0}`;
  } catch {
    /* status strip is best effort */
  }
}

function tickClock() {
  el.clock.textContent = new Date().toLocaleTimeString('en-GB', { hour12: false });
}

let faqVisible = false;
let faqTicking = false;

function updateFaq() {
  faqTicking = false;
  const show = window.scrollY > 200;
  if (show === faqVisible) return;
  faqVisible = show;
  el.faq.classList.toggle('is-visible', show);
}

function onScroll() {
  if (faqTicking) return;
  faqTicking = true;
  requestAnimationFrame(updateFaq);
}

tickClock();
setInterval(tickClock, 1000);
updateFaq();
window.addEventListener('scroll', onScroll, { passive: true });
refreshSystem();
setInterval(refreshSystem, 60_000);
