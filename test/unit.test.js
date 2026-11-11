import test from 'node:test';
import assert from 'node:assert/strict';
import { displayNameFor, normalizeInfo, parseMediaUrl, safeName } from '../lib/validate.js';
import { MAX_FILE_MB, buildDownloadArgs, isTiktokUrl, parseProgress } from '../lib/ytdlp.js';

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

test('TikTok downloads force impersonation', () => {
  const tiktok = buildDownloadArgs({
    jobDir: '/tmp/job',
    url: 'https://www.tiktok.com/@a/video/1',
    selector: 'b',
    audio: false,
  });
  assert.equal(tiktok[tiktok.indexOf('--impersonate') + 1], 'Chrome-133');

  const youtube = buildDownloadArgs({
    jobDir: '/tmp/job',
    url: 'https://www.youtube.com/watch?v=1',
    selector: 'b',
    audio: false,
  });
  assert.ok(!youtube.includes('--impersonate'));
});

test('parseProgress reads yt-dlp percentage lines', () => {
  assert.equal(parseProgress('[download]  42.5% of 10.00MiB at 1.00MiB/s'), 42.5);
  assert.equal(parseProgress('[download] 100% of 3.00MiB'), 100);
  assert.equal(parseProgress('[download] Destination: a.mp4'), null);
  assert.equal(parseProgress(''), null);
});
