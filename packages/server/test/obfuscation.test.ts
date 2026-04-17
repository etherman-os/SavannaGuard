/// <reference types="vitest/globals" />
import crypto from 'crypto';
import { deriveObfKey, deobfuscatePayload } from '../src/services/obfuscation.js';

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

function xorBytes(data: Uint8Array, key: Uint8Array): Uint8Array {
  const result = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) {
    result[i] = data[i] ^ key[i % key.length];
  }
  return result;
}

function bytesToBase64url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return Buffer.from(binary, 'binary').toString('base64url');
}

function obfuscatePayload(payload: object, keyHex: string): string {
  const json = JSON.stringify(payload);
  const jsonBytes = Buffer.from(json, 'utf-8');
  const keyBytes = Buffer.from(keyHex, 'hex');
  const xored = Buffer.alloc(jsonBytes.length);
  for (let i = 0; i < jsonBytes.length; i++) {
    xored[i] = jsonBytes[i] ^ keyBytes[i % keyBytes.length];
  }
  return xored.toString('base64url');
}

describe('obfuscation', () => {
  describe('deriveObfKey', () => {
    it('produces a 64-char hex string', () => {
      const key = deriveObfKey('test-session-id', 'test-challenge-id');
      expect(key).toHaveLength(64);
      expect(key).toMatch(/^[0-9a-f]{64}$/);
    });

    it('is deterministic for the same session ID and challenge ID', () => {
      const key1 = deriveObfKey('session-123', 'challenge-abc');
      const key2 = deriveObfKey('session-123', 'challenge-abc');
      expect(key1).toBe(key2);
    });

    it('produces different keys for different session IDs', () => {
      const key1 = deriveObfKey('session-1', 'challenge-abc');
      const key2 = deriveObfKey('session-2', 'challenge-abc');
      expect(key1).not.toBe(key2);
    });

    it('produces different keys for different challenge IDs (same sessionId)', () => {
      const key1 = deriveObfKey('session-1', 'challenge-abc');
      const key2 = deriveObfKey('session-1', 'challenge-xyz');
      expect(key1).not.toBe(key2);
    });

    it('HMAC key derivation: same sessionId + different challengeId yields different keys', () => {
      // This is the core property for session isolation in the challenge flow.
      // Each challenge gets its own obfKey even within the same session.
      const sessionId = 'test-session-hmac-001';
      const challengeIdA = 'challenge-aaaa-aaaa';
      const challengeIdB = 'challenge-bbbb-bbbb';

      const keyA = deriveObfKey(sessionId, challengeIdA);
      const keyB = deriveObfKey(sessionId, challengeIdB);

      expect(keyA).not.toBe(keyB);

      // XOR with keyA should NOT produce valid JSON when decoded with keyB
      const payload = { testData: 'sensitive-value' };
      const jsonBytes = Buffer.from(JSON.stringify(payload));
      const keyBytesA = Buffer.from(keyA, 'hex');
      const keyBytesB = Buffer.from(keyB, 'hex');

      const xoredWithA = Buffer.alloc(jsonBytes.length);
      for (let i = 0; i < jsonBytes.length; i++) {
        xoredWithA[i] = jsonBytes[i] ^ keyBytesA[i % keyBytesA.length];
      }
      const encodedA = xoredWithA.toString('base64url');

      // Decoding with wrong key (keyB instead of keyA) should produce garbage
      const xoredWithB = Buffer.from(encodedA, 'base64url');
      const decodedWithKeyB = Buffer.alloc(xoredWithB.length);
      for (let i = 0; i < xoredWithB.length; i++) {
        decodedWithKeyB[i] = xoredWithB[i] ^ keyBytesB[i % keyBytesB.length];
      }
      expect(() => JSON.parse(decodedWithKeyB.toString('utf-8'))).toThrow();
    });

    it('HMAC key derivation: different sessionId + same challengeId yields different keys', () => {
      const sessionIdA = 'session-alpha-alpha';
      const sessionIdB = 'session-beta-beta';
      const challengeId = 'challenge-same-for-both';

      const keyA = deriveObfKey(sessionIdA, challengeId);
      const keyB = deriveObfKey(sessionIdB, challengeId);

      expect(keyA).not.toBe(keyB);
    });

    it('HMAC key derivation: challengeId with special characters works correctly', () => {
      const sessionId = 'session-special';
      const challengeId1 = 'challenge-with-dashes_and_underscores';
      const challengeId2 = 'challenge/with/slashes';

      const key1 = deriveObfKey(sessionId, challengeId1);
      const key2 = deriveObfKey(sessionId, challengeId2);

      expect(key1).toHaveLength(64);
      expect(key2).toHaveLength(64);
      expect(key1).not.toBe(key2);

      // Both keys should still produce valid XOR roundtrips
      const payload = { data: 'test' };
      const encoded1 = obfuscatePayload(payload, key1);
      const decoded1 = deobfuscatePayload(encoded1, key1);
      expect(JSON.parse(decoded1)).toEqual(payload);
    });
  });

  describe('deobfuscatePayload', () => {
    it('roundtrips obfuscation correctly', () => {
      const payload = {
        mouseData: { straightLineRatio: 0.73, velocity: 245.5, directionChanges: 12 },
        timingData: { timeOnPageMs: 45000 },
      };
      const sessionId = 'test-session-roundtrip';
      const challengeId = 'test-challenge-roundtrip';
      const obfKey = deriveObfKey(sessionId, challengeId);
      const obfuscated = obfuscatePayload(payload, obfKey);
      const decoded = deobfuscatePayload(obfuscated, obfKey);
      expect(JSON.parse(decoded)).toEqual(payload);
    });

    it('handles empty payload', () => {
      const payload = {};
      const sessionId = 'test-empty-payload';
      const challengeId = 'test-challenge-empty';
      const obfKey = deriveObfKey(sessionId, challengeId);
      const obfuscated = obfuscatePayload(payload, obfKey);
      const decoded = deobfuscatePayload(obfuscated, obfKey);
      expect(JSON.parse(decoded)).toEqual({});
    });

    it('handles full behavioral payload', () => {
      const payload = {
        mouseData: { straightLineRatio: 0.5, velocity: 100, maxVelocity: 500, directionChanges: 8 },
        timingData: { timeOnPageMs: 30000 },
        keyboardData: { avgDwellTime: 87.3, avgFlightTime: 45.2, dwellVariance: 15.1, flightVariance: 10.3, totalKeystrokes: 42 },
        canvasData: { canvasHash: 'a1b2c3d4', isCanvasSupported: true },
        webglData: { renderer: 'ANGLE (NVIDIA)', vendor: 'Google', hasWebGL: true },
        screenData: { width: 1920, height: 1080, colorDepth: 24, pixelRatio: 1 },
        navigatorData: { userAgent: 'Mozilla/5.0', platform: 'Win32', language: 'en-US', timezone: 'America/New_York', timezoneOffset: -240, hardwareConcurrency: 8, maxTouchPoints: 0 },
        networkData: { latencyMs: 45, effectiveType: '4g', downlink: 10.5 },
        timingOracleData: { performanceNowMonotonic: true, setTimeoutDriftMs: 2.5, headlessLikelihood: 5, detectionSignals: ['no_headless'] },
        tremorData: { dominantFrequencyHz: 9.2, tremorPowerRatio: 0.15, spectralEntropy: 0.72, sampleCount: 150 },
        webrtcOracleData: { iceCandidateCount: 3, localIPCount: 2, likelyDatacenter: false, collected: true },
      };
      const sessionId = 'test-full-payload';
      const challengeId = 'test-challenge-full';
      const obfKey = deriveObfKey(sessionId, challengeId);
      const obfuscated = obfuscatePayload(payload, obfKey);
      const decoded = deobfuscatePayload(obfuscated, obfKey);
      expect(JSON.parse(decoded)).toEqual(payload);
    });

    it('fails to decode with wrong key', () => {
      const payload = { mouseData: { straightLineRatio: 0.73 } };
      const sessionId1 = 'session-correct';
      const sessionId2 = 'session-wrong';
      const challengeId = 'test-challenge-wrong';
      const obfKey1 = deriveObfKey(sessionId1, challengeId);
      const obfKey2 = deriveObfKey(sessionId2, challengeId);
      const obfuscated = obfuscatePayload(payload, obfKey1);
      const decoded = deobfuscatePayload(obfuscated, obfKey2);
      expect(() => JSON.parse(decoded)).toThrow();
    });

    it('handles special characters in payload', () => {
      const payload = {
        navigatorData: { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', language: 'en-US' },
        screenData: { width: 1920, height: 1080 },
      };
      const sessionId = 'test-special';
      const challengeId = 'test-challenge-special';
      const obfKey = deriveObfKey(sessionId, challengeId);
      const obfuscated = obfuscatePayload(payload, obfKey);
      const decoded = deobfuscatePayload(obfuscated, obfKey);
      expect(JSON.parse(decoded)).toEqual(payload);
    });

    it('handles unicode characters in payload', () => {
      const payload = { navigatorData: { language: 'zh-CN', timezone: 'Asia/Shanghai' } };
      const sessionId = 'test-unicode';
      const challengeId = 'test-challenge-unicode';
      const obfKey = deriveObfKey(sessionId, challengeId);
      const obfuscated = obfuscatePayload(payload, obfKey);
      const decoded = deobfuscatePayload(obfuscated, obfKey);
      expect(JSON.parse(decoded)).toEqual(payload);
    });

    it('produces base64url output without + / = characters', () => {
      const payload = { test: 'data' };
      const sessionId = 'test-b64url';
      const challengeId = 'test-challenge-b64url';
      const obfKey = deriveObfKey(sessionId, challengeId);
      const obfuscated = obfuscatePayload(payload, obfKey);
      expect(obfuscated).not.toMatch(/\+/);
      expect(obfuscated).not.toMatch(/\//);
      expect(obfuscated).not.toMatch(/=/);
    });

    it('obfuscated output is not readable as JSON', () => {
      const payload = { mouseData: { straightLineRatio: 0.73 } };
      const sessionId = 'test-unreadable';
      const challengeId = 'test-challenge-unreadable';
      const obfKey = deriveObfKey(sessionId, challengeId);
      const obfuscated = obfuscatePayload(payload, obfKey);
      expect(() => JSON.parse(obfuscated)).toThrow();
    });

    it('XOR roundtrip: 10KB large JSON payload with repetitive data', () => {
      // Generate a 10KB+ payload with lots of repetitive structure
      const largePayload = {
        mouseData: Array.from({ length: 50 }, (_, i) => ({
          sampleIndex: i,
          straightLineRatio: 0.1 + (i % 10) * 0.08,
          velocity: 100 + (i * 7) % 500,
          maxVelocity: 200 + (i * 13) % 800,
          directionChanges: 2 + (i % 15),
          timestamp: Date.now() + i * 100,
        })),
        timingData: {
          timeOnPageMs: 45000,
          segments: Array.from({ length: 20 }, (_, i) => ({
            segmentIndex: i,
            durationMs: 1000 + (i * 50) % 5000,
          })),
        },
        keyboardData: {
          keyStrokes: Array.from({ length: 100 }, (_, i) => ({
            keyIndex: i,
            dwellTime: 50 + (i * 3) % 150,
            flightTime: 80 + (i * 5) % 200,
          })),
        },
      };

      const sessionId = 'test-large-payload';
      const challengeId = 'test-challenge-large';
      const obfKey = deriveObfKey(sessionId, challengeId);

      const jsonString = JSON.stringify(largePayload);
      expect(jsonString.length).toBeGreaterThan(9000); // Ensure it's actually large

      const obfuscated = obfuscatePayload(largePayload, obfKey);
      expect(obfuscated.length).toBeGreaterThan(7000); // base64url adds overhead but should be < 14KB

      const decoded = deobfuscatePayload(obfuscated, obfKey);
      const reparsed = JSON.parse(decoded);

      expect(reparsed).toEqual(largePayload);
    });

    it('XOR roundtrip: 100KB very large payload with maximum repetition', () => {
      // Stress test with a very large payload
      const veryLargePayload = {
        data: Array.from({ length: 500 }, (_, i) => ({
          id: i,
          label: `item-${i}-`.repeat(10), // repetitive string
          values: Array(20).fill(i * 1.5),
          nested: {
            a: 'AAAAAAAAAA',
            b: 'BBBBBBBBBB',
            c: Array(10).fill({ x: 1, y: 2 }),
          },
        })),
      };

      const sessionId = 'test-very-large';
      const challengeId = 'test-challenge-very-large';
      const obfKey = deriveObfKey(sessionId, challengeId);

      const jsonString = JSON.stringify(veryLargePayload);
      expect(jsonString.length).toBeGreaterThan(50000); // definitely > 50KB

      const obfuscated = obfuscatePayload(veryLargePayload, obfKey);
      const decoded = deobfuscatePayload(obfuscated, obfKey);
      const reparsed = JSON.parse(decoded);

      expect(reparsed).toEqual(veryLargePayload);
    });

    it('Unicode handling: emoji characters survive roundtrip', () => {
      const payload = {
        screenData: { width: 1920, height: 1080 },
        navigatorData: {
          userAgent: 'Mozilla/5.0 🐱🐶💻🔐',
          language: 'en-US',
          platform: 'TestPlatform',
        },
        note: 'Test with various emoji: 🎉🎄🎯🚀👾',
        unicodeStrings: [
          '✓ valid',
          '中文测试',
          '한국어',
          'العربية',
          'עברית',
          '🎊🎉🎈🎁🎂',
          'U+1F600 😀 U+1F913 🤓',
          'mixed: abc123 اَلْفَبَاء 🐱 def456',
        ],
      };

      const sessionId = 'test-emoji';
      const challengeId = 'test-challenge-emoji';
      const obfKey = deriveObfKey(sessionId, challengeId);

      const obfuscated = obfuscatePayload(payload, obfKey);
      const decoded = deobfuscatePayload(obfuscated, obfKey);
      const reparsed = JSON.parse(decoded);

      expect(reparsed).toEqual(payload);
      expect(reparsed.navigatorData.userAgent).toBe('Mozilla/5.0 🐱🐶💻🔐');
      expect(reparsed.unicodeStrings[2]).toBe('한국어');
      expect(reparsed.unicodeStrings[6]).toBe('U+1F600 😀 U+1F913 🤓');
    });

    it('Unicode handling: broken/malformed UA strings with replacement characters', () => {
      // Simulates real-world broken UA strings with invalid UTF sequences
      const payload = {
        navigatorData: {
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36\x00\xff\xfe(KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          language: 'en-US',
          platform: 'Win32',
        },
        brokenStrings: [
          '\u0000\u001b\u007f', // control chars
          'Line1\nLine2\r\nLine3', // line endings
          'Tab\there\tcolumns', // tabs
          '\u00a0\u2003\u3000', // various spaces (non-breaking, em, ideographic)
        ],
      };

      const sessionId = 'test-broken-ua';
      const challengeId = 'test-challenge-broken-ua';
      const obfKey = deriveObfKey(sessionId, challengeId);

      const obfuscated = obfuscatePayload(payload, obfKey);
      const decoded = deobfuscatePayload(obfuscated, obfKey);
      const reparsed = JSON.parse(decoded);

      expect(reparsed.navigatorData.userAgent).toBe(payload.navigatorData.userAgent);
      expect(reparsed.brokenStrings[1]).toBe('Line1\nLine2\r\nLine3');
      expect(reparsed.brokenStrings[3]).toBe('\u00a0\u2003\u3000');
    });

    it('Unicode handling: Chinese/CJK characters and mixed scripts', () => {
      const payload = {
        description: '多语言测试 - Multilingual Test -_multi-lingual',
        cjkContent: {
          simplifiedChinese: '简体中文：今天的天气非常好。',
          traditionalChinese: '繁體中文：今天的氣候非常棒。',
          japanese: '日本語：今日は素晴らしい天気です。',
          korean: '한국어：오늘 날씨가 정말 좋네요。',
        },
        mixedScript: 'English 中文 日本語 한국어 العربية עברית',
      };

      const sessionId = 'test-cjk';
      const challengeId = 'test-challenge-cjk';
      const obfKey = deriveObfKey(sessionId, challengeId);

      const obfuscated = obfuscatePayload(payload, obfKey);
      const decoded = deobfuscatePayload(obfuscated, obfKey);
      const reparsed = JSON.parse(decoded);

      expect(reparsed).toEqual(payload);
      expect(reparsed.cjkContent.traditionalChinese).toBe('繁體中文：今天的氣候非常棒。');
      expect(reparsed.mixedScript).toBe('English 中文 日本語 한국어 العربية עברית');
    });

    it('Unicode handling: null bytes and binary-like data', () => {
      // Binary-safe: null bytes and non-printable characters should survive XOR
      const payload = {
        binaryPayload: {
          nullPadded: 'test\x00\x00\x00data',
          binarySequence: '\x01\x02\x03\x04\xff\xfe\xfd',
          mixedBinary: 'Hello\x00World\xff\xfe\xfd',
        },
      };

      const sessionId = 'test-binary';
      const challengeId = 'test-challenge-binary';
      const obfKey = deriveObfKey(sessionId, challengeId);

      const obfuscated = obfuscatePayload(payload, obfKey);
      const decoded = deobfuscatePayload(obfuscated, obfKey);
      const reparsed = JSON.parse(decoded);

      expect(reparsed.binaryPayload.nullPadded).toBe('test\x00\x00\x00data');
      expect(reparsed.binaryPayload.binarySequence).toBe('\x01\x02\x03\x04\xff\xfe\xfd');
      expect(reparsed.binaryPayload.mixedBinary).toBe('Hello\x00World\xff\xfe\xfd');
    });
  });
});