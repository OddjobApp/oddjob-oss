/**
 * In-Memory LRU Cache Engine
 *
 * Lightweight, high-performance Least-Recently-Used (LRU) cache with capacity eviction,
 * TTL (Time-To-Live) expiration, and hit/miss performance statistics.
 */

export interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class LruCache<T> {
  private cache = new Map<string, CacheEntry<T>>();
  private maxCapacity: number;
  private defaultTtlMs: number;
  private hits = 0;
  private misses = 0;

  constructor(maxCapacity = 500, defaultTtlMs = 300000) {
    this.maxCapacity = maxCapacity;
    this.defaultTtlMs = defaultTtlMs;
  }

  get(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) {
      this.misses++;
      return undefined;
    }

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.misses++;
      return undefined;
    }

    // Refresh LRU order by deleting and re-inserting
    this.cache.delete(key);
    this.cache.set(key, entry);
    this.hits++;
    return entry.value;
  }

  set(key: string, value: T, ttlMs = this.defaultTtlMs): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxCapacity) {
      // Evict oldest (first inserted) item
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      }
    }

    this.cache.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
    });
  }

  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }

  getStats(): { size: number; capacity: number; hits: number; misses: number; hitRatio: number } {
    const total = this.hits + this.misses;
    const hitRatio = total > 0 ? Math.round((this.hits / total) * 1000) / 1000 : 0;
    return {
      size: this.cache.size,
      capacity: this.maxCapacity,
      hits: this.hits,
      misses: this.misses,
      hitRatio,
    };
  }
}
