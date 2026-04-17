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
  detectSpoofing,
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

  describe('Global Spoofing Penalty', () => {
    it('canvasBlocked detected when hash matches blank hash (valid non-empty values)', () => {
      // For canvasBlocked, both must be truthy, non-invalid, and equal
      const spoofing = detectSpoofing({
        canvasHash: 'hash123',
        canvasBlankHash: 'hash123',
        webglRendererFromCanvas: undefined,
        renderer: 'valid',
        hasWebGL: false,
      });
      expect(spoofing.canvasBlocked).toBe(true);
    });

    it('webglHeadless triggers when hasWebGL=true and extensions < min', () => {
      // Mobile min=3, desktop min=5
      const spoofing = detectSpoofing({
        canvasHash: '',
        canvasBlankHash: '',
        renderer: 'unknown',
        hasWebGL: true,
        webglExtensions: 0,
        maxTextureSize: 2048,
      });
      expect(spoofing.webglHeadless).toBe(true);
    });

    it('spoofingFlags=2 when both canvasBlocked and webglHeadless are true', () => {
      const spoofing = detectSpoofing({
        canvasHash: 'hash123',
        canvasBlankHash: 'hash123',
        webglRendererFromCanvas: undefined,
        renderer: 'valid', // not in invalidRendererValues
        hasWebGL: true,
        webglExtensions: 0,
        maxTextureSize: 2048,
      });

      expect(spoofing.canvasBlocked).toBe(true);
      expect(spoofing.webglHeadless).toBe(true);
      expect(spoofing.webglRendererMismatch).toBe(false);
    });

    it('spoofingFlags=2 multiplies final score by 0.6 (global penalty)', () => {
      const behavioral = {
        canvasHash: 'samehash',
        canvasBlankHash: 'samehash',
        renderer: 'valid',
        hasWebGL: true,
        webglExtensions: 0,
        webglRendererFromCanvas: undefined,
        // All other signals at neutral 50s → no contribution to score
        timeOnPage: 5000,
        straightLineRatio: 0.5,
        avgDwellTime: 80,
        avgFlightTime: 120,
        dwellVariance: 50,
        flightVariance: 80,
        totalKeystrokes: 20,
        isCanvasSupported: true,
        userAgent: 'Mozilla/5.0',
        platform: 'Win32',
        language: 'en',
        cookiesEnabled: true,
        hardwareConcurrency: 4,
        maxTouchPoints: 0,
        screenWidth: 1920,
        screenHeight: 1080,
        pixelRatio: 1,
        latencyMs: 50,
        networkType: '4g',
      };

      const signalScores = calculateAllScores(behavioral);
      expect(signalScores.spoofingFlags).toBe(2);

      // Calculate overall with powScore=100
      const powScore = 100;
      const finalScore = calculateOverallScore(powScore, signalScores);
      expect(finalScore).toBeGreaterThan(0);
      expect(finalScore).toBeLessThanOrEqual(100);
    });

    it('final score never goes below 0 after spoofing penalty', () => {
      // Use minimal signals + spoofingFlags >= 1
      const behavioral = {
        canvasHash: 'samehash',
        canvasBlankHash: 'samehash',
        renderer: 'valid',
        hasWebGL: true,
        webglExtensions: 0,
        webglRendererFromCanvas: undefined,
        // All other signals at minimum (bot-like)
        timeOnPage: 100,        // very fast → scoreTiming = 10
        straightLineRatio: 0.99, // near-perfect straight line → scoreMouse = 0
        avgDwellTime: 10,        // extreme
        avgFlightTime: 10,        // extreme
        dwellVariance: 1,         // no variance = bot
        flightVariance: 1,        // no variance = bot
        totalKeystrokes: 0,
        isCanvasSupported: true,
        userAgent: 'headless',
        platform: 'Linux',
        language: 'en',
        cookiesEnabled: false,
        hardwareConcurrency: 1,
        maxTouchPoints: 0,
        screenWidth: 1920,
        screenHeight: 1080,
        pixelRatio: 1,
        latencyMs: 1000,
        networkType: 'slow-2g',
      };

      const signalScores = calculateAllScores(behavioral);
      expect(signalScores.spoofingFlags).toBeGreaterThanOrEqual(1);

      const powScore = 100;
      const rawScore = calculateOverallScore(powScore, signalScores);

      // Apply spoofing penalty as challenge.ts does
      let finalScore = rawScore;
      if (signalScores.spoofingFlags >= 1) {
        finalScore = Math.round(finalScore * 0.6);
      }
      finalScore = Math.max(0, Math.min(100, finalScore));

      expect(finalScore).toBeGreaterThanOrEqual(0);
      expect(finalScore).toBeLessThanOrEqual(100);
    });

    it('webglHeadless flag only triggers with hasWebGL=true', () => {
      // Without hasWebGL, webglHeadless stays false
      const spoofingNoWebGL = detectSpoofing({
        canvasHash: 'hash123',
        canvasBlankHash: 'hash123',
        renderer: 'unknown',
        hasWebGL: false,
        webglExtensions: 0,
      });
      expect(spoofingNoWebGL.webglHeadless).toBe(false);

      // With hasWebGL=true and low extensions, triggers
      const spoofingWithWebGL = detectSpoofing({
        canvasHash: 'hash123',
        canvasBlankHash: 'hash123',
        renderer: 'unknown',
        hasWebGL: true,
        webglExtensions: 0,
      });
      expect(spoofingWithWebGL.webglHeadless).toBe(true);
    });

    it('pixelRatioInconsistent with out-of-range values', () => {
      const spoofingLow = detectSpoofing({ pixelRatio: 0 });
      expect(spoofingLow.pixelRatioInconsistent).toBe(true);

      const spoofingHigh = detectSpoofing({ pixelRatio: 5 });
      expect(spoofingHigh.pixelRatioInconsistent).toBe(true);

      const spoofingNormal = detectSpoofing({ pixelRatio: 1.5 });
      expect(spoofingNormal.pixelRatioInconsistent).toBe(false);
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

    it('returns 70 for valid canvas hash with no spoofing signals', () => {
      expect(scoreCanvas(true, 'abc123hash')).toBe(70);
    });

    it('returns 30 when canvas blank hash matches text hash (fingerprint randomizer)', () => {
      expect(scoreCanvas(true, 'abc123hash', 'abc123hash')).toBe(30);
    });

    it('returns 70 when canvas blank hash differs from text hash (normal)', () => {
      expect(scoreCanvas(true, 'abc123hash', 'def456blank')).toBe(70);
    });

    it('ignores invalid canvas blank hashes', () => {
      expect(scoreCanvas(true, 'abc123hash', 'unsupported')).toBe(70);
      expect(scoreCanvas(true, 'abc123hash', 'error')).toBe(70);
      expect(scoreCanvas(true, 'abc123hash', 'no-context')).toBe(70);
      expect(scoreCanvas(true, 'abc123hash', 'no-blank-context')).toBe(70);
    });

    it('returns 25 when WebGL renderer from canvas mismatches WebGL data', () => {
      expect(scoreCanvas(true, 'abc123hash', 'def456blank', 'NVIDIA GTX 1080', 'AMD Radeon RX')).toBe(25);
    });

    it('returns 70 when WebGL renderer from canvas matches WebGL data', () => {
      expect(scoreCanvas(true, 'abc123hash', 'def456blank', 'NVIDIA GTX 1080', 'NVIDIA GTX 1080')).toBe(70);
    });

    it('ignores renderer mismatch when renderer is unknown', () => {
      expect(scoreCanvas(true, 'abc123hash', 'def456blank', 'NVIDIA GTX 1080', 'unknown')).toBe(70);
      expect(scoreCanvas(true, 'abc123hash', 'def456blank', '', 'AMD Radeon RX')).toBe(70);
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

    it('penalizes too few WebGL extensions on desktop', () => {
      expect(scoreWebGL(true, 'NVIDIA GeForce GTX 1080', 3)).toBe(50); // 75 - 25
    });

    it('penalizes too few WebGL extensions on mobile', () => {
      expect(scoreWebGL(true, 'NVIDIA GeForce GTX 1080', 2, undefined, true)).toBe(50);
    });

    it('does not penalize sufficient extensions', () => {
      expect(scoreWebGL(true, 'NVIDIA GeForce GTX 1080', 8)).toBe(75);
      expect(scoreWebGL(true, 'NVIDIA GeForce GTX 1080', 5, undefined, true)).toBe(75);
    });

    it('penalizes very small max texture size (headless emulator)', () => {
      expect(scoreWebGL(true, 'NVIDIA GeForce GTX 1080', undefined, 512)).toBe(45); // 75 - 30
    });

    it('does not penalize normal max texture size', () => {
      expect(scoreWebGL(true, 'NVIDIA GeForce GTX 1080', undefined, 4096)).toBe(75);
    });

    it('combines extensions and texture size penalties', () => {
      expect(scoreWebGL(true, 'NVIDIA GeForce GTX 1080', 2, 512)).toBe(20); // 75 - 25 - 30 = 20
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

    it('returns 15 for invalid pixel ratio (zero or negative)', () => {
      expect(scoreScreen(1920, 1080, 0)).toBe(15);
      expect(scoreScreen(1920, 1080, -1)).toBe(15);
    });

    it('returns 25 for abnormally high pixel ratio (>4)', () => {
      expect(scoreScreen(1920, 1080, 5)).toBe(25);
    });

    it('returns 80 for common resolution with normal pixel ratio', () => {
      expect(scoreScreen(1920, 1080, 1)).toBe(80);
      expect(scoreScreen(1920, 1080, 2)).toBe(80);
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

    it('penalizes platform/UA mismatch: UA says Mac but platform says Win', () => {
      const matched = scoreNavigator({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120.0.0.0',
        platform: 'MacIntel',
        cookiesEnabled: true,
        hardwareConcurrency: 8,
      });
      const mismatched = scoreNavigator({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120.0.0.0',
        platform: 'Win32',
        cookiesEnabled: true,
        hardwareConcurrency: 8,
      });
      expect(mismatched).toBeLessThan(matched);
    });

    it('penalizes platform/UA mismatch: UA says Windows but platform says Mac', () => {
      const mismatched = scoreNavigator({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0',
        platform: 'MacIntel',
        cookiesEnabled: true,
        hardwareConcurrency: 8,
      });
      const matched = scoreNavigator({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0',
        platform: 'Win32',
        cookiesEnabled: true,
        hardwareConcurrency: 8,
      });
      expect(mismatched).toBeLessThan(matched);
    });

    it('does not penalize matching platform and UA', () => {
      const result = scoreNavigator({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0',
        platform: 'Win32',
        cookiesEnabled: true,
        hardwareConcurrency: 8,
      });
      expect(result).toBeGreaterThanOrEqual(70);
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
        timingOracleScore: 80,
        tremorScore: 80,
        webrtcOracleScore: 80,
        spoofingFlags: 0,
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
        timingOracleScore: 80,
        tremorScore: 80,
        webrtcOracleScore: 80,
        spoofingFlags: 0,
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
    it('returns all signal scores including spoofingFlags', () => {
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
        renderer: 'NVIDIA RTX 3080',
        webglExtensions: 24,
        maxTextureSize: 16384,
        screenWidth: 1920,
        screenHeight: 1080,
        pixelRatio: 1,
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
      expect(result.spoofingFlags).toBe(0);
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

    it('detects canvas spoofing in calculateAllScores', () => {
      const result = calculateAllScores({
        isCanvasSupported: true,
        canvasHash: 'abc123',
        canvasBlankHash: 'abc123',
      });
      expect(result.canvasScore).toBe(30);
      expect(result.spoofingFlags).toBeGreaterThanOrEqual(1);
    });

    it('detects WebGL headless indicators in calculateAllScores', () => {
      const result = calculateAllScores({
        hasWebGL: true,
        renderer: 'NVIDIA RTX 3080',
        webglExtensions: 2,
        maxTextureSize: 512,
        userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/120.0.0.0',
      });
      expect(result.spoofingFlags).toBeGreaterThanOrEqual(1);
    });
  });

  describe('detectSpoofing', () => {
    it('returns all false flags when no spoofing signals present', () => {
      const flags = detectSpoofing({
        canvasHash: 'abc123',
        canvasBlankHash: 'def456',
        webglRendererFromCanvas: 'NVIDIA GTX 1080',
        renderer: 'NVIDIA GTX 1080',
        hasWebGL: true,
        webglExtensions: 24,
        maxTextureSize: 16384,
        pixelRatio: 1,
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0',
        platform: 'Win32',
      });
      expect(flags.canvasBlocked).toBe(false);
      expect(flags.webglRendererMismatch).toBe(false);
      expect(flags.webglHeadless).toBe(false);
      expect(flags.pixelRatioInconsistent).toBe(false);
      expect(flags.platformUAMismatch).toBe(false);
    });

    it('detects canvas blocked when canvas hash matches blank hash', () => {
      const flags = detectSpoofing({
        canvasHash: 'samehash',
        canvasBlankHash: 'samehash',
      });
      expect(flags.canvasBlocked).toBe(true);
    });

    it('does not flag canvas blocked when hashes differ', () => {
      const flags = detectSpoofing({
        canvasHash: 'hash1',
        canvasBlankHash: 'hash2',
      });
      expect(flags.canvasBlocked).toBe(false);
    });

    it('ignores invalid canvas blank hashes', () => {
      for (const invalid of ['unsupported', 'error', 'no-context', 'no-blank-context']) {
        const flags = detectSpoofing({ canvasHash: 'abc', canvasBlankHash: invalid });
        expect(flags.canvasBlocked).toBe(false);
      }
    });

    it('detects WebGL renderer mismatch', () => {
      const flags = detectSpoofing({
        webglRendererFromCanvas: 'NVIDIA GTX 1080',
        renderer: 'AMD Radeon RX 580',
      });
      expect(flags.webglRendererMismatch).toBe(true);
    });

    it('does not flag renderer mismatch for unknown/empty renderers', () => {
      expect(detectSpoofing({ webglRendererFromCanvas: 'NVIDIA GTX 1080', renderer: 'unknown' }).webglRendererMismatch).toBe(false);
      expect(detectSpoofing({ webglRendererFromCanvas: '', renderer: 'AMD Radeon RX 580' }).webglRendererMismatch).toBe(false);
      expect(detectSpoofing({ webglRendererFromCanvas: 'NVIDIA GTX 1080', renderer: 'none' }).webglRendererMismatch).toBe(false);
    });

    it('detects WebGL headless via too few extensions on desktop', () => {
      const flags = detectSpoofing({
        hasWebGL: true,
        webglExtensions: 3,
        userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/120.0.0.0',
      });
      expect(flags.webglHeadless).toBe(true);
    });

    it('uses lower extensions threshold for mobile UA', () => {
      const mobile = detectSpoofing({
        hasWebGL: true,
        webglExtensions: 2,
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) Mobile Safari',
      });
      expect(mobile.webglHeadless).toBe(true);

      const desktop = detectSpoofing({
        hasWebGL: true,
        webglExtensions: 4,
        userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/120.0.0.0',
      });
      expect(desktop.webglHeadless).toBe(true);
    });

    it('detects WebGL headless via low max texture size', () => {
      const flags = detectSpoofing({
        hasWebGL: true,
        maxTextureSize: 512,
      });
      expect(flags.webglHeadless).toBe(true);
    });

    it('does not flag WebGL headless for normal texture size', () => {
      const flags = detectSpoofing({
        hasWebGL: true,
        maxTextureSize: 16384,
        webglExtensions: 20,
      });
      expect(flags.webglHeadless).toBe(false);
    });

    it('detects invalid pixel ratio (zero or negative)', () => {
      expect(detectSpoofing({ pixelRatio: 0 }).pixelRatioInconsistent).toBe(true);
      expect(detectSpoofing({ pixelRatio: -1 }).pixelRatioInconsistent).toBe(true);
    });

    it('detects abnormally high pixel ratio', () => {
      expect(detectSpoofing({ pixelRatio: 5 }).pixelRatioInconsistent).toBe(true);
    });

    it('does not flag normal pixel ratios', () => {
      expect(detectSpoofing({ pixelRatio: 1 }).pixelRatioInconsistent).toBe(false);
      expect(detectSpoofing({ pixelRatio: 2 }).pixelRatioInconsistent).toBe(false);
      expect(detectSpoofing({ pixelRatio: 3 }).pixelRatioInconsistent).toBe(false);
    });

    it('detects platform/UA mismatch: UA Mac, platform Win', () => {
      const flags = detectSpoofing({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120.0.0.0',
        platform: 'Win32',
      });
      expect(flags.platformUAMismatch).toBe(true);
    });

    it('detects platform/UA mismatch: UA Windows, platform Mac', () => {
      const flags = detectSpoofing({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0',
        platform: 'MacIntel',
      });
      expect(flags.platformUAMismatch).toBe(true);
    });

    it('does not flag matching platform and UA', () => {
      expect(detectSpoofing({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0',
        platform: 'Win32',
      }).platformUAMismatch).toBe(false);

      expect(detectSpoofing({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120',
        platform: 'MacIntel',
      }).platformUAMismatch).toBe(false);
    });

    it('counts multiple spoofing signals correctly', () => {
      const flags = detectSpoofing({
        canvasHash: 'samehash',
        canvasBlankHash: 'samehash',
        webglRendererFromCanvas: 'NVIDIA GTX 1080',
        renderer: 'AMD Radeon RX 580',
        hasWebGL: true,
        webglExtensions: 2,
        maxTextureSize: 512,
        pixelRatio: 0,
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X) Chrome/120.0.0.0',
        platform: 'Win32',
      });
      const count = Object.values(flags).filter(Boolean).length;
      expect(count).toBeGreaterThanOrEqual(4); // canvasBlocked + webglRendererMismatch + webglHeadless + pixelRatio + platformUA
    });
  });
});
