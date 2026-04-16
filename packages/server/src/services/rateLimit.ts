import { config } from '../config.js';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

// In-memory rate limiter (resets on server restart - acceptable for MVP)
// For PAID: use Redis for distributed rate limiting
const rateLimitMap = new Map<string, RateLimitEntry>();

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

export function checkRateLimit(ipHash: string): RateLimitResult {
  const now = Date.now();
  const { maxChallengesPerMinute, windowMs } = config.rateLimit;

  const entry = rateLimitMap.get(ipHash);

  // No entry or window expired - create new entry
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ipHash, {
      count: 1,
      resetAt: now + windowMs,
    });
    return {
      allowed: true,
      remaining: maxChallengesPerMinute - 1,
      resetAt: now + windowMs,
    };
  }

  // Window active - check count
  if (entry.count >= maxChallengesPerMinute) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: entry.resetAt,
    };
  }

  // Increment count
  entry.count++;
  return {
    allowed: true,
    remaining: maxChallengesPerMinute - entry.count,
    resetAt: entry.resetAt,
  };
}

export function cleanupExpiredRateLimitEntries(): void {
  const now = Date.now();
  for (const [key, entry] of rateLimitMap.entries()) {
    if (now > entry.resetAt) {
      rateLimitMap.delete(key);
    }
  }
}
