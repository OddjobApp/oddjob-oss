// Integration: exercises the real Redis-backed L2 tier (setex, tag sets, SCAN-based
// wildcard invalidation), so it runs under `npm run test:integration`, where CI
// provisions Redis, not in the hermetic unit gate.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CacheService } from '../../server/domain/cache/cache.service';

describe('Multi-Tier Cache Service', () => {
  let cacheService: CacheService;

  beforeEach(() => {
    cacheService = new CacheService();
  });

  afterEach(async () => {
    await cacheService.close();
  });

  it('stores and retrieves items from L1 in-memory cache', async () => {
    await cacheService.set('test:key:1', { name: 'Oddjob' }, { ttl: 60 });
    const cached = await cacheService.get<{ name: string }>('test:key:1');
    expect(cached).toEqual({ name: 'Oddjob' });
  });

  it('executes getOrFetch on cache miss and caches result', async () => {
    const fetcher = vi.fn().mockResolvedValue({ id: 100, status: 'active' });

    const result = await cacheService.getOrFetch('test:fetch:100', fetcher, { ttl: 60 });
    expect(result).toEqual({ id: 100, status: 'active' });
    expect(fetcher).toHaveBeenCalledTimes(1);

    // Second call should hit L1 cache
    const secondResult = await cacheService.getOrFetch('test:fetch:100', fetcher, { ttl: 60 });
    expect(secondResult).toEqual({ id: 100, status: 'active' });
    expect(fetcher).toHaveBeenCalledTimes(1); // Not called again
  });

  it('tracks cache metrics correctly', async () => {
    await cacheService.set('metric:key', 'data', { ttl: 60 });
    await cacheService.get('metric:key'); // Hit
    await cacheService.get('missing:key'); // Miss

    const metrics = cacheService.getMetrics();
    expect(metrics.hits).toBe(1);
    expect(metrics.misses).toBe(1);
    expect(metrics.hitRate).toBe('50.00%');
  });

  it('invalidates keys matching wildcard pattern using non-blocking scan', async () => {
    await cacheService.set('org:42:user:1', { name: 'Alice' }, { ttl: 60 });
    await cacheService.set('org:42:user:2', { name: 'Bob' }, { ttl: 60 });
    await cacheService.set('org:99:user:1', { name: 'Charlie' }, { ttl: 60 });

    const deleted = await cacheService.invalidate('org:42:*');
    expect(deleted).toBeGreaterThanOrEqual(2);

    expect(await cacheService.get('org:42:user:1')).toBeNull();
    expect(await cacheService.get('org:42:user:2')).toBeNull();
    expect(await cacheService.get('org:99:user:1')).toEqual({ name: 'Charlie' });
  });
});
