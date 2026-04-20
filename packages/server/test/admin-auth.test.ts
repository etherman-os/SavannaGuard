/// <reference types="vitest/globals" />
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/index.js';
import { resetRateLimitState } from '../src/services/rateLimit.js';

describe('admin auth and lockout', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    resetRateLimitState();
    app = buildServer();
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    resetRateLimitState();
  });

  it('locks admin login after repeated failures and sets Retry-After header', async () => {
    for (let i = 0; i < 5; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/admin/login',
        payload: { password: 'wrong-password' },
      });
      expect(res.statusCode).toBe(200);
    }

    const locked = await app.inject({
      method: 'POST',
      url: '/admin/login',
      payload: { password: 'wrong-password' },
    });

    expect(locked.statusCode).toBe(429);
    expect(locked.headers['retry-after']).toBeDefined();
    expect(locked.body).toContain('Too many failed attempts');
  });
});
