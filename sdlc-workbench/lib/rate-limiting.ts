/**
 * Rate Limiting Service
 * Implements role-based rate limiting for API requests
 */

import { getDatabase } from './db';
import { NextRequest, NextResponse } from 'next/server';
import { authenticateUser } from './auth';

export interface RateLimitConfig {
  requestsPerMinute: number;
  requestsPerHour: number;
  requestsPerDay: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetTime: string;
  limit: number;
}

/**
 * Role-based rate limit configurations
 */
export const ROLE_RATE_LIMITS: Record<string, RateLimitConfig> = {
  admin: {
    requestsPerMinute: 1000,
    requestsPerHour: 10000,
    requestsPerDay: 100000,
  },
  manager: {
    requestsPerMinute: 200,
    requestsPerHour: 2000,
    requestsPerDay: 20000,
  },
  user: {
    requestsPerMinute: 100,
    requestsPerHour: 1000,
    requestsPerDay: 10000,
  },
  vendor: {
    requestsPerMinute: 50,
    requestsPerHour: 500,
    requestsPerDay: 5000,
  },
};

/**
 * Rate Limiting Service
 */
export class RateLimitingService {
  private requestCounts: Map<string, { count: number; resetTime: number }[]> = new Map();
  private cleanupInterval: NodeJS.Timeout;

  constructor() {
    // Clean up old entries every minute
    this.cleanupInterval = setInterval(() => this.cleanup(), 60000);
  }

  /**
   * Check if a request is allowed based on rate limits
   */
  async checkRateLimit(
    userId: string,
    role: string,
    endpoint: string
  ): Promise<RateLimitResult> {
    const config = ROLE_RATE_LIMITS[role] || ROLE_RATE_LIMITS.user;
    const now = Date.now();
    const key = `${userId}:${endpoint}`;

    // Initialize if not exists
    if (!this.requestCounts.has(key)) {
      this.requestCounts.set(key, []);
    }

    const counts = this.requestCounts.get(key)!;

    // Filter out old requests
    const minuteAgo = now - 60000;
    const hourAgo = now - 3600000;
    const dayAgo = now - 86400000;

    const recentMinute = counts.filter(c => c.resetTime > minuteAgo);
    const recentHour = counts.filter(c => c.resetTime > hourAgo);
    const recentDay = counts.filter(c => c.resetTime > dayAgo);

    // Check limits
    if (recentMinute.length >= config.requestsPerMinute) {
      return {
        allowed: false,
        remaining: 0,
        resetTime: new Date(Math.min(...recentMinute.map(c => c.resetTime)) + 60000).toISOString(),
        limit: config.requestsPerMinute,
      };
    }

    if (recentHour.length >= config.requestsPerHour) {
      return {
        allowed: false,
        remaining: 0,
        resetTime: new Date(Math.min(...recentHour.map(c => c.resetTime)) + 3600000).toISOString(),
        limit: config.requestsPerHour,
      };
    }

    if (recentDay.length >= config.requestsPerDay) {
      return {
        allowed: false,
        remaining: 0,
        resetTime: new Date(Math.min(...recentDay.map(c => c.resetTime)) + 86400000).toISOString(),
        limit: config.requestsPerDay,
      };
    }

    // Add current request
    counts.push({ count: 1, resetTime: now });
    this.requestCounts.set(key, counts);

    // Log to database for persistence
    await this.logRequest(userId, role, endpoint);

    return {
      allowed: true,
      remaining: config.requestsPerMinute - recentMinute.length - 1,
      resetTime: new Date(now + 60000).toISOString(),
      limit: config.requestsPerMinute,
    };
  }

  /**
   * Log request to database for persistence and analytics
   */
  private async logRequest(userId: string, role: string, endpoint: string): Promise<void> {
    const db = getDatabase();
    const client = await db.getClient();

    try {
      await client.query(
        `INSERT INTO rate_limit_logs (user_id, role, endpoint, timestamp)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, endpoint, timestamp) DO NOTHING`,
        [userId, role, endpoint, new Date()]
      );
    } catch (error) {
      // Don't fail the request if logging fails
      console.error('Failed to log rate limit request:', error);
    } finally {
      client.release();
    }
  }

