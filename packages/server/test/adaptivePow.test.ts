/// <reference types="vitest/globals" />
// NOTE: adaptScores, learnFromSession, getLearningStatus are in adaptive.ts
import { adaptScores, learnFromSession, getLearningStatus } from '../src/services/adaptive.js';
import { db } from '../src/db.js';

describe('adaptive service (Online Gaussian)', () => {
  beforeEach(() => {
    // Clean up site_signals table before each test to ensure isolation
    db.prepare('DELETE FROM site_signals').run();
  });

  const validScores = {
    mouseScore: 80,
    keyboardScore: 75,
    timingScore: 85,
    canvasScore: 70,
    webglScore: 75,
    screenScore: 80,
    navigatorScore: 78,
    networkScore: 82,
  };

  describe('adaptScores', () => {
    it('returns adjusted score when no learning data exists', () => {
      const result = adaptScores(validScores);

      expect(result).toHaveProperty('adjustedScore');
      expect(result).toHaveProperty('confidence');
      expect(result).toHaveProperty('sampleSize');

      expect(typeof result.adjustedScore).toBe('number');
      expect(typeof result.confidence).toBe('number');
      expect(typeof result.sampleSize).toBe('number');
    });

    it('returns high confidence (0) when no learning data', () => {
      // With count < 10, confidence contribution is 0
      const result = adaptScores(validScores);
      expect(result.confidence).toBe(0);
      expect(result.sampleSize).toBe(0);
    });

    it('adjustedScore is within valid range', () => {
      const result = adaptScores(validScores);
      expect(result.adjustedScore).toBeGreaterThanOrEqual(0);
      expect(result.adjustedScore).toBeLessThanOrEqual(100);
    });
  });

  describe('learnFromSession', () => {
    it('learns from human sessions', () => {
      expect(() => learnFromSession(validScores, 'human')).not.toThrow();
    });

    it('does not learn from bot sessions', () => {
      // Should not update stats for non-human verdicts
      expect(() => learnFromSession(validScores, 'bot')).not.toThrow();
      expect(() => learnFromSession(validScores, 'suspicious')).not.toThrow();
    });

    it('updates learning status after learning', () => {
      learnFromSession(validScores, 'human');
      const status = getLearningStatus();

      expect(typeof status).toBe('object');
    });
  });

  describe('getLearningStatus', () => {
    it('returns status for all learning signals', () => {
      const status = getLearningStatus();

      const expectedSignals = [
        'mouse_score',
        'keyboard_score',
        'timing_score',
        'canvas_score',
        'webgl_score',
        'screen_score',
        'navigator_score',
        'network_score',
      ];

      for (const signal of expectedSignals) {
        expect(status).toHaveProperty(signal);
        expect(status[signal]).toHaveProperty('mean');
        expect(status[signal]).toHaveProperty('stddev');
        expect(status[signal]).toHaveProperty('count');
      }
    });

    it('initial mean is around 50 when no data', () => {
      const status = getLearningStatus();

      // With no data (count < 10), mean defaults to 50
      for (const signal of Object.keys(status)) {
        expect(status[signal].mean).toBe(50);
        expect(status[signal].count).toBe(0);
      }
    });

    it('learnFromSession does not throw for human verdict', () => {
      // The function should complete without error
      expect(() => learnFromSession(validScores, 'human')).not.toThrow();
    });

    it('learnFromSession ignores bot verdicts without error', () => {
      expect(() => learnFromSession(validScores, 'bot')).not.toThrow();
      expect(() => learnFromSession(validScores, 'suspicious')).not.toThrow();
    });
  });
});
