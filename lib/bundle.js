import path from 'node:path';
import fsp from 'node:fs/promises';
import { spawn } from 'node:child_process';

export async function zipFiles(dir, names, zipName) {
  if (!names.length) throw new Error('No files to bundle.');
  if (names.some((name) => name !== path.basename(name) || name.startsWith('-'))) {
    throw new Error('Refusing to bundle unsafe file names.');
  }
  const dest = path.join(dir, zipName);
  await new Promise((resolve, reject) => {
    const child = spawn('zip', ['-0', '-q', zipName, ...names], { cwd: dir });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr = `${stderr}${chunk.toString()}`.slice(-2000);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim().split('\n').at(-1) || 'Could not create ZIP.'));
    });
  });
  const stat = await fsp.stat(dest).catch(() => null);
  if (!stat || !stat.size) {
    await fsp.rm(dest, { force: true }).catch(() => {});
    throw new Error('The ZIP file is empty.');
  }
  return { name: zipName, size: stat.size };
}
