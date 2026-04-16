/// <reference types="vitest/globals" />

import crypto from 'crypto';
import { createChallenge, verifyPow } from '../src/services/pow.js';

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
});
