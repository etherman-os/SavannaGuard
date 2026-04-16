export const config = {
  secretKey: process.env.SECRET_KEY ?? 'dev-secret-change-in-production',
  adminPassword: process.env.ADMIN_PASSWORD ?? 'admin',
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
  },
  rateLimit: {
    maxChallengesPerMinute: 10,
    windowMs: 60 * 1000, // 1 minute
  },
};
