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

export const config = {
  secretKey: secretKey ?? 'dev-secret-change-in-production',
  adminPassword: process.env.ADMIN_PASSWORD ?? 'admin',
  host: process.env.HOST ?? '0.0.0.0',
  port: parseInt(process.env.PORT ?? '3000', 10),
  dbPath: process.env.DB_PATH ?? './data/savannaguard.db',
  tokenTtlMs: 60 * 60 * 1000, // 1 hour
  challengeTtlMs: 5 * 60 * 1000, // 5 minutes
  federation: {
    enabled: process.env.FEDERATION_ENABLED === 'true',
    peerUrls: process.env.FEDERATION_PEERS?.split(',').map((value) => value.trim()).filter(Boolean) ?? [],
    syncIntervalMs: parseInt(process.env.FEDERATION_SYNC_INTERVAL ?? '300000', 10),
    minConfidence: parseFloat(process.env.FEDERATION_MIN_CONFIDENCE ?? '0.7'),
    minReporters: parseInt(process.env.FEDERATION_MIN_REPORTERS ?? '2', 10),
    psk: process.env.FEDERATION_PSK ?? '',
    requestTimeoutMs: parseInt(process.env.FEDERATION_REQUEST_TIMEOUT_MS ?? '30000', 10),
    maxRetries: parseInt(process.env.FEDERATION_MAX_RETRIES ?? '3', 10),
    baseRetryDelayMs: parseInt(process.env.FEDERATION_BASE_RETRY_DELAY_MS ?? '5000', 10),
    maxRetryDelayMs: parseInt(process.env.FEDERATION_MAX_RETRY_DELAY_MS ?? '60000', 10),
    // Prefer documented variable name; keep *_MS as backward-compatible fallback
    offlineSyncIntervalMs: parseInt(
      process.env.FEDERATION_OFFLINE_SYNC_INTERVAL
        ?? process.env.FEDERATION_OFFLINE_SYNC_INTERVAL_MS
        ?? '1800000',
      10
    ),
    offlineThreshold: parseInt(process.env.FEDERATION_OFFLINE_THRESHOLD ?? '3', 10),
    maxPayloadBytes: parseInt(process.env.FEDERATION_MAX_PAYLOAD_BYTES ?? '5242880', 10),
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
    datacenterRateLimitMax: parseInt(process.env.PASSIVE_PROTECTION_DC_RATE_LIMIT ?? '3', 10),
    customBlockRanges: process.env.PASSIVE_PROTECTION_CUSTOM_RANGES?.split(',').map((value) => value.trim()).filter(Boolean) ?? [],
  },
};
