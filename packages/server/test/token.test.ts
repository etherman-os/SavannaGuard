/// <reference types="vitest/globals" />

import { signToken, verifyToken } from '../src/services/token.js';

describe('token service', () => {
  it('signs and verifies a token', () => {
    const token = signToken('session-123', 87, 'human');
    const result = verifyToken(token);

    expect(result.valid).toBe(true);
    expect(result.sessionId).toBe('session-123');
    expect(result.score).toBe(87);
    expect(result.verdict).toBe('human');
  });

  it('rejects a tampered token', () => {
    const token = signToken('session-abc', 50, 'suspicious');
    const tamperedToken = token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A');

    expect(verifyToken(tamperedToken).valid).toBe(false);
  });

  it('rejects malformed token input', () => {
    expect(verifyToken('not-a-valid-token').valid).toBe(false);
  });
});
