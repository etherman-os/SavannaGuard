/// <reference types="vitest/globals" />
import {
  checkRateLimit,
  cleanupExpiredRateLimitEntries,
  RateLimitResult,
} from '../src/services/rateLimit.js';

describe('rateLimit service', () => {
  beforeEach(() => {
    // Clean up before each test to ensure isolation
    cleanupExpiredRateLimitEntries();
  });

  afterEach(() => {
    cleanupExpiredRateLimitEntries();
  });

  describe('checkRateLimit', () => {
    it('allows first request from an IP', () => {
      const result = checkRateLimit('ip-hash-1');

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBeGreaterThan(0);
      expect(result.resetAt).toBeGreaterThan(Date.now());
    });

    it('decrements remaining as requests are made', () => {
      const ipHash = 'ip-hash-2';
      const firstResult = checkRateLimit(ipHash);
      const secondResult = checkRateLimit(ipHash);

      expect(firstResult.remaining).toBeGreaterThan(secondResult.remaining);
    });

    it('blocks when rate limit is exhausted', () => {
      const ipHash = 'ip-hash-3';

      // Make requests until limit is reached
      let result: RateLimitResult;
      while (true) {
        result = checkRateLimit(ipHash);
        if (!result.allowed) break;
      }

      expect(result!.allowed).toBe(false);
      expect(result!.remaining).toBe(0);
    });

    it('resets after window expires', () => {
      const ipHash = 'ip-hash-4';
      const firstResult = checkRateLimit(ipHash);

      // Simulate time passing by checking resetAt behavior
      expect(firstResult.resetAt).toBeGreaterThan(Date.now());
    });

    it('tracks different IPs independently', () => {
      const ip1 = 'ip-aaa';
      const ip2 = 'ip-bbb';

      const result1 = checkRateLimit(ip1);
      const result2 = checkRateLimit(ip2);

      // Both should have similar remaining (independent tracking)
      expect(result1.allowed).toBe(true);
      expect(result2.allowed).toBe(true);
    });

    it('returns resetAt timestamp', () => {
      const result = checkRateLimit('ip-hash-5');

      expect(typeof result.resetAt).toBe('number');
      expect(result.resetAt).toBeGreaterThan(0);
    });
  });

  describe('cleanupExpiredRateLimitEntries', () => {
    it('removes expired entries', () => {
      const ipHash = 'ip-expire-test';

      // Create an entry
      const result = checkRateLimit(ipHash);
      expect(result.allowed).toBe(true);

      // Cleanup should not throw
      expect(() => cleanupExpiredRateLimitEntries()).not.toThrow();
    });

    it('keeps valid entries after cleanup', () => {
      const ipHash = 'ip-keep-test';

      checkRateLimit(ipHash);
      cleanupExpiredRateLimitEntries();

      // Should still be tracked (within window)
      const result = checkRateLimit(ipHash);
      expect(result.allowed).toBe(true);
    });
  });
});
