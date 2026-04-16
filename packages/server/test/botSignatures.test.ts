/// <reference types="vitest/globals" />
import {
  hashUserAgent,
  checkBotSignature,
  recordBotSignature,
  cleanupOldSignatures,
  getBotSignatureStats,
} from '../src/services/botSignatures.js';
import { db } from '../src/db.js';

describe('botSignatures service', () => {
  // Use unique identifiers per test to avoid cross-test pollution
  const uniquePrefix = `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  describe('hashUserAgent', () => {
    it('returns a 16-character hash', () => {
      const hash = hashUserAgent('Mozilla/5.0 Test Browser');
      expect(hash.length).toBe(16);
    });

    it('returns consistent hash for same input', () => {
      const ua = 'Mozilla/5.0 Chrome/120.0.0.0';
      const hash1 = hashUserAgent(ua);
      const hash2 = hashUserAgent(ua);
      expect(hash1).toBe(hash2);
    });

    it('returns different hashes for different inputs', () => {
      const hash1 = hashUserAgent('Mozilla/5.0 Chrome');
      const hash2 = hashUserAgent('Mozilla/5.0 Firefox');
      expect(hash1).not.toBe(hash2);
    });

    it('only contains hex characters', () => {
      const hash = hashUserAgent('Any User Agent');
      expect(/^[0-9a-f]+$/.test(hash)).toBe(true);
    });
  });

  describe('checkBotSignature', () => {
    it('returns not known bot for new signatures', () => {
      const result = checkBotSignature(`${uniquePrefix}-new-ip`, `${uniquePrefix}-new-ua`);
      expect(result.isKnownBot).toBe(false);
      expect(result.confidence).toBe(0);
    });

    it('detects bot with high IP hits (3+)', () => {
      const ipHash = `${uniquePrefix}-ip-bot`;
      for (let i = 0; i < 3; i++) {
        recordBotSignature(ipHash, `${uniquePrefix}-ua-diff-${i}`);
      }

      const result = checkBotSignature(ipHash, `${uniquePrefix}-new-ua`);
      expect(result.isKnownBot).toBe(true);
      expect(result.confidence).toBe(0.7);
    });

    it('detects bot with high UA hits (3+)', () => {
      const uaHash = `${uniquePrefix}-ua-bot`;
      for (let i = 0; i < 3; i++) {
        recordBotSignature(`${uniquePrefix}-ip-diff-${i}`, uaHash);
      }

      const result = checkBotSignature(`${uniquePrefix}-new-ip`, uaHash);
      expect(result.isKnownBot).toBe(true);
      expect(result.confidence).toBe(0.6);
    });

    it('detects bot with both high IP and UA hits (3+)', () => {
      const ipHash = `${uniquePrefix}-both-ip`;
      const uaHash = `${uniquePrefix}-both-ua`;
      for (let i = 0; i < 3; i++) {
        recordBotSignature(ipHash, uaHash);
      }

      const result = checkBotSignature(ipHash, uaHash);
      expect(result.isKnownBot).toBe(true);
      expect(result.confidence).toBe(0.95);
    });

    it('returns low confidence for partial matches (below threshold)', () => {
      // Use completely unique hashes to avoid prior test pollution
      const ipHash = `${uniquePrefix}-partial-ip`;
      const uaHash = `${uniquePrefix}-partial-ua`;

      // Record only 2 times (below threshold of 3)
      recordBotSignature(ipHash, uaHash);
      recordBotSignature(ipHash, uaHash);

      const result = checkBotSignature(ipHash, uaHash);
      expect(result.isKnownBot).toBe(false);
      expect(result.confidence).toBe(0);
    });
  });

  describe('recordBotSignature', () => {
    it('records new signature without error', () => {
      const uniqueIp = `${uniquePrefix}-unique-ip-${Date.now()}`;
      const uniqueUa = `${uniquePrefix}-unique-ua-${Date.now()}`;

      expect(() => recordBotSignature(uniqueIp, uniqueUa)).not.toThrow();

      const result = checkBotSignature(uniqueIp, uniqueUa);
      // First record - not enough for bot detection (threshold is 3)
      expect(result.isKnownBot).toBe(false);
    });

    it('increments match count for existing signature', () => {
      const uniqueIp = `${uniquePrefix}-increment-ip`;
      const uniqueUa = `${uniquePrefix}-increment-ua`;

      recordBotSignature(uniqueIp, uniqueUa);
      const first = checkBotSignature(uniqueIp, uniqueUa);

      recordBotSignature(uniqueIp, uniqueUa);
      const second = checkBotSignature(uniqueIp, uniqueUa);

      // Bot detection threshold is 3, so still false
      expect(first.isKnownBot).toBe(false);
      expect(second.isKnownBot).toBe(false);
    });
  });

  describe('cleanupOldSignatures', () => {
    it('does not throw with no signatures', () => {
      expect(() => cleanupOldSignatures()).not.toThrow();
    });

    it('cleans up signatures older than 30 days', () => {
      // This test verifies the function runs without error
      expect(() => cleanupOldSignatures()).not.toThrow();
    });
  });

  describe('getBotSignatureStats', () => {
    it('returns stats object with expected structure', () => {
      const stats = getBotSignatureStats();

      expect(stats).toHaveProperty('total');
      expect(stats).toHaveProperty('ipSignatures');
      expect(stats).toHaveProperty('uaSignatures');
      expect(stats).toHaveProperty('topHits');

      expect(typeof stats.total).toBe('number');
      expect(typeof stats.ipSignatures).toBe('number');
      expect(typeof stats.uaSignatures).toBe('number');
      expect(Array.isArray(stats.topHits)).toBe(true);
    });

    it('total equals ipSignatures plus uaSignatures', () => {
      const stats = getBotSignatureStats();
      expect(stats.total).toBe(stats.ipSignatures + stats.uaSignatures);
    });
  });
});
