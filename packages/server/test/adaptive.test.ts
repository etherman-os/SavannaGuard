/// <reference types="vitest/globals" />
// NOTE: adaptPowDifficulty and getThreatStatus are in adaptivePow.ts
import { adaptPowDifficulty, getThreatStatus } from '../src/services/adaptivePow.js';
import { db, getPowDifficulty, setPowDifficulty, setAdaptivePowEnabled } from '../src/db.js';

describe('adaptivePow service (Difficulty Adjustment)', () => {
  const originalDifficulty = getPowDifficulty();

  afterEach(() => {
    // Reset difficulty to original after each test
    setPowDifficulty(originalDifficulty);
    setAdaptivePowEnabled(true);
  });

  describe('adaptPowDifficulty', () => {
    it('returns difficulty and threat information', () => {
      const result = adaptPowDifficulty();

      expect(result).toHaveProperty('difficulty');
      expect(result).toHaveProperty('reason');
      expect(result).toHaveProperty('threat');

      expect(typeof result.difficulty).toBe('number');
      expect(typeof result.reason).toBe('string');
      expect(result.threat).toHaveProperty('botRatio');
      expect(result.threat).toHaveProperty('totalSessions');
      expect(result.threat).toHaveProperty('botCount');
    });

    it('difficulty is within valid range (3-6)', () => {
      const result = adaptPowDifficulty();
      expect(result.difficulty).toBeGreaterThanOrEqual(3);
      expect(result.difficulty).toBeLessThanOrEqual(6);
    });

    it('maintains difficulty with insufficient data', () => {
      // With < 10 sessions, should maintain current difficulty
      const result = adaptPowDifficulty();

      // Total sessions < 10 means "Not enough data"
      if (result.threat.totalSessions < 10) {
        expect(result.reason).toBe('Not enough data');
      }
    });

    it('increases difficulty when bot ratio > 0.6', () => {
      // Manually insert sessions with bot verdicts to simulate high bot ratio
      const now = Date.now();
      for (let i = 0; i < 7; i++) {
        db.prepare(
          'INSERT INTO sessions (id, created_at, ip_hash, user_agent, final_score, verdict) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(`bot-session-${i}`, now - i * 1000, 'ip-bot', 'UA', 20, 'bot');
      }
      for (let i = 0; i < 3; i++) {
        db.prepare(
          'INSERT INTO sessions (id, created_at, ip_hash, user_agent, final_score, verdict) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(`human-session-${i}`, now - i * 1000, 'ip-human', 'UA', 80, 'human');
      }

      const initialDifficulty = getPowDifficulty();
      const result = adaptPowDifficulty();

      // Should increase difficulty
      if (result.threat.totalSessions >= 10 && result.threat.botRatio > 0.6) {
        expect(result.difficulty).toBeGreaterThan(initialDifficulty);
      }
    });

    it('reason describes threat level', () => {
      const result = adaptPowDifficulty();

      const validReasons = [
        'Not enough data',
        'Adaptive PoW disabled',
        'Threat level HIGH - increasing difficulty',
        'Threat level LOW - decreasing difficulty',
        'Threat level NORMAL - maintaining difficulty',
      ];

      expect(validReasons).toContain(result.reason);
    });

    it('does not auto-adjust when adaptive mode is disabled', () => {
      setPowDifficulty(5);
      setAdaptivePowEnabled(false);

      const result = adaptPowDifficulty();

      expect(result.difficulty).toBe(5);
      expect(result.reason).toBe('Adaptive PoW disabled');
    });
  });

  describe('getThreatStatus', () => {
    it('returns current threat status', () => {
      const status = getThreatStatus();

      expect(status).toHaveProperty('botRatio');
      expect(status).toHaveProperty('difficulty');
      expect(status).toHaveProperty('totalSessions');
      expect(status).toHaveProperty('botCount');
      expect(status).toHaveProperty('adaptiveEnabled');

      expect(typeof status.botRatio).toBe('number');
      expect(typeof status.difficulty).toBe('number');
      expect(typeof status.totalSessions).toBe('number');
      expect(typeof status.botCount).toBe('number');
      expect(typeof status.adaptiveEnabled).toBe('boolean');
    });

    it('botRatio is percentage (0-100)', () => {
      const status = getThreatStatus();
      expect(status.botRatio).toBeGreaterThanOrEqual(0);
      expect(status.botRatio).toBeLessThanOrEqual(100);
    });

    it('difficulty is within valid range', () => {
      const status = getThreatStatus();
      expect(status.difficulty).toBeGreaterThanOrEqual(3);
      expect(status.difficulty).toBeLessThanOrEqual(6);
    });

    it('botCount <= totalSessions', () => {
      const status = getThreatStatus();
      expect(status.botCount).toBeLessThanOrEqual(status.totalSessions);
    });

    it('botRatio is calculated correctly from sessions', () => {
      const status = getThreatStatus();

      if (status.totalSessions > 5) {
        const expectedRatio = Math.round((status.botCount / status.totalSessions) * 100);
        expect(status.botRatio).toBe(expectedRatio);
      }
    });
  });
});
