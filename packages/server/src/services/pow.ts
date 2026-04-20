import crypto from 'crypto';

export interface PowChallenge {
  id: string;
  nonce: string;
  difficulty: number;
  expiresAt: number;
}

export function createChallenge(difficulty: number = 4): PowChallenge {
  const id = crypto.randomUUID();
  const nonce = crypto.randomBytes(16).toString('hex');
  const expiresAt = Date.now() + 5 * 60 * 1000;
  return { id, nonce, difficulty, expiresAt };
}

const MAX_SOLUTION_LENGTH = 256;

// UUID v4 format: 8-4-4-4-12 hex chars
const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Validate that a challenge ID is a proper UUID v4 string.
 * Prevents injection or malformed lookups against the database.
 */
export function isValidChallengeId(challengeId: string): boolean {
  return UUID_V4_REGEX.test(challengeId);
}

/**
 * Validate that a PoW solution string is well-formed:
 * - Non-empty
 * - Does not exceed maximum allowed length
 * - Contains only hex characters (0-9, a-f) which is the expected format
 */
export function validateSolutionFormat(solution: string): boolean {
  if (solution.length === 0 || solution.length > MAX_SOLUTION_LENGTH) {
    return false;
  }
  return /^[0-9a-f]+$/i.test(solution);
}

export function verifyPow(nonce: string, solution: string, difficulty: number): boolean {
  // Simplified leading-zeros PoW (MVP only; upgrade to Scrypt in later sprint)
  const hash = crypto.createHash('sha256').update(nonce + solution).digest('hex');
  const prefix = hash.slice(0, difficulty);
  return prefix === '0'.repeat(difficulty);
}