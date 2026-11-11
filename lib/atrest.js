import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;

export function newKey() {
  return randomBytes(32);
}

export async function sealFile(filePath, key) {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encPath = `${filePath}.enc`;
  await pipeline(
    createReadStream(filePath),
    cipher,
    createWriteStream(encPath, { mode: 0o600 }),
  );
  const tag = cipher.getAuthTag();
  await fs.rm(filePath, { force: true });
  return { encPath, iv, tag };
}

export function openSealedStream(sealed, key) {
  const decipher = createDecipheriv(ALGORITHM, key, sealed.iv);
  decipher.setAuthTag(sealed.tag);
  return createReadStream(sealed.encPath).pipe(decipher);
}
