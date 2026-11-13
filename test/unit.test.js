import test from 'node:test';
import assert from 'node:assert/strict';
import { displayNameFor, normalizeInfo, parseMediaUrl, safeName } from '../lib/validate.js';
import { MAX_FILE_MB, buildDownloadArgs, isTiktokUrl, isTransient, parseProgress } from '../lib/ytdlp.js';
import { buildGalleryArgs, isGalleryPhotoUrl } from '../lib/gallery.js';

test('parseMediaUrl accepts http(s) and normalizes', () => {
  assert.equal(parseMediaUrl(' https://youtube.com/a '), 'https://youtube.com/a');
  assert.equal(parseMediaUrl('http://youtube.com'), 'http://youtube.com/');
});

test('parseMediaUrl rejects unsupported and private hosts', () => {
  for (const url of [
    'http://localhost/x',
    'http://127.0.0.1/x',
    'http://169.254.169.254/latest/meta-data/',
    'http://192.168.1.1/',
    'http://[::1]/',
    'http://evil.com/?u=https://youtube.com',
    'http://youtube.com.evil.com/watch',
    'http://example.com/a',
  ]) {
    assert.throws(() => parseMediaUrl(url), /not supported/i);
  }
  assert.equal(parseMediaUrl('https://vm.tiktok.com/abc/'), 'https://vm.tiktok.com/abc/');
  assert.equal(parseMediaUrl('https://youtu.be/x'), 'https://youtu.be/x');
  assert.equal(parseMediaUrl('https://www.reddit.com/r/a'), 'https://www.reddit.com/r/a');
  assert.equal(parseMediaUrl('https://open.spotify.com/track/x'), 'https://open.spotify.com/track/x');
  assert.equal(parseMediaUrl('https://www.terabox.com/s/x'), 'https://www.terabox.com/s/x');
});

test('parseMediaUrl rejects bad input', () => {
  assert.throws(() => parseMediaUrl(''), /required/i);
  assert.throws(() => parseMediaUrl('not a url'), /valid URL/i);
  assert.throws(() => parseMediaUrl('ftp://example.com'), /http/i);
  assert.throws(() => parseMediaUrl('javascript:alert(1)'), /http/i);
  assert.throws(() => parseMediaUrl('https://a.com/' + 'x'.repeat(3000)), /too long/i);
  assert.throws(() => parseMediaUrl(null), /required/i);
});

test('safeName strips path segments and rejects traversal-only names', () => {
  assert.equal(safeName('video [abc].mp4'), 'video [abc].mp4');
  assert.equal(safeName('../../etc/passwd'), 'passwd');
  assert.equal(safeName('..'), null);
  assert.equal(safeName('.'), null);
  assert.equal(safeName(''), null);
  assert.equal(safeName('a\0b'), null);
  assert.equal(safeName('x'.repeat(201)), null);
});

test('displayNameFor keeps titles in memory-safe form', () => {
  const used = new Set();
  assert.equal(displayNameFor('Clip/Title', 'x.mp4', used), 'Clip Title.mp4');
  assert.equal(displayNameFor('Clip/Title', 'y.mp4', used), 'Clip Title (2).mp4');
  assert.equal(displayNameFor('', 'z.m4a', used), 'media.m4a');
  assert.equal(displayNameFor('a'.repeat(300), 'q.webm', used).length, 155);
});

test('normalizeInfo builds video options from available heights', () => {
  const info = normalizeInfo({
    id: 'abc',
    title: 'A clip',
    uploader: 'someone',
    extractor_key: 'TikTok',
    duration: 61,
    thumbnail: 'https://img/thumb.jpg',
    ext: 'mp4',
    webpage_url: 'https://example.com/v/abc',
    formats: [
      { vcodec: 'h264', acodec: 'none', height: 1080, ext: 'mp4' },
      { vcodec: 'h264', acodec: 'none', height: 720, ext: 'mp4' },
      { vcodec: 'none', acodec: 'aac', ext: 'm4a' },
    ],
  });
  assert.equal(info.platform, 'TikTok');
  assert.equal(info.author, 'someone');
  assert.equal(info.entries.length, 1);
  assert.equal(info.entries[0].type, 'video');
  assert.deepEqual(
    info.entries[0].options.map((o) => o.key),
    ['best', 'h1080', 'h720', 'audio'],
  );
  assert.equal(info.entries[0].options.at(-1).audio, true);
});

