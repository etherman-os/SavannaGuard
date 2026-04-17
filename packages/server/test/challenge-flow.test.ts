import crypto from 'crypto';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/index.js';
import { deriveObfKey } from '../src/services/obfuscation.js';

interface ChallengeCreateResponse {
  challengeId: string;
  nonce: string;
  difficulty: number;
  sessionId: string;
  obfKey: string;
}

interface ChallengeSolveResponse {
  success: boolean;
  token: string | null;
  score: number;
  verdict: string;
  federatedSource: boolean;
}

interface TokenValidateResponse {
  valid: boolean;
  verdict: string;
  score: number;
}

function solvePow(nonce: string, difficulty: number): string {
  let candidate = 0;
  while (candidate < 40_000_000) {
    const hash = crypto.createHash('sha256').update(nonce + String(candidate)).digest('hex');
    if (hash.slice(0, difficulty) === '0'.repeat(difficulty)) {
      return String(candidate);
    }
    candidate += 1;
  }
  throw new Error('Could not solve PoW within test iteration limit');
}

// Helper that mirrors the widget's actual flow:
// 1. Derive obfKey using HMAC-SHA256(sessionId + challengeId)
// 2. XOR the payload with the derived key
function obfuscatePayload(payload: object, sessionId: string, challengeId: string): string {
  const obfKey = deriveObfKey(sessionId, challengeId);
  const json = JSON.stringify(payload);
  const jsonBytes = Buffer.from(json, 'utf-8');
  const keyBytes = Buffer.from(obfKey, 'hex');
  const xored = Buffer.alloc(jsonBytes.length);
  for (let i = 0; i < jsonBytes.length; i++) {
    xored[i] = jsonBytes[i] ^ keyBytes[i % keyBytes.length];
  }
  return xored.toString('base64url');
}

function makeBehavioralPayload() {
  return {
    mouseData: { straightLineRatio: 0.2, velocity: 150, maxVelocity: 500, directionChanges: 5 },
    timingData: { timeOnPageMs: 2600 },
    keyboardData: { avgDwellTime: 85, avgFlightTime: 40, dwellVariance: 12, flightVariance: 8, totalKeystrokes: 20 },
    canvasData: { canvasHash: 'abc12345', isCanvasSupported: true },
    webglData: { renderer: 'Test GPU', vendor: 'Test Vendor', hasWebGL: true },
    screenData: { width: 1920, height: 1080, colorDepth: 24, pixelRatio: 1 },
    navigatorData: { userAgent: 'TestAgent', platform: 'TestPlatform', language: 'en', timezone: 'UTC', timezoneOffset: 0, hardwareConcurrency: 4, maxTouchPoints: 0 },
    networkData: { latencyMs: 50, effectiveType: '4g', downlink: 10 },
  };
}

