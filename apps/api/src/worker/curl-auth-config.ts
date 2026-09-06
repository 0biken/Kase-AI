import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';

/** Writes credentials to the worker tmpfs so they never appear in argv or queue payloads. */
export async function materializeCurlConfig(jobId: string, authMode: string, value: string): Promise<string> {
  const root = process.env.KASE_SECRET_TMPFS ?? '/run/kase-secrets';
  await mkdir(root, { recursive: true, mode: 0o700 });
  const path = join(root, `${jobId}.curl-config`);
  const escaped = value.replace(/\\/gu, '\\\\').replace(/"/gu, '\\"').replace(/[\r\n]/gu, '');
  let line: string;
  if (authMode === 'header') line = `header = "${escaped}"\n`;
  else if (authMode === 'cookie') line = `cookie = "${escaped}"\n`;
  else throw new Error(`Worker does not support auth mode "${authMode}"`);
  await writeFile(path, line, { encoding: 'utf8', mode: 0o600 });
  return path;
}
