import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { db, getPowDifficulty, setPowDifficulty } from '../db.js';
import { adminLayout, loginPage, statsContent, flaggedContent, settingsContent, threatContent, federationContent, vpnContent, mobileContent, multiTenantContent } from '../admin-ui.js';
import { getLearningStatus } from '../services/adaptive.js';
import { getThreatStatus } from '../services/adaptivePow.js';
import { getBotSignatureStats, cleanupOldSignatures } from '../services/botSignatures.js';
import { getPassiveProtectionStats } from '../services/passiveProtection.js';
import crypto from 'crypto';
import { config } from '../config.js';

const ADMIN_COOKIE_NAME = 'savanna_admin';

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function safeEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'utf-8');
  const rightBuffer = Buffer.from(right, 'utf-8');
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function currentAdminCookieValue(): string {
  return sha256(config.adminPassword);
}

function verifyPassword(token: string | undefined): boolean {
  if (!token) return false;
  return safeEquals(token, currentAdminCookieValue());
}

function readPasswordFromBody(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const password = (body as Record<string, unknown>).password;
  return typeof password === 'string' ? password : null;
}

function readDifficultyFromBody(body: unknown): number | null {
  if (!body || typeof body !== 'object') return null;
  const difficulty = (body as Record<string, unknown>).difficulty;
  if (typeof difficulty === 'number' && Number.isFinite(difficulty)) return Math.round(difficulty);
  if (typeof difficulty === 'string' && difficulty.trim().length > 0) {
    const parsed = Number.parseInt(difficulty, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function requireAdmin(request: FastifyRequest, reply: FastifyReply): boolean {
  if (verifyPassword(request.cookies[ADMIN_COOKIE_NAME])) return true;
  reply.status(401).type('text/html').send(loginPage());
  return false;
}

function requireAdminCsrf(request: FastifyRequest, reply: FastifyReply): boolean {
  if (!requireAdmin(request, reply)) return false;
  const header = request.headers['x-requested-with'] ?? '';
  if (typeof header !== 'string' || header !== 'SavannaAdmin') {
    reply.status(403).send({ error: 'Forbidden' });
    return false;
  }
  return true;
}

export function adminRoutes(app: FastifyInstance) {
  app.get('/admin/login', async (_req, rep) => {
    return rep.type('text/html').send(loginPage());
  });

  app.post('/admin/login', async (req, rep) => {
    const password = readPasswordFromBody(req.body);
    if (password && safeEquals(sha256(password), currentAdminCookieValue())) {
      rep.setCookie(ADMIN_COOKIE_NAME, currentAdminCookieValue(), {
        path: '/',
        httpOnly: true,
        sameSite: 'strict',
        secure: process.env.NODE_ENV === 'production',
      });
      return rep.redirect('/admin');
    }
    return rep.type('text/html').send(loginPage('Invalid password'));
  });

  app.get('/admin/logout', async (_req, rep) => {
    rep.clearCookie(ADMIN_COOKIE_NAME, { path: '/' });
    return rep.redirect('/admin/login');
  });

  app.get('/admin', async (req, rep) => {
    if (!requireAdmin(req, rep)) return;
    return rep.type('text/html').send(adminLayout('Stats', statsContent(), 'stats'));
  });

  app.get('/admin/threat', async (req, rep) => {
    if (!requireAdmin(req, rep)) return;
    return rep.type('text/html').send(adminLayout('Threat Intelligence', threatContent(), 'threat'));
  });

  app.get('/admin/flagged', async (req, rep) => {
    if (!requireAdmin(req, rep)) return;
    return rep.type('text/html').send(adminLayout('Flagged Sessions', flaggedContent(), 'flagged'));
  });

  app.get('/admin/settings', async (req, rep) => {
    if (!requireAdmin(req, rep)) return;
    return rep.type('text/html').send(adminLayout('Settings', settingsContent(), 'settings'));
  });

  app.get('/admin/federation', async (req, rep) => {
    if (!requireAdmin(req, rep)) return;
    return rep.type('text/html').send(adminLayout('Federation', federationContent(), 'federation'));
  });

  app.get('/admin/vpn', async (req, rep) => {
    if (!requireAdmin(req, rep)) return;
    return rep.type('text/html').send(adminLayout('VPN Detection', vpnContent(), 'vpn'));
  });

  app.get('/admin/mobile', async (req, rep) => {
    if (!requireAdmin(req, rep)) return;
    return rep.type('text/html').send(adminLayout('Mobile SDK', mobileContent(), 'mobile'));
  });

  app.get('/admin/multi-tenant', async (req, rep) => {
    if (!requireAdmin(req, rep)) return;
    return rep.type('text/html').send(adminLayout('Multi-Tenant', multiTenantContent(), 'multi-tenant'));
  });

  app.get('/admin/api/stats', async (req, rep) => {
    if (!requireAdmin(req, rep)) return;

    const since = Date.now() - 24 * 60 * 60 * 1000;
    const total = (db.prepare('SELECT COUNT(*) as c FROM sessions WHERE created_at >= ?').get(since) as { c: number }).c;
    const human = (db.prepare("SELECT COUNT(*) as c FROM sessions WHERE created_at >= ? AND verdict='human'").get(since) as { c: number }).c;
    const bot = (db.prepare("SELECT COUNT(*) as c FROM sessions WHERE created_at >= ? AND verdict='bot'").get(since) as { c: number }).c;
    const suspicious = (db.prepare("SELECT COUNT(*) as c FROM sessions WHERE created_at >= ? AND verdict='suspicious'").get(since) as { c: number }).c;
    const avg = (db.prepare('SELECT AVG(final_score) as a FROM sessions WHERE created_at >= ? AND final_score > 0').get(since) as { a: number | null }).a ?? 0;

    const threat = getThreatStatus();
    const learning = getLearningStatus();
    const maxSample = Math.max(...Object.values(learning).map(s => s.count), 0);

    return {
      totalSessions: total,
      humanCount: human,
      botCount: bot,
      suspiciousCount: suspicious,
      avgScore: avg,
      botRatio: threat.botRatio,
      difficulty: threat.difficulty,
      learningSamples: maxSample,
    };
  });

  app.get('/admin/api/stats/timeseries', async (req, rep) => {
    if (!requireAdmin(req, rep)) return;

    const now = Date.now();
    const since = now - 24 * 60 * 60 * 1000;

    const rows = db.prepare(
      `SELECT
        (created_at / 3600000) * 3600000 AS hour_bucket,
        COUNT(*) AS total,
        SUM(CASE WHEN verdict='human' THEN 1 ELSE 0 END) AS human,
        SUM(CASE WHEN verdict='bot' THEN 1 ELSE 0 END) AS bot,
        SUM(CASE WHEN verdict='suspicious' THEN 1 ELSE 0 END) AS suspicious
      FROM sessions
      WHERE created_at >= ?
      GROUP BY hour_bucket
      ORDER BY hour_bucket`
    ).all(since) as Array<{
      hour_bucket: number;
      total: number;
      human: number;
      bot: number;
      suspicious: number;
    }>;

    const dataMap = new Map<number, { timestamp: number; human: number; bot: number; suspicious: number; total: number }>();
    for (const row of rows) {
      dataMap.set(row.hour_bucket, {
        timestamp: row.hour_bucket,
        human: row.human,
        bot: row.bot,
        suspicious: row.suspicious,
        total: row.total,
      });
    }

    const hourly: Array<{ timestamp: number; human: number; bot: number; suspicious: number; total: number }> = [];
    for (let i = 23; i >= 0; i--) {
      const ts = Math.floor((now - i * 3600000) / 3600000) * 3600000;
      const entry = dataMap.get(ts);
      hourly.push(entry ?? { timestamp: ts, human: 0, bot: 0, suspicious: 0, total: 0 });
    }

    const verdicts = {
      human: (db.prepare("SELECT COUNT(*) as c FROM sessions WHERE created_at >= ? AND verdict='human'").get(since) as { c: number }).c,
      bot: (db.prepare("SELECT COUNT(*) as c FROM sessions WHERE created_at >= ? AND verdict='bot'").get(since) as { c: number }).c,
      suspicious: (db.prepare("SELECT COUNT(*) as c FROM sessions WHERE created_at >= ? AND verdict='suspicious'").get(since) as { c: number }).c,
    };

    return { hourly, verdicts };
  });

  app.get('/admin/api/threat', async (req, rep) => {
    if (!requireAdmin(req, rep)) return;
    return getThreatStatus();
  });

  app.get('/admin/api/learning', async (req, rep) => {
    if (!requireAdmin(req, rep)) return;
    return getLearningStatus();
  });

  app.get('/admin/api/signatures', async (req, rep) => {
    if (!requireAdmin(req, rep)) return;
    cleanupOldSignatures();
    return getBotSignatureStats();
  });

  app.get('/admin/api/flagged', async (req, rep) => {
    if (!requireAdmin(req, rep)) return;
    const rows = db.prepare("SELECT id, created_at, verdict, final_score, ip_hash FROM sessions WHERE verdict IN ('bot','suspicious') ORDER BY created_at DESC LIMIT 100").all() as {
      id: string;
      created_at: number;
      verdict: string;
      final_score: number;
      ip_hash: string;
    }[];
    return rows.map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      verdict: row.verdict,
      finalScore: row.final_score,
      ipHash: row.ip_hash,
    }));
  });

  app.get('/admin/api/settings', async (req, rep) => {
    if (!requireAdmin(req, rep)) return;
    return { difficulty: getPowDifficulty() };
  });

  app.post('/admin/settings', async (req, rep) => {
    if (!requireAdminCsrf(req, rep)) return;

    const requestedDifficulty = readDifficultyFromBody(req.body);
    if (requestedDifficulty === null) {
      return rep.status(400).send({ ok: false, error: 'Invalid difficulty' });
    }

    const savedDifficulty = setPowDifficulty(requestedDifficulty);
    return { ok: true, difficulty: savedDifficulty };
  });

  app.get('/admin/api/passive-protection', async (req, rep) => {
    if (!requireAdmin(req, rep)) return;
    return getPassiveProtectionStats();
  });
}
