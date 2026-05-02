const secretKey = process.env.SECRET_KEY;
if (!secretKey) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('SECRET_KEY environment variable is required in production');
  }
  console.warn('WARNING: Using default SECRET_KEY - DO NOT USE IN PRODUCTION');
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return parsed;
}

function parseNonNegativeInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function parseCsv(value: string | undefined, fallback: string[]): string[] {
  if (value === undefined) return fallback;
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parsePort(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 65535) return fallback;
  return parsed;
}

const adminPassword = process.env.ADMIN_PASSWORD ?? 'admin';
if (process.env.NODE_ENV === 'production' && adminPassword === 'admin') {
  throw new Error('ADMIN_PASSWORD must be changed from the default value in production');
}

export const config = {
  secretKey: secretKey ?? 'dev-secret-change-in-production',
  adminPassword,
  adminSessionTtlMs: parsePositiveInt(process.env.ADMIN_SESSION_TTL_MS, 12 * 60 * 60 * 1000),
  host: process.env.HOST ?? '0.0.0.0',
  port: parsePort(process.env.PORT, 3000),
  dbPath: process.env.DB_PATH ?? './data/savannaguard.db',
  bodyLimitBytes: parsePositiveInt(process.env.BODY_LIMIT_BYTES, 128 * 1024),
  trustProxy: parseBoolean(process.env.TRUST_PROXY, false),
  securityHeaders: {
    enabled: process.env.SECURITY_HEADERS_ENABLED !== 'false',
  },
  cors: {
    allowedOrigins: parseCsv(process.env.CORS_ALLOWED_ORIGINS, ['*']),
  },
  tokenTtlMs: 60 * 60 * 1000, // 1 hour
  tokenSingleUse: process.env.TOKEN_SINGLE_USE !== 'false',
  challengeTtlMs: 5 * 60 * 1000, // 5 minutes
  federation: {
    enabled: process.env.FEDERATION_ENABLED === 'true',
    peerUrls: process.env.FEDERATION_PEERS?.split(',').map((value) => value.trim()).filter(Boolean) ?? [],
    syncIntervalMs: parsePositiveInt(process.env.FEDERATION_SYNC_INTERVAL, 300000),
    minConfidence: parseFloat(process.env.FEDERATION_MIN_CONFIDENCE ?? '0.7'),
    minReporters: parsePositiveInt(process.env.FEDERATION_MIN_REPORTERS, 2),
    psk: process.env.FEDERATION_PSK ?? '',
    requestTimeoutMs: parsePositiveInt(process.env.FEDERATION_REQUEST_TIMEOUT_MS, 30000),
    maxRetries: parseNonNegativeInt(process.env.FEDERATION_MAX_RETRIES, 3),
    baseRetryDelayMs: parseNonNegativeInt(process.env.FEDERATION_BASE_RETRY_DELAY_MS, 5000),
    maxRetryDelayMs: parsePositiveInt(process.env.FEDERATION_MAX_RETRY_DELAY_MS, 60000),
    // Prefer documented variable name; keep *_MS as backward-compatible fallback
    offlineSyncIntervalMs: parsePositiveInt(
      process.env.FEDERATION_OFFLINE_SYNC_INTERVAL
        ?? process.env.FEDERATION_OFFLINE_SYNC_INTERVAL_MS
        ?? undefined,
      1800000
    ),
    offlineThreshold: parsePositiveInt(process.env.FEDERATION_OFFLINE_THRESHOLD, 3),
    maxPayloadBytes: parsePositiveInt(process.env.FEDERATION_MAX_PAYLOAD_BYTES, 5242880),
  },
  rateLimit: {
    maxChallengesPerMinute: 10,
    windowMs: 60 * 1000, // 1 minute
  },
  adaptive: {
    minSamples: parsePositiveInt(process.env.ADAPTIVE_MIN_SAMPLES, 10),
  },
  passiveProtection: {
    enabled: process.env.PASSIVE_PROTECTION_ENABLED !== 'false',
    blockDatacenterIPs: process.env.PASSIVE_PROTECTION_BLOCK_DC === 'true',
    datacenterRateLimitMax: parsePositiveInt(process.env.PASSIVE_PROTECTION_DC_RATE_LIMIT, 3),
    customBlockRanges: process.env.PASSIVE_PROTECTION_CUSTOM_RANGES?.split(',').map((value) => value.trim()).filter(Boolean) ?? [],
  },
};