test('normalizeInfo detects photo carousels', () => {
  const info = normalizeInfo({
    id: 'post',
    title: 'Carousel',
    extractor_key: 'Instagram',
    entries: [
      { id: '1', ext: 'jpg', title: 'One' },
      { id: '2', ext: 'jpg', thumbnail: 'https://img/2.jpg' },
    ],
  });
  assert.equal(info.entries.length, 2);
  assert.equal(info.entries[0].type, 'image');
  assert.equal(info.entries[0].options[0].key, 'image');
  assert.equal(info.entries[1].thumbnail, 'https://img/2.jpg');
  assert.equal(info.entries[1].title, 'Item 02');
});

test('normalizeInfo keeps playlist positions and gallery photos', () => {
  const info = normalizeInfo({
    extractor_key: 'Instagram',
    title: 'Post',
    entries: [
      null,
      { id: '2', ext: 'jpeg', title: 'Trip', gallery: true, galleryCount: 3 },
      null,
      { id: '4', ext: 'mp4', formats: [{ vcodec: 'h264', height: 720, ext: 'mp4' }] },
    ],
  });
  assert.equal(info.entries.length, 2);
  assert.equal(info.entries[0].index, 1);
  assert.equal(info.entries[0].gallery, true);
  assert.equal(info.entries[0].options[0].label, 'ALL PHOTOS / 3 FILES');
  assert.equal(info.entries[1].index, 3);
});

test('normalizeInfo rejects empty metadata', () => {
  assert.throws(() => normalizeInfo(null), /no metadata/i);
});

test('buildDownloadArgs passes selector and URL as separate values', () => {
  const args = buildDownloadArgs({
    jobDir: '/tmp/job',
    url: 'https://example.com/a?b=1',
    selector: 'bv*+ba/b',
    audio: false,
    entryIndex: 2,
  });
  assert.equal(args[args.indexOf('--playlist-items') + 1], '3');
  assert.equal(args[args.indexOf('-f') + 1], 'bv*+ba/b');
  assert.equal(args[args.indexOf('-P') + 1], '/tmp/job');
  assert.equal(args[args.indexOf('--max-filesize') + 1], `${MAX_FILE_MB}M`);
  assert.equal(args.at(-1), 'https://example.com/a?b=1');
  assert.ok(args.includes('--merge-output-format'));
});

