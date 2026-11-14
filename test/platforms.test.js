import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyTestError, TEST_SAMPLES, testPlatform } from '../lib/platform-tests.js';
import { parseMediaUrl } from '../lib/validate.js';

const PLATFORMS = [
  'tiktok', 'instagram', 'twitter', 'youtube', 'facebook', 'reddit', 'vimeo',
  'twitch', 'soundcloud', 'dailymotion', 'spotify', 'terabox', 'threads',
  'pixiv', 'douyin', 'mediafire', 'pixeldrain', 'catbox', 'gdrive', 'sfile',
  'krakenfiles', 'doodstream', 'komiku', 'komikindo', 'asurascans', 'mangadex',
  'nimegami',
];

test('test samples cover every supported platform with allowed URLs', () => {
  assert.deepEqual(Object.keys(TEST_SAMPLES).sort(), [...PLATFORMS].sort());
  for (const [id, url] of Object.entries(TEST_SAMPLES)) {
    assert.equal(parseMediaUrl(url), url, id);
  }
});

test('unknown platform test is rejected', async () => {
  await assert.rejects(testPlatform('unknown'), /Unknown platform/);
});

test('test errors are classified for the status badge', () => {
  assert.equal(classifyTestError(new Error('This post needs login/cookies')), 'login');
  assert.equal(classifyTestError(new Error('The platform timed out')), 'timeout');
  assert.equal(classifyTestError(new Error('No downloadable media found')), 'fail');
});
