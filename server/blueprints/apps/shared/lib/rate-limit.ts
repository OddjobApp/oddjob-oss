/**
 * Rate Limiting for Oddjob Generated Apps
 *
 * Auto-injected by the forge pipeline to protect API routes from abuse.
 * Uses in-memory LRU cache with configurable limits.
 *
 * Features:
 * - Per-IP rate limiting
 * - Per-endpoint limits
 * - Configurable time windows
 * - Burst handling
 * - Whitelist support
 */

class SimpleLRUCache<K, V> {
  private map = new Map<K, V>();
  private max: number;
  constructor(opts: { max?: number; ttl?: number; updateAgeOnGet?: boolean } = {}) {
    this.max = opts.max ?? 5000;
  }
  get(key: K): V | undefined {
    return this.map.get(key);
  }
  set(key: K, value: V): this {
    if (this.map.size >= this.max) {
      const firstKey = this.map.keys().next().value;
      if (firstKey !== undefined) this.map.delete(firstKey);
    }
    this.map.set(key, value);
    return this;
  }
  delete(key: K): boolean {
    return this.map.delete(key);
  }
  clear(): void {
    this.map.clear();
  }
}

interface RateLimitConfig {
  windowMs: number; // Time window in milliseconds
  maxRequests: number; // Max requests per window
  skipSuccessfulRequests?: boolean; // Don't count successful requests
  skipFailedRequests?: boolean; // Don't count failed requests
  keyGenerator?: (req: Request) => string; // Custom key generator
  skip?: (req: Request) => boolean; // Skip rate limiting for certain requests
  handler?: (req: Request) => Response; // Custom handler when limit exceeded
  onLimitReached?: (req: Request, key: string) => void; // Callback when limit hit
}

interface RateLimitInfo {
  limit: number;
  current: number;
  remaining: number;
  resetTime: Date;
}

interface RateLimitStore {
  hits: number;
  resetTime: number;
}

// Default configuration
const DEFAULT_CONFIG: RateLimitConfig = {
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 100, // 100 requests per minute
  skipSuccessfulRequests: false,
  skipFailedRequests: false,
};

// In-memory store using LRU cache
class RateLimiter {
  private cache: SimpleLRUCache<string, RateLimitStore>;
  private config: RateLimitConfig;

  constructor(config: RateLimitConfig = DEFAULT_CONFIG) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    this.cache = new SimpleLRUCache({
      max: 5000, // Max 5000 unique IPs
      ttl: this.config.windowMs,
      updateAgeOnGet: false,
    });
  }

  /**
   * Generate rate limit key from request
   */
  private getKey(req: Request): string {
    if (this.config.keyGenerator) {
      return this.config.keyGenerator(req);
    }

    // Default: IP + path
    const ip = this.getClientIP(req);
    const url = new URL(req.url);
    return `${ip}:${url.pathname}`;
  }

  /**
   * Extract client IP from request
   */
  private getClientIP(req: Request): string {
    // Check forwarded headers (when behind proxy)
    const forwarded = req.headers.get("x-forwarded-for");
    if (forwarded) {
      return forwarded.split(",")[0].trim();
    }

    const realIP = req.headers.get("x-real-ip");
    if (realIP) {
      return realIP;
    }

    // Fallback (in production, use proper IP extraction)
    return "unknown";
  }

  /**
   * Check if request should be skipped
   */
  private shouldSkip(req: Request): boolean {
    if (this.config.skip) {
      return this.config.skip(req);
    }

    // Skip internal/health check endpoints
    const url = new URL(req.url);
    const skipPaths = ["/api/health", "/api/status", "/healthz", "/_next"];
    return skipPaths.some((path) => url.pathname.startsWith(path));
  }

  /**
   * Check rate limit for request
   */
  check(req: Request): { allowed: boolean; info: RateLimitInfo; store: RateLimitStore } {
    const key = this.getKey(req);

    // Check if should skip
    if (this.shouldSkip(req)) {
      return {
        allowed: true,
        info: {
          limit: this.config.maxRequests,
          current: 0,
          remaining: this.config.maxRequests,
          resetTime: new Date(Date.now() + this.config.windowMs),
        },
        store: { hits: 0, resetTime: Date.now() + this.config.windowMs },
      };
    }

    // Get or create store entry
    let store = this.cache.get(key);
    const now = Date.now();

    if (!store || now > store.resetTime) {
      // Reset window
      store = {
        hits: 0,
        resetTime: now + this.config.windowMs,
      };
    }

    // Increment hit count
    store.hits++;
    this.cache.set(key, store);

    const allowed = store.hits <= this.config.maxRequests;

    // Call limit reached callback
    if (!allowed && this.config.onLimitReached) {
      this.config.onLimitReached(req, key);
    }

    const info: RateLimitInfo = {
      limit: this.config.maxRequests,
      current: store.hits,
      remaining: Math.max(0, this.config.maxRequests - store.hits),
      resetTime: new Date(store.resetTime),
    };

    return { allowed, info, store };
  }

  /**
   * Get rate limit info without incrementing
   */
  getInfo(req: Request): RateLimitInfo {
    const key = this.getKey(req);
    const store = this.cache.get(key);
    const now = Date.now();

    if (!store || now > store.resetTime) {
      return {
        limit: this.config.maxRequests,
        current: 0,
        remaining: this.config.maxRequests,
        resetTime: new Date(now + this.config.windowMs),
      };
    }

    return {
      limit: this.config.maxRequests,
      current: store.hits,
      remaining: Math.max(0, this.config.maxRequests - store.hits),
      resetTime: new Date(store.resetTime),
    };
  }

  /**
   * Reset rate limit for key
   */
  reset(key: string): void {
    this.cache.delete(key);
  }

  /**
   * Reset all rate limits
   */
  resetAll(): void {
    this.cache.clear();
  }
}

