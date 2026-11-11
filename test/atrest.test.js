import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, access, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { newKey, openSealedStream, sealFile } from '../lib/atrest.js';

async function collect(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

test('sealFile removes plaintext and decrypts roundtrip', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'goomysdl-'));
  try {
    const file = path.join(dir, 'sample.mp4');
    const plain = Buffer.from('secret media bytes '.repeat(50));
    await writeFile(file, plain);

    const key = newKey();
    const sealed = await sealFile(file, key);
    await assert.rejects(access(file), /ENOENT/);
    assert.match(path.basename(sealed.encPath), /^[0-9a-f-]+\.enc$/);
    assert.ok(!path.basename(sealed.encPath).includes('sample'));

    const cipher = await readFile(sealed.encPath);
    assert.equal(cipher.length, plain.length);
    assert.ok(!cipher.includes(Buffer.from('secret media')));

    const out = await collect(openSealedStream(sealed, key));
    assert.deepEqual(out, plain);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('tampered ciphertext fails authentication', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'goomysdl-'));
  try {
    const file = path.join(dir, 'sample.jpg');
    await writeFile(file, Buffer.from('image payload'));
    const key = newKey();
    const sealed = await sealFile(file, key);

    const data = await readFile(sealed.encPath);
    data[0] ^= 0xff;
    await writeFile(sealed.encPath, data);

    await assert.rejects(collect(openSealedStream(sealed, key)));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
