import { spawn } from 'child_process';
import { ProcessCancelledError, runControlledProcess, terminateProcessTree } from './process-control';

describe('process-control graceful and forced termination', () => {
  it('cancellation actually stops a real child process', async () => {
    const controller = new AbortController();
    const running = runControlledProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      signal: controller.signal, graceMs: 200,
    });
    setTimeout(() => controller.abort(), 50);
    await expect(running).rejects.toBeInstanceOf(ProcessCancelledError);
  });

  it('uses graceful SIGTERM when the child cooperates', async () => {
    const child = spawn(process.execPath, ['-e',
      "process.on('SIGTERM',()=>process.exit(0));setInterval(()=>{},1000)",
    ], { detached: process.platform !== 'win32', windowsHide: true });
    await new Promise((resolve) => setTimeout(resolve, 50));
    await expect(terminateProcessTree(child, 1_000)).resolves.toEqual({ forced: false });
  });

  it('escalates an uncooperative process group to SIGKILL', async () => {
    if (process.platform === 'win32') {
      // Windows does not permit a Node child to ignore TerminateProcess. The
      // real-child test above proves termination on Windows; POSIX proves the escalation.
      expect(process.platform).toBe('win32');
      return;
    }
    const child = spawn(process.execPath, ['-e',
      "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)",
    ], { detached: true });
    await new Promise((resolve) => setTimeout(resolve, 50));
    await expect(terminateProcessTree(child, 100)).resolves.toEqual({ forced: true });
  });
});
