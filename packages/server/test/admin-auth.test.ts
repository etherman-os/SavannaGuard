/// <reference types="vitest/globals" />
import crypto from 'crypto';
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

  it('issues a signed expiring admin session cookie on successful login', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/login',
      payload: { password: process.env.ADMIN_PASSWORD },
    });

    expect(res.statusCode).toBe(302);
    const setCookie = res.headers['set-cookie'];
    expect(String(setCookie)).toContain('savanna_admin=');
    expect(String(setCookie)).toContain('HttpOnly');
    expect(String(setCookie)).toContain('Max-Age=');

    const cookie = Array.isArray(setCookie) ? setCookie.join('; ') : String(setCookie);
    const adminCookie = cookie.split(';').find((part) => part.trim().startsWith('savanna_admin='));
    expect(adminCookie).toBeDefined();
    expect(adminCookie).not.toContain(crypto.createHash('sha256').update(process.env.ADMIN_PASSWORD ?? '').digest('hex'));
  });

  it('rejects legacy password-hash admin cookies', async () => {
    const legacyHash = crypto.createHash('sha256').update(process.env.ADMIN_PASSWORD ?? '').digest('hex');
    const res = await app.inject({
      method: 'GET',
      url: '/admin/api/settings',
      headers: {
        cookie: `savanna_admin=${legacyHash}`,
      },
    });

    expect(res.statusCode).toBe(401);
  });

  it('sends baseline security headers', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
  });

  it('sends CORS headers for public widget API preflight requests only', async () => {
    const publicPreflight = await app.inject({
      method: 'OPTIONS',
      url: '/api/v1/challenge/create',
      headers: {
        origin: 'https://example.com',
        'access-control-request-method': 'POST',
      },
    });

    expect(publicPreflight.statusCode).toBe(204);
    expect(publicPreflight.headers['access-control-allow-origin']).toBe('*');
    expect(publicPreflight.headers['access-control-allow-methods']).toContain('POST');

    const adminResponse = await app.inject({
      method: 'GET',
      url: '/admin/login',
      headers: { origin: 'https://example.com' },
    });

    expect(adminResponse.headers['access-control-allow-origin']).toBeUndefined();
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
