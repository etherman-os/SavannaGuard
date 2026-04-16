import crypto from 'crypto';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/index.js';

interface ChallengeCreateResponse {
  challengeId: string;
  nonce: string;
  difficulty: number;
  sessionId: string;
}

interface ChallengeSolveResponse {
  success: boolean;
  token: string | null;
  score: number;
  verdict: string;
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

describe('challenge flow', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = buildServer();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates challenge, solves PoW and validates token', async () => {
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
        mouseData: { straightLineRatio: 0.2 },
        timingData: { timeOnPageMs: 2600 },
      },
    });

    expect(solveResponse.statusCode).toBe(200);
    const solved = solveResponse.json() as ChallengeSolveResponse;
    expect(solved.success).toBe(true);
    expect(typeof solved.token).toBe('string');

    const validateResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/token/validate',
      payload: { token: solved.token },
    });

    expect(validateResponse.statusCode).toBe(200);
    const validated = validateResponse.json() as TokenValidateResponse;
    expect(validated.valid).toBe(true);
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
});
