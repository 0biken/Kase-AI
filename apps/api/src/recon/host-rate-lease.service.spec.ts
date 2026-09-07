import Redis from 'ioredis';
import { HostRateLeaseService } from './host-rate-lease.service';

jest.mock('ioredis');

describe('HostRateLeaseService', () => {
  const redis = { connect: jest.fn(), set: jest.fn(), eval: jest.fn(), quit: jest.fn() };
  let service: HostRateLeaseService;

  beforeEach(async () => {
    jest.useFakeTimers();
    jest.resetAllMocks();
    (Redis as unknown as jest.Mock).mockImplementation(() => redis);
    redis.set.mockResolvedValue('OK');
    redis.eval.mockResolvedValue(1);
    service = new HostRateLeaseService();
    await service.onModuleInit();
  });
  afterEach(async () => { await service.onApplicationShutdown(); jest.useRealTimers(); });

  it('renews beyond an escalated 15-minute timeout and releases once', async () => {
    const lease = await service.acquire('Fixture:3000', new AbortController().signal);
    await jest.advanceTimersByTimeAsync(16 * 60_000);
    expect(redis.eval).toHaveBeenCalledTimes(96);
    expect(redis.eval.mock.calls[0]).toEqual([expect.stringContaining('pexpire'), 1, 'kase:recon-host:fixture:3000', expect.any(String), 60_000]);
    expect(lease.signal.aborted).toBe(false);
    await lease.release();
    await lease.release();
    await jest.advanceTimersByTimeAsync(60_000);
    expect(redis.eval).toHaveBeenCalledTimes(97);
  });

  it.each(['lost', 'unavailable'])('aborts network work when coordination is %s', async (failure) => {
    const lease = await service.acquire('fixture:3000', new AbortController().signal);
    if (failure === 'lost') redis.eval.mockResolvedValueOnce(0);
    else redis.eval.mockRejectedValueOnce(new Error('Redis unavailable'));
    await jest.advanceTimersByTimeAsync(10_000);
    expect(lease.signal.aborted).toBe(true);
    await lease.release();
  });

  it('never grants network access when Redis is unavailable', async () => {
    redis.set.mockRejectedValueOnce(new Error('Redis unavailable'));
    await expect(service.acquire('fixture:3000', new AbortController().signal)).rejects.toThrow('Redis unavailable');
  });
});
