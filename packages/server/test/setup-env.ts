import { beforeEach, afterEach } from 'vitest';

process.env.SECRET_KEY ??= 'savannaguard-test-secret';
process.env.ADMIN_PASSWORD ??= 'savannaguard-test-admin';
process.env.DB_PATH = ':memory:';
process.env.PORT ??= '0';
process.env.FEDERATION_ENABLED ??= 'true';
process.env.FEDERATION_MAX_RETRIES ??= '0';
process.env.FEDERATION_BASE_RETRY_DELAY_MS ??= '10';
process.env.FEDERATION_MAX_RETRY_DELAY_MS ??= '50';
process.env.FEDERATION_REQUEST_TIMEOUT_MS ??= '2000';
process.env.FEDERATION_OFFLINE_THRESHOLD ??= '3';

beforeEach(async () => {
  const { resetRateLimitState } = await import('../src/services/rateLimit.js');
  resetRateLimitState();
});

afterEach(async () => {
  const { resetRateLimitState } = await import('../src/services/rateLimit.js');
  resetRateLimitState();
});
