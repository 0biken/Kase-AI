import { spawn } from 'child_process';

export interface CurlProbeResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export class CurlProbeError extends Error {
  constructor(
    readonly exitCode: number,
    readonly stderr: string,
  ) {
    super(`curl exited with code ${exitCode}`);
    this.name = 'CurlProbeError';
  }
}

export function runCurlProbe(
  url: string,
  proxy: string,
  configPath: string | null,
  signal: AbortSignal,
): Promise<CurlProbeResult> {
  const executable = process.env.KASE_CURL_PATH ?? 'curl';
  const args = [
    '--silent',
    '--show-error',
    '--fail-with-body',
    '--include',
    '--max-time',
    '20',
    '--proxy',
    proxy,
    ...(configPath ? ['--config', configPath] : []),
    url,
  ];

  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      signal,
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const append = (current: string, chunk: Buffer) => {
      const next = current + chunk.toString('utf8');
      if (Buffer.byteLength(next) > 1_048_576) {
        child.kill();
        fail(new Error('Probe output exceeded the 1 MiB M1 cap'));
        return current;
      }
      return next;
    };
    child.stdout.on('data', (chunk: Buffer) => { stdout = append(stdout, chunk); });
    child.stderr.on('data', (chunk: Buffer) => { stderr = append(stderr, chunk); });
    child.once('error', fail);
    child.once('close', (code) => {
      if (settled) return;
      const exitCode = code ?? 1;
      if (exitCode !== 0) return fail(new CurlProbeError(exitCode, stderr));
      settled = true;
      resolve({ stdout, stderr, exitCode });
    });
  });
}
