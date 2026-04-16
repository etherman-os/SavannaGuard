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

export function verifyPow(nonce: string, solution: string, difficulty: number): boolean {
  // Simplified leading-zeros PoW (MVP only; upgrade to Scrypt in later sprint)
  const hash = crypto.createHash('sha256').update(nonce + solution).digest('hex');
  const prefix = hash.slice(0, difficulty);
  return prefix === '0'.repeat(difficulty);
}