describe('challenge flow', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = buildServer();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates challenge with obfKey, solves with obfuscated payload and validates token', async () => {
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/challenge/create',
      payload: {},
    });

    expect(createResponse.statusCode).toBe(200);
    const created = createResponse.json() as ChallengeCreateResponse;
    expect(created.obfKey).toBeDefined();
    expect(created.obfKey).toHaveLength(64);
    expect(created.obfKey).toMatch(/^[0-9a-f]{64}$/);

    const solution = solvePow(created.nonce, created.difficulty);
    const behavioralPayload = makeBehavioralPayload();
    const d = obfuscatePayload(behavioralPayload, created.sessionId, created.challengeId);

    const solveResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/challenge/solve',
      payload: {
        challengeId: created.challengeId,
        sessionId: created.sessionId,
        solution,
        d,
      },
    });

    expect(solveResponse.statusCode).toBe(200);
    const solved = solveResponse.json() as ChallengeSolveResponse;
    expect(solved.success).toBe(true);
    expect(typeof solved.token).toBe('string');
    expect(solved.federatedSource).toBe(false);

    const validateResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/token/validate',
      payload: { token: solved.token },
    });

    expect(validateResponse.statusCode).toBe(200);
    const validated = validateResponse.json() as TokenValidateResponse;
    expect(validated.valid).toBe(true);
  });

  it('obfKey is deterministic and matches deriveObfKey', async () => {
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/challenge/create',
      payload: {},
    });

    const created = createResponse.json() as ChallengeCreateResponse;
    const expectedKey = deriveObfKey(created.sessionId, created.challengeId);
    expect(created.obfKey).toBe(expectedKey);
  });

  it('rejects invalid obfuscated payload encoding', async () => {
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/challenge/create',
      payload: {},
    });

    const created = createResponse.json() as ChallengeCreateResponse;
    const solution = solvePow(created.nonce, created.difficulty);

    const solveResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/challenge/solve',
      payload: {
        challengeId: created.challengeId,
        sessionId: created.sessionId,
        solution,
        d: 'this-is-not-valid-base64url!!!',
      },
    });

    expect(solveResponse.statusCode).toBe(400);
    expect(solveResponse.json()).toEqual({ error: 'Invalid payload encoding' });
  });

  it('still accepts legacy flat JSON format (backward compat)', async () => {
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/challenge/create',
      payload: {},
    });

    const created = createResponse.json() as ChallengeCreateResponse;
    const solution = solvePow(created.nonce, created.difficulty);

    const solveResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/challenge/solve',
      payload: {
        challengeId: created.challengeId,
        sessionId: created.sessionId,
        solution,
        mouseData: { straightLineRatio: 0.2 },
        timingData: { timeOnPageMs: 2600 },
      },
    });

    expect(solveResponse.statusCode).toBe(200);
    const solved = solveResponse.json() as ChallengeSolveResponse;
    expect(solved.success).toBe(true);
    expect(typeof solved.token).toBe('string');
  });

  it('rejects session mismatch on solve', async () => {
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/challenge/create',
      payload: {},
    });

    const created = createResponse.json() as ChallengeCreateResponse;

    const solveResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/challenge/solve',
      payload: {
        challengeId: created.challengeId,
        sessionId: '00000000-0000-0000-0000-000000000000',
        solution: '0',
      },
    });

    expect(solveResponse.statusCode).toBe(400);
    expect(solveResponse.json()).toEqual({ error: 'Session mismatch' });
  });

  it('backward compat: accepts flat JSON without d field (legacy client)', async () => {
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/challenge/create',
      payload: {},
    });
    expect(createResponse.statusCode).toBe(200);
    const created = createResponse.json() as ChallengeCreateResponse;

    const solution = solvePow(created.nonce, created.difficulty);

    const solveResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/challenge/solve',
      payload: {
        challengeId: created.challengeId,
        sessionId: created.sessionId,
        solution,
        // No 'd' field — flat JSON legacy format
        mouseData: { straightLineRatio: 0.15, velocity: 120 },
        timingData: { timeOnPageMs: 3100 },
        keyboardData: { avgDwellTime: 75, avgFlightTime: 40, dwellVariance: 10, flightVariance: 8, totalKeystrokes: 15 },
        canvasData: { canvasHash: 'legacyhash12', isCanvasSupported: true },
        webglData: { renderer: 'LegacyGPU', hasWebGL: true },
        screenData: { width: 1280, height: 720, pixelRatio: 1 },
        navigatorData: { userAgent: 'LegacyAgent/1.0', platform: 'Linux', language: 'en', timezone: 'UTC', timezoneOffset: 0, hardwareConcurrency: 2, maxTouchPoints: 0 },
        networkData: { latencyMs: 100, effectiveType: '3g' },
      },
    });

    expect(solveResponse.statusCode).toBe(200);
    const solved = solveResponse.json() as ChallengeSolveResponse;
    expect(solved.success).toBe(true);
    expect(typeof solved.token).toBe('string');
    expect(solved.token.length).toBeGreaterThan(0);
  });

  it('backward compat: partial behavioral data in flat JSON still scores', async () => {
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/challenge/create',
      payload: {},
    });
    const created = createResponse.json() as ChallengeCreateResponse;
    const solution = solvePow(created.nonce, created.difficulty);

    // Only mouse and timing, no other signals
    const solveResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/challenge/solve',
      payload: {
        challengeId: created.challengeId,
        sessionId: created.sessionId,
        solution,
        mouseData: { straightLineRatio: 0.85 }, // bot-like
        timingData: { timeOnPageMs: 500 }, // very fast
      },
    });

    expect(solveResponse.statusCode).toBe(200);
    const solved = solveResponse.json() as ChallengeSolveResponse;
    // Partial data should still score and succeed (no signals = default scoring)
    expect(solved.success).toBe(true);
    expect(typeof solved.score).toBe('number');
  });

  it('backward compat: flat JSON with only navigatorData', async () => {
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/challenge/create',
      payload: {},
    });
    const created = createResponse.json() as ChallengeCreateResponse;
    const solution = solvePow(created.nonce, created.difficulty);

    const solveResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/challenge/solve',
      payload: {
        challengeId: created.challengeId,
        sessionId: created.sessionId,
        solution,
        navigatorData: {
          userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/120.0.0.0',
          platform: 'Linux',
          language: 'en-US',
          timezone: 'America/New_York',
          timezoneOffset: -300,
          hardwareConcurrency: 8,
          maxTouchPoints: 0,
        },
      },
    });

    expect(solveResponse.statusCode).toBe(200);
    const solved = solveResponse.json() as ChallengeSolveResponse;
    expect(solved.success).toBe(true);
  });

  it('backward compat: flat JSON without d field, wrong solution returns 200 with success=false', async () => {
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/challenge/create',
      payload: {},
    });
    const created = createResponse.json() as ChallengeCreateResponse;

    // Send a solution that is definitely wrong for this nonce
    const solveResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/challenge/solve',
      payload: {
        challengeId: created.challengeId,
        sessionId: created.sessionId,
        solution: '999999999', // clearly wrong - won't match any reasonable difficulty
        mouseData: { straightLineRatio: 0.3 },
      },
    });

    // Wrong solution still returns 200 (not 400), with success=false and no token
    expect(solveResponse.statusCode).toBe(200);
    const solved = solveResponse.json() as ChallengeSolveResponse;
    expect(solved.success).toBe(false);
    expect(solved.token).toBeNull();
    expect(solved.verdict).toBe('bot'); // pow=0 scores as bot
  });

  it('backward compat: mixed obfuscated + flat fields (d takes precedence)', async () => {
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/challenge/create',
      payload: {},
    });
    const created = createResponse.json() as ChallengeCreateResponse;
    const solution = solvePow(created.nonce, created.difficulty);

    // Send both d (obfuscated) AND flat fields
    // Server should prefer d field if present
    const obfuscatedPayload = obfuscatePayload(
      { mouseData: { straightLineRatio: 0.4 } },
      created.sessionId,
      created.challengeId
    );

    const solveResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/challenge/solve',
      payload: {
        challengeId: created.challengeId,
        sessionId: created.sessionId,
        solution,
        d: obfuscatedPayload,
        // These flat fields should be ignored when d is present
        mouseData: { straightLineRatio: 0.99 }, // intentionally different
        timingData: { timeOnPageMs: 99999 },
      },
    });

    expect(solveResponse.statusCode).toBe(200);
    const solved = solveResponse.json() as ChallengeSolveResponse;
    expect(solved.success).toBe(true);
  });
});