  /**
   * Clean up old entries
   */
  private cleanup(): void {
    const now = Date.now();
    const dayAgo = now - 86400000;

    for (const [key, counts] of this.requestCounts.entries()) {
      const filtered = counts.filter(c => c.resetTime > dayAgo);
      if (filtered.length === 0) {
        this.requestCounts.delete(key);
      } else {
        this.requestCounts.set(key, filtered);
      }
    }
  }

  /**
   * Get rate limit statistics for a user
   */
  async getUserStats(userId: string, timeRange: string = '1 hour'): Promise<{
    totalRequests: number;
    requestsByEndpoint: Record<string, number>;
    averageRequestsPerMinute: number;
  }> {
    const db = getDatabase();
    const client = await db.getClient();

    try {
      const result = await client.query(
        `SELECT 
          COUNT(*) as total,
          endpoint,
          COUNT(*) as endpoint_count
         FROM rate_limit_logs 
         WHERE user_id = $1 AND timestamp > NOW() - INTERVAL '${timeRange}'
         GROUP BY endpoint`,
        [userId]
      );

      const requestsByEndpoint: Record<string, number> = {};
      let totalRequests = 0;

      result.rows.forEach(row => {
        requestsByEndpoint[row.endpoint] = parseInt(row.endpoint_count);
        totalRequests += parseInt(row.endpoint_count);
      });

      // Calculate average requests per minute based on time range
      const minutes = timeRange === '1 hour' ? 60 : timeRange === '1 day' ? 1440 : 1;
      const averageRequestsPerMinute = totalRequests / minutes;

      return {
        totalRequests,
        requestsByEndpoint,
        averageRequestsPerMinute,
      };
    } finally {
      client.release();
    }
  }

  /**
   * Reset rate limit for a user (admin only)
   */
  async resetRateLimit(userId: string): Promise<void> {
    const key = `${userId}:*`;
    
    // Remove all entries for this user
    for (const [k] of this.requestCounts.entries()) {
      if (k.startsWith(userId)) {
        this.requestCounts.delete(k);
      }
    }

    // Clear database logs
    const db = getDatabase();
    const client = await db.getClient();

    try {
      await client.query(
        'DELETE FROM rate_limit_logs WHERE user_id = $1',
        [userId]
      );
    } finally {
      client.release();
    }
  }

  /**
   * Cleanup on service destruction
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }

  /**
   * Middleware to check rate limits for API routes
   */
  static async checkRateLimitMiddleware(
    request: NextRequest,
    endpoint: string
  ): Promise<NextResponse | null> {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) return null;

    const token = authHeader.replace('Bearer ', '');
    const user = await authenticateUser(token);
    
    if (!user) return null;

    const service = getRateLimitingService();
    const result = await service.checkRateLimit(user.user_id, user.role, endpoint);

    if (!result.allowed) {
      return NextResponse.json(
        {
          error: 'Rate limit exceeded',
          message: `You have exceeded the rate limit. Please try again after ${result.resetTime}`,
          remaining: result.remaining,
          resetTime: result.resetTime,
          limit: result.limit,
        },
        {
          status: 429,
          headers: {
            'X-RateLimit-Limit': result.limit.toString(),
            'X-RateLimit-Remaining': result.remaining.toString(),
            'X-RateLimit-Reset': result.resetTime,
            'Retry-After': Math.ceil((new Date(result.resetTime).getTime() - Date.now()) / 1000).toString(),
          },
        }
      );
    }

    return null;
  }
}

// Singleton instance
let rateLimitingServiceInstance: RateLimitingService | null = null;

export function getRateLimitingService(): RateLimitingService {
  if (!rateLimitingServiceInstance) {
    rateLimitingServiceInstance = new RateLimitingService();
  }
  return rateLimitingServiceInstance;
}
