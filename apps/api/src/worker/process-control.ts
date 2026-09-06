import { spawn, type ChildProcess, type SpawnOptions } from 'child_process';

export class ProcessCancelledError extends Error {
  constructor(readonly command: string) {
    super(`Process cancelled: ${command}`);
    this.name = 'ProcessCancelledError';
  }
}

export interface ControlledProcessOptions extends SpawnOptions {
  signal?: AbortSignal;
  graceMs?: number;
  maxOutputBytes?: number;
}

export interface ControlledProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export async function runControlledProcess(
  command: string,
  args: readonly string[],
  options: ControlledProcessOptions = {},
): Promise<ControlledProcessResult> {
  if (options.signal?.aborted) throw new ProcessCancelledError(command);
  const { signal, graceMs = 30_000, maxOutputBytes = 10 * 1024 * 1024, ...spawnOptions } = options;
  const child = spawn(command, [...args], {
    ...spawnOptions,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let stdout: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  let stderr: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  const collect = (current: Buffer<ArrayBufferLike>, chunk: Buffer<ArrayBufferLike>): Buffer<ArrayBufferLike> => {
    if (current.length >= maxOutputBytes) return current;
    return Buffer.concat([current, chunk.subarray(0, maxOutputBytes - current.length)]);
  };
  child.stdout?.on('data', (chunk: Buffer<ArrayBufferLike>) => { stdout = collect(stdout, chunk); });
  child.stderr?.on('data', (chunk: Buffer<ArrayBufferLike>) => { stderr = collect(stderr, chunk); });

  let cancelled = false;
  const onAbort = () => {
    cancelled = true;
    void terminateProcessTree(child, graceMs);
  };
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const exitCode = await new Promise<number>((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code, childSignal) => {
        if (cancelled) reject(new ProcessCancelledError(command));
        else if (childSignal) reject(new Error(`Process terminated by ${childSignal}`));
        else resolve(code ?? 1);
      });
    });
    return { exitCode, stdout: stdout.toString('utf8'), stderr: stderr.toString('utf8') };
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
}

/** SIGTERM the whole process group, then SIGKILL it after the grace period. */
export async function terminateProcessTree(child: ChildProcess, graceMs = 30_000): Promise<{ forced: boolean }> {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return { forced: false };
  sendTreeSignal(child, 'SIGTERM');
  const exited = await waitForExit(child, graceMs);
  if (exited) return { forced: false };
  sendTreeSignal(child, 'SIGKILL');
  await waitForExit(child, Math.min(5_000, Math.max(100, graceMs)));
  return { forced: true };
}

function sendTreeSignal(child: ChildProcess, signal: NodeJS.Signals): void {
  if (!child.pid) return;
  try {
    if (process.platform === 'win32') child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
  }
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => { cleanup(); resolve(false); }, timeoutMs);
    timer.unref?.();
    const onExit = () => { cleanup(); resolve(true); };
    const cleanup = () => { clearTimeout(timer); child.off('exit', onExit); };
    child.once('exit', onExit);
  });
}