// Global rate limiter instances per configuration
const limiters = new Map<string, RateLimiter>();

/**
 * Create or get rate limiter instance
 */
function getLimiter(name: string, config?: RateLimitConfig): RateLimiter {
  const key = `${name}:${JSON.stringify(config)}`;

  if (!limiters.has(key)) {
    limiters.set(key, new RateLimiter(config));
  }

  return limiters.get(key)!;
}

/**
 * Rate limit middleware factory
 */
export function rateLimit(config?: Partial<RateLimitConfig>) {
  const limiter = new RateLimiter({ ...DEFAULT_CONFIG, ...config });

  return async function rateLimitMiddleware(
    req: Request
  ): Promise<{ allowed: boolean; response?: Response; headers: Record<string, string> }> {
    const { allowed, info } = limiter.check(req);

    // Build rate limit headers
    const headers: Record<string, string> = {
      "X-RateLimit-Limit": String(info.limit),
      "X-RateLimit-Remaining": String(info.remaining),
      "X-RateLimit-Reset": String(Math.ceil(info.resetTime.getTime() / 1000)),
    };

    if (!allowed) {
      // Rate limit exceeded
      const retryAfter = Math.ceil(
        (info.resetTime.getTime() - Date.now()) / 1000
      );

      headers["Retry-After"] = String(retryAfter);

      const response = config?.handler
        ? config.handler(req)
        : new Response(
            JSON.stringify({
              error: "Too Many Requests",
              message: "Rate limit exceeded. Please try again later.",
              retryAfter,
            }),
            {
              status: 429,
              headers: {
                ...headers,
                "Content-Type": "application/json",
              },
            }
          );

      return { allowed: false, response, headers };
    }

    return { allowed: true, headers };
  };
}

/**
 * API route wrapper with rate limiting
 */
export function withRateLimit(
  handler: (req: Request) => Promise<Response> | Response,
  config?: Partial<RateLimitConfig>
) {
  const middleware = rateLimit(config);

  return async function wrappedHandler(req: Request): Promise<Response> {
    const result = await middleware(req);

    if (!result.allowed) {
      return result.response!;
    }

    // Call the actual handler
    const response = await handler(req);

    // Add rate limit headers to successful response
    const newHeaders = new Headers(response.headers);
    Object.entries(result.headers).forEach(([key, value]) => {
      newHeaders.set(key, value);
    });

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders,
    });
  };
}

/**
 * Pre-configured rate limiters for common use cases
 */
export const presets = {
  /**
   * Strict limit for sensitive endpoints (login, register, etc.)
   */
  strict: () =>
    rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      maxRequests: 5, // 5 attempts
    }),

  /**
   * Standard API rate limit
   */
  standard: () =>
    rateLimit({
      windowMs: 60 * 1000, // 1 minute
      maxRequests: 100, // 100 requests
    }),

  /**
   * Relaxed limit for public endpoints
   */
  relaxed: () =>
    rateLimit({
      windowMs: 60 * 1000, // 1 minute
      maxRequests: 300, // 300 requests
    }),

  /**
   * Burst-friendly limit for high-traffic endpoints
   */
  burst: () =>
    rateLimit({
      windowMs: 10 * 1000, // 10 seconds
      maxRequests: 50, // 50 requests (300/min effective)
    }),
};

/**
 * Middleware for Next.js API routes
 */
export function apiRateLimit(config?: Partial<RateLimitConfig>) {
  return withRateLimit;
}

/**
 * IP-based whitelist/blacklist
 */
export const ipFilter = {
  whitelist: new Set<string>(),
  blacklist: new Set<string>(),

  addToWhitelist(ip: string): void {
    this.whitelist.add(ip);
  },

  removeFromWhitelist(ip: string): void {
    this.whitelist.delete(ip);
  },

  addToBlacklist(ip: string): void {
    this.blacklist.add(ip);
  },

  removeFromBlacklist(ip: string): void {
    this.blacklist.delete(ip);
  },

  isWhitelisted(ip: string): boolean {
    return this.whitelist.has(ip);
  },

  isBlacklisted(ip: string): boolean {
    return this.blacklist.has(ip);
  },

  /**
   * Check if IP is allowed
   */
  isAllowed(ip: string): boolean {
    if (this.whitelist.size > 0) {
      return this.whitelist.has(ip);
    }
    return !this.blacklist.has(ip);
  },

  /**
   * Get client IP from request
   */
  getIP(req: Request): string {
    const forwarded = req.headers.get("x-forwarded-for");
    if (forwarded) {
      return forwarded.split(",")[0].trim();
    }
    return req.headers.get("x-real-ip") || "unknown";
  },

  /**
   * Create middleware that checks IP filter
   */
  middleware() {
    const self = this;
    return function (req: Request): Response | null {
      const ip = self.getIP(req);

      if (!self.isAllowed(ip)) {
        return new Response("Forbidden", { status: 403 });
      }

      return null;
    };
  },
};

// Export default rate limiter
export default {
  rateLimit,
  withRateLimit,
  presets,
  ipFilter,
  apiRateLimit,
};
