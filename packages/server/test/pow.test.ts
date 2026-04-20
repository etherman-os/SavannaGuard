/// <reference types="vitest/globals" />

import crypto from 'crypto';
import { createChallenge, verifyPow, isValidChallengeId, validateSolutionFormat } from '../src/services/pow.js';

function solvePow(nonce: string, difficulty: number): string {
  let candidate = 0;
  while (candidate < 20_000_000) {
    const hash = crypto.createHash('sha256').update(nonce + String(candidate)).digest('hex');
    if (hash.slice(0, difficulty) === '0'.repeat(difficulty)) {
      return String(candidate);
    }
    candidate += 1;
  }
  throw new Error('Could not solve PoW within test iteration limit');
}

describe('pow service', () => {
  it('creates challenge with requested difficulty', () => {
    const challenge = createChallenge(3);

    expect(challenge.id).toHaveLength(36);
    expect(challenge.nonce.length).toBeGreaterThan(0);
    expect(challenge.difficulty).toBe(3);
    expect(challenge.expiresAt).toBeGreaterThan(Date.now());
  });

  it('verifies a valid proof-of-work solution', () => {
    const challenge = createChallenge(3);
    const solution = solvePow(challenge.nonce, challenge.difficulty);

    expect(verifyPow(challenge.nonce, solution, challenge.difficulty)).toBe(true);
  });

  it('rejects an invalid proof-of-work solution', () => {
    const challenge = createChallenge(3);

    expect(verifyPow(challenge.nonce, 'invalid-solution', challenge.difficulty)).toBe(false);
  });

  it('accepts only valid UUID v4 challenge IDs', () => {
    const challenge = createChallenge(3);
    expect(isValidChallengeId(challenge.id)).toBe(true);

    expect(isValidChallengeId('not-a-uuid')).toBe(false);
    expect(isValidChallengeId('00000000-0000-1000-8000-000000000000')).toBe(false); // v1
    expect(isValidChallengeId('00000000-0000-5000-8000-000000000000')).toBe(false); // v5
  });

  it('validates solution format boundaries', () => {
    expect(validateSolutionFormat('0')).toBe(true);
    expect(validateSolutionFormat('abcdef1234')).toBe(true);
    expect(validateSolutionFormat('A1B2C3')).toBe(true);

    expect(validateSolutionFormat('')).toBe(false);
    expect(validateSolutionFormat('g123')).toBe(false);
    expect(validateSolutionFormat('123-456')).toBe(false);
    expect(validateSolutionFormat('f'.repeat(257))).toBe(false);
  });
});
