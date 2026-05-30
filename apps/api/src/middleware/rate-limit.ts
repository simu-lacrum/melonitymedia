// ─────────────────────────────────────────────────────────────
// In-memory rate limiter for auth endpoints (M-6)
//
// Simple sliding-window counter per IP address.
// Not distributed (single process), but sufficient for the API
// since it runs as a single instance behind Docker.
//
// For multi-instance deployments, replace with Redis-based limiter.
// ─────────────────────────────────────────────────────────────

import { Request, Response, NextFunction } from 'express';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

// Cleanup stale entries every 5 minutes to prevent memory leak
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (entry.resetAt <= now) {
      store.delete(key);
    }
  }
}, 5 * 60_000).unref();

/**
 * Create a rate limiter middleware.
 * @param maxRequests — max requests per window
 * @param windowMs — time window in milliseconds
 */
export function rateLimit(maxRequests: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const key = `${req.ip}:${req.path}`;
    const now = Date.now();

    let entry = store.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      store.set(key, entry);
    }

    entry.count++;

    // Set rate limit headers
    res.setHeader('X-RateLimit-Limit', maxRequests);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, maxRequests - entry.count));
    res.setHeader('X-RateLimit-Reset', Math.ceil(entry.resetAt / 1000));

    if (entry.count > maxRequests) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      res.setHeader('Retry-After', retryAfter);
      res.status(429).json({
        error: 'Слишком много запросов. Попробуйте позже.',
        retryAfter,
      });
      return;
    }

    next();
  };
}

/**
 * Pre-configured rate limiters for common use cases.
 */
export const authRateLimit = rateLimit(10, 15 * 60_000);  // 10 attempts per 15 min
export const apiRateLimit = rateLimit(100, 60_000);         // 100 per minute
