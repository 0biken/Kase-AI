import { RetentionRunnerService } from './retention-runner.service';

describe('RetentionRunnerService', () => {
  const originalRunOnce = process.env.KASE_RETENTION_RUN_ONCE;
  const originalInterval = process.env.KASE_RETENTION_INTERVAL_MS;

  afterEach(() => {
    if (originalRunOnce === undefined) delete process.env.KASE_RETENTION_RUN_ONCE;
    else process.env.KASE_RETENTION_RUN_ONCE = originalRunOnce;
    if (originalInterval === undefined) delete process.env.KASE_RETENTION_INTERVAL_MS;
    else process.env.KASE_RETENTION_INTERVAL_MS = originalInterval;
    jest.restoreAllMocks();
  });

  it('keeps a persistent interval referenced so the retention runtime stays alive', async () => {
    delete process.env.KASE_RETENTION_RUN_ONCE;
    process.env.KASE_RETENTION_INTERVAL_MS = '1000';
    const retention = { runBatch: jest.fn().mockResolvedValue({ claimed: 0, tombstoned: 0, failed: 0 }) };
    const interval = { unref: jest.fn() } as unknown as NodeJS.Timeout;
    jest.spyOn(global, 'setInterval').mockReturnValue(interval);
    const runner = new RetentionRunnerService(retention as any);

    runner.onModuleInit();
    await Promise.resolve();

    expect(setInterval).toHaveBeenCalledWith(expect.any(Function), 1000);
    expect((interval as any).unref).not.toHaveBeenCalled();
    expect(retention.runBatch).toHaveBeenCalledTimes(1);
    runner.onApplicationShutdown();
  });

  it('runs one batch without registering an interval in explicit run-once mode', async () => {
    process.env.KASE_RETENTION_RUN_ONCE = 'true';
    const retention = { runBatch: jest.fn().mockResolvedValue({ claimed: 0, tombstoned: 0, failed: 0 }) };
    const intervalSpy = jest.spyOn(global, 'setInterval');
    const runner = new RetentionRunnerService(retention as any);

    runner.onModuleInit();
    await Promise.resolve();

    expect(intervalSpy).not.toHaveBeenCalled();
    expect(retention.runBatch).toHaveBeenCalledTimes(1);
  });
});
