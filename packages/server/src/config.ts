export const config = {
  secretKey: process.env.SECRET_KEY ?? 'dev-secret-change-in-production',
  adminPassword: process.env.ADMIN_PASSWORD ?? 'admin',
  port: parseInt(process.env.PORT ?? '3000', 10),
  dbPath: process.env.DB_PATH ?? './data/savannaguard.db',
  tokenTtlMs: 60 * 60 * 1000, // 1 hour
  challengeTtlMs: 5 * 60 * 1000, // 5 minutes
  rateLimit: {
    maxChallengesPerMinute: 10,
    windowMs: 60 * 1000, // 1 minute
  },
};
