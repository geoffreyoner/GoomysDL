const LABELS = {
  ok: 'OK',
  login: 'LOGIN',
  timeout: 'TIMEOUT',
  fail: 'GAGAL',
};

const note = document.getElementById('test-note');

for (const row of document.querySelectorAll('[data-provider]')) {
  const id = row.dataset.provider;
  const name = row.querySelector('.platform-name')?.textContent || id;

  const status = document.createElement('span');
  status.className = 'platform-status';
  status.dataset.state = 'idle';
  status.textContent = '';
  status.hidden = true;
  status.setAttribute('role', 'status');

  const button = document.createElement('button');
  button.className = 'platform-test';
  button.type = 'button';
  button.textContent = 'TEST';
  button.setAttribute('aria-label', `Test ${name}`);

  button.addEventListener('click', async () => {
    button.hidden = true;
    status.hidden = false;
    status.dataset.state = 'running';
    status.textContent = 'TESTING';
    status.title = '';
    try {
      const response = await fetch(`/api/platforms/${encodeURIComponent(id)}/test`, {
        method: 'POST',
      });
      const data = await response.json().catch(() => ({ error: 'Respons tidak valid.' }));
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);

      status.dataset.state = data.status;
      status.textContent = LABELS[data.status] || 'GAGAL';
      status.title = [data.error, data.title, `${data.latency} ms`].filter(Boolean).join(' · ');
      if (note) {
        note.hidden = false;
        note.textContent = `${name}: ${status.textContent} · ${data.latency} ms${data.error ? ` — ${data.error}` : data.title ? ` — ${data.title}` : ''}`;
      }
    } catch (err) {
      status.dataset.state = 'fail';
      status.textContent = 'GAGAL';
      status.title = err.message;
      if (note) {
        note.hidden = false;
        note.textContent = `${name}: GAGAL — ${err.message}`;
      }
    }
  });

  row.append(status, button);
}
