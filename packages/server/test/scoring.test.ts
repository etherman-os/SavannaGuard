/// <reference types="vitest/globals" />
import {
  calculateOverallScore,
  getVerdict,
  scoreMouse,
  scoreTiming,
  scoreKeystroke,
  scoreCanvas,
  scoreWebGL,
  scoreScreen,
  scoreNavigator,
  scoreNetwork,
  calculateAllScores,
  SignalScores,
} from '../src/services/scoring.js';

describe('scoring service', () => {
  describe('scoreMouse', () => {
    it('returns 50 for undefined input', () => {
      expect(scoreMouse(undefined)).toBe(50);
    });

    it('returns 50 for non-finite values', () => {
      expect(scoreMouse(Infinity)).toBe(50);
      expect(scoreMouse(NaN)).toBe(50);
    });

    it('returns 0 for very high straight line ratio (>0.95)', () => {
      expect(scoreMouse(0.96)).toBe(0);
      expect(scoreMouse(1.0)).toBe(0);
    });

    it('returns 15 for ratio >0.9', () => {
      expect(scoreMouse(0.91)).toBe(15);
      expect(scoreMouse(0.94)).toBe(15);
    });

    it('returns 30 for ratio >0.8', () => {
      expect(scoreMouse(0.81)).toBe(30);
      expect(scoreMouse(0.89)).toBe(30);
    });

    it('returns 60 for ratio >0.6', () => {
      expect(scoreMouse(0.61)).toBe(60);
      expect(scoreMouse(0.79)).toBe(60);
    });

    it('returns 80 for ratio >0.4', () => {
      expect(scoreMouse(0.41)).toBe(80);
      expect(scoreMouse(0.59)).toBe(80);
    });

    it('returns 90 for ratio <=0.4', () => {
      expect(scoreMouse(0.4)).toBe(90);
      expect(scoreMouse(0.1)).toBe(90);
      expect(scoreMouse(0.0)).toBe(90);
    });

    it('clamps ratio to 0-1 range', () => {
      expect(scoreMouse(-0.5)).toBe(90); // clamped to 0
      expect(scoreMouse(1.5)).toBe(0);  // clamped to 1
    });
  });

  describe('scoreTiming', () => {
    it('returns 50 for undefined', () => {
      expect(scoreTiming(undefined)).toBe(50);
    });

    it('returns 10 for <500ms', () => {
      expect(scoreTiming(100)).toBe(10);
      expect(scoreTiming(499)).toBe(10);
    });

    it('returns 25 for 500-999ms', () => {
      expect(scoreTiming(500)).toBe(25);
      expect(scoreTiming(999)).toBe(25);
    });

    it('returns 45 for 1000-1999ms', () => {
      expect(scoreTiming(1000)).toBe(45);
      expect(scoreTiming(1999)).toBe(45);
    });

    it('returns 65 for 2000-3999ms', () => {
      expect(scoreTiming(2000)).toBe(65);
      expect(scoreTiming(3999)).toBe(65);
    });

    it('returns 85 for 4000ms to 10min', () => {
      expect(scoreTiming(4000)).toBe(85);
      expect(scoreTiming(60000)).toBe(85);
      expect(scoreTiming(10 * 60 * 1000)).toBe(85);
    });

    it('returns 55 for >10min', () => {
      expect(scoreTiming(10 * 60 * 1000 + 1)).toBe(55);
      expect(scoreTiming(3600000)).toBe(55);
    });
  });

  describe('scoreKeystroke', () => {
    it('returns 40 for zero keystrokes', () => {
      expect(scoreKeystroke({ totalKeystrokes: 0 })).toBe(40);
    });

    it('returns low score for very few keystrokes (<5)', () => {
      // score = 50 - 15 = 35 for 3 keystrokes (no other penalties apply)
      expect(scoreKeystroke({ totalKeystrokes: 3 })).toBe(35);
    });

    it('returns higher score for >20 keystrokes', () => {
      expect(scoreKeystroke({ totalKeystrokes: 25 })).toBe(60); // 50 + 10
    });

    it('penalizes extreme dwell times', () => {
      const normal = scoreKeystroke({ avgDwellTime: 100, totalKeystrokes: 10 });
      const extreme = scoreKeystroke({ avgDwellTime: 400, totalKeystrokes: 10 });
      expect(extreme).toBeLessThan(normal);
    });

    it('penalizes low dwell variance with many keystrokes', () => {
      const normal = scoreKeystroke({ dwellVariance: 50, totalKeystrokes: 15 });
      const lowVar = scoreKeystroke({ dwellVariance: 3, totalKeystrokes: 15 });
      expect(lowVar).toBeLessThan(normal);
    });

    it('penalizes low flight variance with many keystrokes', () => {
      const normal = scoreKeystroke({ flightVariance: 80, totalKeystrokes: 15 });
      const lowVar = scoreKeystroke({ flightVariance: 5, totalKeystrokes: 15 });
      expect(lowVar).toBeLessThan(normal);
    });

    it('clamps score between 0 and 100', () => {
      const result = scoreKeystroke({});
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(100);
    });
  });

  describe('scoreCanvas', () => {
    it('returns 15 for unsupported canvas', () => {
      expect(scoreCanvas(false, undefined)).toBe(15);
    });

    it('returns 25 for missing hash or error hashes', () => {
      expect(scoreCanvas(true, undefined)).toBe(25);
      expect(scoreCanvas(true, 'unsupported')).toBe(25);
      expect(scoreCanvas(true, 'error')).toBe(25);
      expect(scoreCanvas(true, 'no-context')).toBe(25);
    });

    it('returns 70 for valid canvas hash', () => {
      expect(scoreCanvas(true, 'abc123hash')).toBe(70);
    });
  });

  describe('scoreWebGL', () => {
    it('returns 15 for no WebGL', () => {
      expect(scoreWebGL(false, undefined)).toBe(15);
    });

    it('returns 25 for missing or error renderer', () => {
      expect(scoreWebGL(true, undefined)).toBe(25);
      expect(scoreWebGL(true, 'none')).toBe(25);
      expect(scoreWebGL(true, 'no-context')).toBe(25);
      expect(scoreWebGL(true, 'error')).toBe(25);
    });

    it('returns 30 for software renderers', () => {
      expect(scoreWebGL(true, 'SwiftShader')).toBe(30);
      expect(scoreWebGL(true, 'LLVMpipe')).toBe(30);
    });

    it('returns 75 for real hardware renderers', () => {
      expect(scoreWebGL(true, 'NVIDIA GeForce GTX 1080')).toBe(75);
      expect(scoreWebGL(true, 'Apple GPU')).toBe(75);
    });
  });

  describe('scoreScreen', () => {
    it('returns 20 for missing or zero dimensions', () => {
      expect(scoreScreen(undefined, undefined)).toBe(20);
      expect(scoreScreen(0, 1080)).toBe(20);
      expect(scoreScreen(1920, 0)).toBe(20);
    });

    it('returns 25 for very small screens', () => {
      expect(scoreScreen(300, 200)).toBe(25);
      expect(scoreScreen(319, 239)).toBe(25);
    });

    it('returns 80 for common resolutions', () => {
      expect(scoreScreen(1920, 1080)).toBe(80);
      expect(scoreScreen(1366, 768)).toBe(80);
      expect(scoreScreen(1280, 720)).toBe(80);
    });

    it('returns 60 for uncommon resolutions', () => {
      // 1400x900 is within 50px of 1440x900 (common), so returns 80
      expect(scoreScreen(2000, 1200)).toBe(60);
    });
  });

  describe('scoreNavigator', () => {
    it('returns base score for valid common browser', () => {
      const result = scoreNavigator({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0',
        platform: 'Win32',
        language: 'en-US',
        cookiesEnabled: true,
        hardwareConcurrency: 8,
        maxTouchPoints: 0,
      });
      expect(result).toBeGreaterThan(50);
    });

    it('penalizes missing or short user agent', () => {
      // '': score = 55 - 20 (short ua) - 10 (no cookies) - 10 (cores=0) = 15
      expect(scoreNavigator({ userAgent: '' })).toBe(15);
      // 'unknown': score = 55 - 20 (ua === 'unknown') - 10 (no cookies) - 10 (cores=0) = 15
      expect(scoreNavigator({ userAgent: 'unknown' })).toBe(15);
      // 'abc': score = 55 - 20 (length < 20) - 10 (no cookies) - 10 (cores=0) = 15
      // Note: !undefined = true, so cookiesEnabled undefined still gets -10 penalty
      expect(scoreNavigator({ userAgent: 'abc' })).toBe(15);
    });

    it('heavily penalizes headless browsers', () => {
      // Headless UA: -30 penalty, Chrome: +10 bonus
      const headless = scoreNavigator({ userAgent: 'HeadlessChrome' });
      expect(headless).toBeLessThan(50); // Should be heavily penalized
    });

    it('penalizes missing cookies', () => {
      const withCookies = scoreNavigator({ cookiesEnabled: true });
      const without = scoreNavigator({ cookiesEnabled: false });
      expect(without).toBeLessThan(withCookies);
    });

    it('rewards multiple CPU cores', () => {
      const lowCores = scoreNavigator({ hardwareConcurrency: 1 });
      const highCores = scoreNavigator({ hardwareConcurrency: 8 });
      expect(highCores).toBeGreaterThan(lowCores);
    });

    it('clamps score between 0 and 100', () => {
      const result = scoreNavigator({});
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(100);
    });
  });

  describe('scoreNetwork', () => {
    it('returns base score for no data', () => {
      expect(scoreNetwork(undefined, undefined)).toBe(60);
    });

    it('rewards low latency', () => {
      const low = scoreNetwork(50, undefined);
      const high = scoreNetwork(300, undefined);
      expect(low).toBeGreaterThan(high);
    });

    it('penalizes high latency >500ms', () => {
      expect(scoreNetwork(600, undefined)).toBe(45); // 60 - 15
    });

    it('adjusts based on effective type', () => {
      // slow-2g: base 60, 100ms latency not < 100, so no +10, then -20 for slow-2g = 40
      expect(scoreNetwork(100, 'slow-2g')).toBe(40);
      // 4g: base 60, no latency bonus, +10 for 4g = 70
      expect(scoreNetwork(100, '4g')).toBe(70);
    });

    it('clamps score between 0 and 100', () => {
      const result = scoreNetwork(0, 'slow-2g');
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(100);
    });
  });

  describe('calculateOverallScore', () => {
    it('calculates weighted score correctly', () => {
      const signalScores: SignalScores = {
        mouseScore: 80,
        keyboardScore: 80,
        timingScore: 80,
        canvasScore: 80,
        webglScore: 80,
        screenScore: 80,
        navigatorScore: 80,
        networkScore: 80,
        overallScore: 0,
      };

      // PoW weight 0.35, each signal weight varies
      const result = calculateOverallScore(80, signalScores);
      expect(typeof result).toBe('number');
      expect(result).toBeGreaterThan(0);
      expect(result).toBeLessThanOrEqual(100);
    });

    it('clamps result between 0 and 100', () => {
      const signalScores: SignalScores = {
        mouseScore: 80,
        keyboardScore: 80,
        timingScore: 80,
        canvasScore: 80,
        webglScore: 80,
        screenScore: 80,
        navigatorScore: 80,
        networkScore: 80,
        overallScore: 0,
      };

      const result = calculateOverallScore(150, signalScores); // over 100
      expect(result).toBeLessThanOrEqual(100);
    });
  });

  describe('getVerdict', () => {
    it('returns human for score >= 70', () => {
      expect(getVerdict(70)).toBe('human');
      expect(getVerdict(85)).toBe('human');
      expect(getVerdict(100)).toBe('human');
    });

    it('returns suspicious for score 40-69', () => {
      expect(getVerdict(40)).toBe('suspicious');
      expect(getVerdict(55)).toBe('suspicious');
      expect(getVerdict(69)).toBe('suspicious');
    });

    it('returns bot for score < 40', () => {
      expect(getVerdict(39)).toBe('bot');
      expect(getVerdict(20)).toBe('bot');
      expect(getVerdict(0)).toBe('bot');
    });
  });

  describe('calculateAllScores', () => {
    it('returns all signal scores', () => {
      const behavioral = {
        straightLineRatio: 0.3,
        timeOnPage: 5000,
        avgDwellTime: 100,
        avgFlightTime: 150,
        dwellVariance: 40,
        flightVariance: 60,
        totalKeystrokes: 15,
        isCanvasSupported: true,
        canvasHash: 'validhash123',
        hasWebGL: true,
        webglRenderer: 'NVIDIA RTX 3080',
        screenWidth: 1920,
        screenHeight: 1080,
        userAgent: 'Mozilla/5.0 Chrome/120.0.0.0',
        platform: 'Win32',
        language: 'en-US',
        cookiesEnabled: true,
        hardwareConcurrency: 8,
        maxTouchPoints: 0,
        latencyMs: 50,
        networkType: '4g',
      };

      const result = calculateAllScores(behavioral);

      expect(result.mouseScore).toBeGreaterThan(0);
      expect(result.keyboardScore).toBeGreaterThan(0);
      expect(result.timingScore).toBeGreaterThan(0);
      expect(result.canvasScore).toBeGreaterThan(0);
      expect(result.webglScore).toBeGreaterThan(0);
      expect(result.screenScore).toBeGreaterThan(0);
      expect(result.navigatorScore).toBeGreaterThan(0);
      expect(result.networkScore).toBeGreaterThan(0);
      expect(result.overallScore).toBe(0);
    });

    it('handles empty behavioral data gracefully', () => {
      const result = calculateAllScores({});

      expect(result.mouseScore).toBe(50);    // undefined input
      expect(result.timingScore).toBe(50);  // undefined input
      expect(result.keyboardScore).toBe(40); // 0 keystrokes
      expect(result.canvasScore).toBe(15);  // no canvas
      expect(result.webglScore).toBe(15);   // no webgl
      expect(result.screenScore).toBe(20);  // missing dimensions
    });
  });
});