test('buildDownloadArgs uses a random output base when provided', () => {
  const args = buildDownloadArgs({
    jobDir: '/tmp/job',
    url: 'https://youtube.com/watch?v=1',
    selector: 'b',
    audio: false,
    outputBase: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  });
  assert.equal(args[args.indexOf('-o') + 1], 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.%(ext)s');
});

test('buildDownloadArgs switches to audio extraction', () => {
  const args = buildDownloadArgs({
    jobDir: '/tmp/job',
    url: 'https://example.com/a',
    selector: 'bestaudio/best',
    audio: true,
  });
  assert.ok(args.includes('-x'));
  assert.equal(args[args.indexOf('--audio-format') + 1], 'm4a');
  assert.ok(!args.includes('--merge-output-format'));
});

test('isTiktokUrl matches TikTok domains only', () => {
  assert.equal(isTiktokUrl('https://www.tiktok.com/@a/video/1'), true);
  assert.equal(isTiktokUrl('https://vm.tiktok.com/abc/'), true);
  assert.equal(isTiktokUrl('https://www.tiktokv.com/share/video/1/'), true);
  assert.equal(isTiktokUrl('https://not-tiktok.com/x'), false);
  assert.equal(isTiktokUrl('https://youtube.com/watch?v=1'), false);
});

test('TikTok and Instagram downloads force impersonation', () => {
  for (const url of [
    'https://www.tiktok.com/@a/video/1',
    'https://www.instagram.com/reel/abc/',
  ]) {
    const args = buildDownloadArgs({ jobDir: '/tmp/job', url, selector: 'b', audio: false });
    assert.equal(args[args.indexOf('--impersonate') + 1], 'Chrome-133');
  }

  const custom = buildDownloadArgs({
    jobDir: '/tmp/job',
    url: 'https://www.tiktok.com/@a/video/1',
    selector: 'b',
    audio: false,
    impersonate: 'Safari-18.0',
  });
  assert.equal(custom[custom.indexOf('--impersonate') + 1], 'Safari-18.0');

  const youtube = buildDownloadArgs({
    jobDir: '/tmp/job',
    url: 'https://www.youtube.com/watch?v=1',
    selector: 'b',
    audio: false,
  });
  assert.ok(!youtube.includes('--impersonate'));
});

test('isGalleryPhotoUrl targets photo posts only', () => {
  for (const url of [
    'https://www.instagram.com/p/DOZZg7ZDj-l/',
    'https://instagr.am/p/abc/',
    'https://www.tiktok.com/@a/photo/123',
  ]) {
    assert.equal(isGalleryPhotoUrl(url), true, url);
  }
  for (const url of [
    'https://www.instagram.com/reel/abc/',
    'https://www.instagram.com/tv/abc/',
    'https://www.tiktok.com/@a/video/123',
    'https://vm.tiktok.com/abc/',
    'https://www.tiktok.com/t/abc/',
    'https://youtube.com/watch?v=1',
  ]) {
    assert.equal(isGalleryPhotoUrl(url), false, url);
  }
});

test('buildGalleryArgs writes random names into the job directory', () => {
  const args = buildGalleryArgs({
    jobDir: '/tmp/job',
    url: 'https://www.tiktok.com/@a/photo/123',
    outputBase: 'abc',
  });
  assert.equal(args[args.indexOf('-D') + 1], '/tmp/job');
  assert.equal(args[args.indexOf('-f') + 1], 'abc_{num}.{extension}');
  assert.equal(args[args.indexOf('--filter') + 1].includes("'jpeg'"), true);
  assert.equal(args.includes('--cookies'), false);
  assert.equal(args.at(-1), 'https://www.tiktok.com/@a/photo/123');
});

test('isTransient retries upstream blocks from yt-dlp and gallery-dl', () => {
  assert.equal(isTransient({ stderr: 'ERROR: HTTP Error 403: Forbidden' }), true);
  assert.equal(isTransient({ stderr: "HttpError: '403 Forbidden'" }), true);
  assert.equal(isTransient({ stderr: 'ERROR: Unsupported URL' }), false);
});

test('parseProgress reads yt-dlp percentage lines', () => {
  assert.equal(parseProgress('[download]  42.5% of 10.00MiB at 1.00MiB/s'), 42.5);
  assert.equal(parseProgress('[download] 100% of 3.00MiB'), 100);
  assert.equal(parseProgress('[download] Destination: a.mp4'), null);
  assert.equal(parseProgress(''), null);
});

test('providerFor routes scraper hosts and rejects lookalikes', async () => {
  const { providerFor } = await import('../lib/providers.js');
  assert.equal(providerFor('https://open.spotify.com/track/x')?.id, 'spotify');
  assert.equal(providerFor('https://www.terabox.com/s/x')?.id, 'terabox');
  assert.equal(providerFor('https://www.threads.net/@a/post/b')?.id, 'threads');
  assert.equal(providerFor('https://www.pixiv.net/artworks/1')?.id, 'pixiv');
  assert.equal(providerFor('https://nimegami.id/a/download/1/720p/b/')?.id, 'nimegami');
  assert.equal(providerFor('https://sfile.co/abc123')?.id, 'sfile');
  assert.equal(providerFor('https://sfile.mobi/abc123')?.id, 'sfile');
  assert.equal(providerFor('https://open.spotify.com.evil.com/track/x'), null);
  assert.equal(providerFor('https://www.nimegami.id.evil.com/a/'), null);
});

test('normalizeScraperResult keeps Spotify single and drops cover images', async () => {
  const { providerById } = await import('../lib/providers.js');
  const { normalizeScraperResult } = await import('../lib/scraper.js');
  const out = normalizeScraperResult(providerById('spotify'), 'https://open.spotify.com/track/x', {
    title: 'Song',
    type: 'audio',
    downloads: [
      { type: 'audio', quality: '320kbps', url: 'https://cdn.test/a.mp3' },
      { type: 'image', quality: 'Cover', url: 'https://cdn.test/a.jpg' },
    ],
  });
  assert.equal(out.plan.mode, 'single');
  assert.equal(out.plan.entries[0].options.main.length, 1);
  assert.equal(out.info.entries[0].type, 'audio');
});

test('normalizeScraperResult treats TeraBox files as files, not photos', async () => {
  const { providerById } = await import('../lib/providers.js');
  const { normalizeScraperResult } = await import('../lib/scraper.js');
  const out = normalizeScraperResult(providerById('terabox'), 'https://www.terabox.com/s/x', {
    title: 'a.rar',
    downloads: [{ type: 'file', filename: 'a.rar', quality: 'Direct', url: 'https://cdn.test/x?token=1' }],
  });
  assert.equal(out.info.entries[0].type, 'file');
  assert.equal(out.info.entries[0].options[0].label, 'ALL FILES / 1 FILE');
});

test('normalizeScraperResult builds image collections for comics', async () => {
  const { providerById } = await import('../lib/providers.js');
  const { normalizeScraperResult } = await import('../lib/scraper.js');
  const out = normalizeScraperResult(providerById('komiku'), 'https://komiku.org/x-chapter-1/', {
    title: 'Chapter 1',
    downloads: [
      { type: 'image', quality: 'Page 1', url: 'https://cdn.test/1.jpg' },
      { type: 'image', quality: 'Page 2', url: 'https://cdn.test/2.jpg' },
    ],
  });
  assert.equal(out.plan.mode, 'collection');
  assert.equal(out.info.entries[0].type, 'image');
  assert.equal(out.info.entries[0].options[0].label, 'ALL PHOTOS / 2 FILES');
});

test('normalizeScraperResult skips non-direct link results', async () => {
  const { normalizeScraperResult } = await import('../lib/scraper.js');
  const out = normalizeScraperResult(
    { id: 'fake', name: 'Fake', mode: 'auto' },
    'https://example.test/a',
    {
      title: 'Episode',
      downloads: [
        { type: 'link', quality: 'Web Player', url: 'https://example.test/embed/a' },
        { type: 'link', quality: 'Direct HLS Stream', url: 'https://cdn.test/a.m3u8' },
        { type: 'video', quality: '720p', url: 'https://cdn.test/a.mp4' },
      ],
    },
  );
  assert.equal(out.plan.mode, 'options');
  assert.equal(out.plan.entries[0].options.q1[0].url, 'https://cdn.test/a.m3u8');
  assert.equal(out.plan.entries[0].options.q2[0].url, 'https://cdn.test/a.mp4');
});

test('Spotify albums and playlists are rejected', async () => {
  const { providerById } = await import('../lib/providers.js');
  const { normalizeScraperResult } = await import('../lib/scraper.js');
  assert.throws(
    () => normalizeScraperResult(providerById('spotify'), 'https://open.spotify.com/album/x', { type: 'playlist', tracks: [1, 2] }),
    /album atau playlist/i,
  );
});

test('scraperInspect rejects Nimegami series pages without fetching', async () => {
  const { scraperInspect } = await import('../lib/scraper.js');
  await assert.rejects(
    () => scraperInspect('https://nimegami.id/girls-band-cry-sub-indo/'),
    /download link/i,
  );
});

test('assertPublicUrl rejects private and non-http media URLs', async () => {
  const { assertPublicUrl } = await import('../lib/fetch.js');
  await assert.rejects(() => assertPublicUrl('http://127.0.0.1/a'), /private/i);
  await assert.rejects(() => assertPublicUrl('http://[::1]/a'), /private/i);
  await assert.rejects(() => assertPublicUrl('http://169.254.169.254/latest/meta-data/'), /private/i);
  await assert.rejects(() => assertPublicUrl('file:///etc/passwd'), /http/i);
});

test('zipFiles bundles multiple files into one archive', async () => {
  const os = await import('node:os');
  const fsp = await import('node:fs/promises');
  const path = await import('node:path');
  const { zipFiles } = await import('../lib/bundle.js');
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'goomysdl-zip-'));
  try {
    await fsp.writeFile(path.join(dir, 'a.txt'), 'alpha');
    await fsp.writeFile(path.join(dir, 'b.txt'), 'beta');
    const zip = await zipFiles(dir, ['a.txt', 'b.txt'], 'bundle.zip');
    assert.equal(zip.name, 'bundle.zip');
    assert.ok(zip.size > 0);
    const head = await fsp.readFile(path.join(dir, 'bundle.zip'));
    assert.equal(head.subarray(0, 2).toString(), 'PK');
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});
