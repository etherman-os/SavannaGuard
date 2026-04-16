import type { FastifyInstance } from 'fastify';
import { createChallenge, verifyPow } from '../services/pow.js';
import { signToken } from '../services/token.js';
import { cleanupExpiredRows, db, getPowDifficulty } from '../db.js';
import crypto from 'crypto';
import { config } from '../config.js';

interface SolveRequestBody {
  challengeId: string;
  solution: string;
  sessionId: string;
  mouseData?: { straightLineRatio?: number };
  timingData?: { timeOnPageMs?: number };
}

function hashIp(ip: string): string {
  const dayBucket = new Date().toISOString().slice(0, 10);
  return crypto.createHash('sha256').update(`${ip}:${config.secretKey}:${dayBucket}`).digest('hex');
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, score));
}

function scoreMouse(straightLineRatio: number | undefined): number {
  if (typeof straightLineRatio !== 'number' || !Number.isFinite(straightLineRatio)) return 50;
  const ratio = Math.max(0, Math.min(1, straightLineRatio));
  const score = ratio > 0.9 ? 0 : Math.round(50 + (1 - ratio) * 50);
  return clampScore(score);
}

function scoreTiming(timeOnPageMs: number | undefined): number {
  if (typeof timeOnPageMs !== 'number' || !Number.isFinite(timeOnPageMs)) return 50;
  if (timeOnPageMs < 700) return 10;
  if (timeOnPageMs < 1500) return 30;
  if (timeOnPageMs <= 10 * 60 * 1000) return 85;
  return 55;
}

export function challengeRoutes(app: FastifyInstance) {
  app.post('/api/v1/challenge/create', async (req) => {
    cleanupExpiredRows();

    const sessionId = crypto.randomUUID();
    const difficulty = getPowDifficulty();
    const challenge = createChallenge(difficulty);

    db.prepare(
      'INSERT INTO challenges (id, nonce, difficulty, expires_at, session_id) VALUES (?, ?, ?, ?, ?)'
    ).run(challenge.id, challenge.nonce, challenge.difficulty, challenge.expiresAt, sessionId);

    db.prepare(
      'INSERT INTO sessions (id, created_at, ip_hash, user_agent) VALUES (?, ?, ?, ?)'
    ).run(sessionId, Date.now(), hashIp(req.ip ?? 'unknown'), req.headers['user-agent'] ?? '');

    return {
      challengeId: challenge.id,
      nonce: challenge.nonce,
      difficulty: challenge.difficulty,
      sessionId,
    };
  });

  app.post('/api/v1/challenge/solve', async (req, rep) => {
    const body = (req.body ?? {}) as Partial<SolveRequestBody>;

    if (typeof body.challengeId !== 'string' || typeof body.solution !== 'string' || typeof body.sessionId !== 'string') {
      return rep.status(400).send({ error: 'Invalid payload' });
    }

    const { challengeId, solution, sessionId } = body;

    const challengeRow = db.prepare('SELECT * FROM challenges WHERE id = ?').get(challengeId) as {
      id: string;
      nonce: string;
      difficulty: number;
      expires_at: number;
      session_id: string;
    } | undefined;

    if (!challengeRow) return rep.status(404).send({ error: 'Challenge not found' });

    if (challengeRow.session_id !== sessionId) {
      return rep.status(400).send({ error: 'Session mismatch' });
    }

    if (Date.now() > challengeRow.expires_at) return rep.status(410).send({ error: 'Challenge expired' });

    const sessionRow = db.prepare('SELECT id FROM sessions WHERE id = ?').get(sessionId) as { id: string } | undefined;
    if (!sessionRow) return rep.status(404).send({ error: 'Session not found' });

    const powValid = verifyPow(challengeRow.nonce, solution, challengeRow.difficulty);
    const powScore = powValid ? 100 : 0;

    const mouseScore = scoreMouse(body.mouseData?.straightLineRatio);
    const timingScore = scoreTiming(body.timingData?.timeOnPageMs);
    const keyboardScore = 50;

    const finalScore = clampScore(
      Math.round(powScore * 0.55 + mouseScore * 0.25 + timingScore * 0.2 + keyboardScore * 0)
    );
    const verdict: 'human' | 'bot' | 'suspicious' | 'pending' =
      finalScore >= 70 ? 'human' : finalScore >= 40 ? 'suspicious' : 'bot';

    db.prepare('DELETE FROM challenges WHERE id = ?').run(challengeId);

    const verdictToken = powValid ? signToken(sessionId, finalScore, verdict) : null;

    const updateResult = db.prepare(
      `UPDATE sessions SET
        mouse_score = ?, keyboard_score = ?, timing_score = ?,
        pow_score = ?, final_score = ?, verdict = ?, verdict_token = ?
       WHERE id = ?`
    ).run(mouseScore, keyboardScore, timingScore, powScore, finalScore, verdict, verdictToken, sessionId);

    if (updateResult.changes === 0) {
      return rep.status(404).send({ error: 'Session not found' });
    }

    return { success: powValid, token: verdictToken, score: finalScore, verdict };
  });
}