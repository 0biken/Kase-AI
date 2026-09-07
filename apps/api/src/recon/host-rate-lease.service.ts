import { Injectable, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'crypto';
import Redis from 'ioredis';
import { redisConnection } from '../queue/queue.config';

export interface HostRateLease { signal: AbortSignal; release(): Promise<void> }

@Injectable()
export class HostRateLeaseService implements OnModuleInit, OnApplicationShutdown {
  private redis?: Redis;

  async onModuleInit(): Promise<void> {
    this.redis = new Redis({ ...redisConnection(), lazyConnect: true, maxRetriesPerRequest: 1, commandTimeout: 5_000, enableOfflineQueue: false });
    await this.redis.connect();
  }

  async acquire(hostAndPort: string, signal: AbortSignal, waitMs = 60_000, leaseMs = 60_000): Promise<HostRateLease> {
    if (leaseMs < 60_000) throw new Error('Host lease must leave time for process-group termination');
    if (!this.redis) throw new Error('Redis host limiter is not initialized');
    const key = `kase:recon-host:${hostAndPort.toLowerCase()}`;
    const token = randomUUID();
    const deadline = Date.now() + waitMs;
    while (!signal.aborted && Date.now() < deadline) {
      const acquired = await this.redis.set(key, token, 'PX', leaseMs, 'NX');
      if (acquired === 'OK') {
        let released = false;
        const controller = new AbortController();
        let renewal: Promise<void> | undefined;
        const timer = setInterval(() => {
          if (released || renewal || controller.signal.aborted) return;
          renewal = (async () => {
            try {
              const renewed = await this.redis!.eval(RENEW_SCRIPT, 1, key, token, leaseMs);
              if (renewed !== 1) throw new Error('Global recon host lease was lost');
            } catch (error) {
              controller.abort(error);
            }
          })().finally(() => { renewal = undefined; });
        }, 10_000);
        timer.unref?.();
        return { signal: controller.signal, release: async () => {
          if (released) return;
          released = true;
          clearInterval(timer);
          await renewal;
          await this.redis?.eval(RELEASE_SCRIPT, 1, key, token);
        } };
      }
      await abortableDelay(250, signal);
    }
    if (signal.aborted) throw abortError();
    throw new Error(`Timed out acquiring global recon host lease for ${hostAndPort}`);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.redis?.quit();
  }
}

const RELEASE_SCRIPT = 'if redis.call("get",KEYS[1]) == ARGV[1] then return redis.call("del",KEYS[1]) else return 0 end';
const RENEW_SCRIPT = 'if redis.call("get",KEYS[1]) == ARGV[1] then return redis.call("pexpire",KEYS[1],ARGV[2]) else return 0 end';

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(abortError()); return; }
    const timer = setTimeout(done, ms);
    const onAbort = () => { clearTimeout(timer); signal.removeEventListener('abort', onAbort); reject(abortError()); };
    function done() { signal.removeEventListener('abort', onAbort); resolve(); }
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function abortError(): Error { const error = new Error('Audit cancellation requested'); error.name = 'AbortError'; return error; }
