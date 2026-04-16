import type { FastifyInstance } from 'fastify';
import { createChallenge, verifyPow } from '../services/pow.js';
import { signToken } from '../services/token.js';
import { cleanupExpiredRows, db } from '../db.js';
import { checkRateLimit } from '../services/rateLimit.js';
import { calculateAllScores, calculateOverallScore, getVerdict } from '../services/scoring.js';
import { adaptScores, learnFromSession } from '../services/adaptive.js';
import { adaptPowDifficulty } from '../services/adaptivePow.js';
import { checkBotSignature, recordBotSignature, hashUserAgent } from '../services/botSignatures.js';
import crypto from 'crypto';
import { config } from '../config.js';

interface MouseDataInput {
  straightLineRatio?: number;
  velocity?: number;
  maxVelocity?: number;
  directionChanges?: number;
}

interface TimingDataInput {
  timeOnPageMs?: number;
}

interface KeyboardDataInput {
  avgDwellTime?: number;
  avgFlightTime?: number;
  dwellVariance?: number;
  flightVariance?: number;
  totalKeystrokes?: number;
}

interface CanvasDataInput {
  canvasHash?: string;
  isCanvasSupported?: boolean;
}

interface WebGLDataInput {
  renderer?: string;
  vendor?: string;
  hasWebGL?: boolean;
}

interface ScreenDataInput {
  width?: number;
  height?: number;
  colorDepth?: number;
  pixelRatio?: number;
}

interface NavigatorDataInput {
  userAgent?: string;
  platform?: string;
  language?: string;
  timezone?: string;
  timezoneOffset?: number;
  hardwareConcurrency?: number;
  maxTouchPoints?: number;
}

interface NetworkDataInput {
  latencyMs?: number;
  effectiveType?: string;
  downlink?: number;
}

interface SolveRequestBody {
  challengeId: string;
  solution: string;
  sessionId: string;
  mouseData?: MouseDataInput;
  timingData?: TimingDataInput;
  keyboardData?: KeyboardDataInput;
  canvasData?: CanvasDataInput;
  webglData?: WebGLDataInput;
  screenData?: ScreenDataInput;
  navigatorData?: NavigatorDataInput;
  networkData?: NetworkDataInput;
}

function hashIp(ip: string): string {
  const dayBucket = new Date().toISOString().slice(0, 10);
  return crypto.createHash('sha256').update(`${ip}:${config.secretKey}:${dayBucket}`).digest('hex');
}

export function challengeRoutes(app: FastifyInstance) {
  app.post('/api/v1/challenge/create', async (req, rep) => {
    cleanupExpiredRows();

    const ipHash = hashIp(req.ip ?? 'unknown');
    const rateLimit = checkRateLimit(ipHash);
    if (!rateLimit.allowed) {
      return rep.status(429).send({
        error: 'Too many requests',
        retryAfter: Math.ceil((rateLimit.resetAt - Date.now()) / 1000),
      });
    }

    // Adaptive PoW: auto-adjust difficulty based on threat level
    const { difficulty: adaptiveDifficulty } = adaptPowDifficulty();

    const sessionId = crypto.randomUUID();
    const challenge = createChallenge(adaptiveDifficulty);

    db.prepare(
      'INSERT INTO challenges (id, nonce, difficulty, expires_at, session_id) VALUES (?, ?, ?, ?, ?)'
    ).run(challenge.id, challenge.nonce, challenge.difficulty, challenge.expiresAt, sessionId);

    db.prepare(
      'INSERT INTO sessions (id, created_at, ip_hash, user_agent) VALUES (?, ?, ?, ?)'
    ).run(sessionId, Date.now(), ipHash, req.headers['user-agent'] ?? '');

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
    if (challengeRow.session_id !== sessionId) return rep.status(400).send({ error: 'Session mismatch' });
    if (Date.now() > challengeRow.expires_at) return rep.status(410).send({ error: 'Challenge expired' });

    const sessionRow = db.prepare('SELECT id, ip_hash, user_agent FROM sessions WHERE id = ?').get(sessionId) as {
      id: string;
      ip_hash: string;
      user_agent: string;
    } | undefined;
    if (!sessionRow) return rep.status(404).send({ error: 'Session not found' });

    const powValid = verifyPow(challengeRow.nonce, solution, challengeRow.difficulty);
    const powScore = powValid ? 100 : 0;

    // Build behavioral data map from all signal groups
    const behavioral: Record<string, unknown> = {};
    if (body.mouseData) Object.assign(behavioral, body.mouseData);
    if (body.timingData) {
      behavioral.timeOnPage = body.timingData.timeOnPageMs;
    }
    if (body.keyboardData) Object.assign(behavioral, body.keyboardData);
    if (body.canvasData) Object.assign(behavioral, body.canvasData);
    if (body.webglData) Object.assign(behavioral, body.webglData);
    if (body.screenData) Object.assign(behavioral, body.screenData);
    if (body.navigatorData) Object.assign(behavioral, body.navigatorData);
    if (body.networkData) Object.assign(behavioral, body.networkData);

    // 1. Rule-based signal scores
    const signalScores = calculateAllScores(behavioral);

    // 2. Adaptive ML: compare to learned site model
    const adaptive = adaptScores(signalScores);

    // 3. Bot signature check
    const uaHash = hashUserAgent(sessionRow.user_agent);
    const botCheck = checkBotSignature(sessionRow.ip_hash, uaHash);

    // 4. Calculate final score with adaptive adjustment
    let finalScore = calculateOverallScore(powScore, signalScores);

    // Apply adaptive ML penalty/bonus
    if (adaptive.confidence > 20) {
      const adaptiveDiff = adaptive.adjustedScore - (signalScores.mouseScore + signalScores.keyboardScore + signalScores.timingScore + signalScores.canvasScore + signalScores.webglScore + signalScores.screenScore + signalScores.navigatorScore + signalScores.networkScore) / 8;
      finalScore = Math.round(finalScore + adaptiveDiff * 0.3);
    }

    // Apply known bot penalty
    if (botCheck.isKnownBot) {
      finalScore = Math.round(finalScore * (1 - botCheck.confidence * 0.5));
    }

    finalScore = Math.max(0, Math.min(100, finalScore));
    const verdict = getVerdict(finalScore);

    db.prepare('DELETE FROM challenges WHERE id = ?').run(challengeId);

    const verdictToken = powValid ? signToken(sessionId, finalScore, verdict) : null;

    db.prepare(
      `UPDATE sessions SET
        mouse_score = ?, keyboard_score = ?, timing_score = ?,
        pow_score = ?, canvas_score = ?, webgl_score = ?,
        screen_score = ?, navigator_score = ?, network_score = ?,
        final_score = ?, verdict = ?, verdict_token = ?
       WHERE id = ?`
    ).run(
      signalScores.mouseScore,
      signalScores.keyboardScore,
      signalScores.timingScore,
      powScore,
      signalScores.canvasScore,
      signalScores.webglScore,
      signalScores.screenScore,
      signalScores.navigatorScore,
      signalScores.networkScore,
      finalScore,
      verdict,
      verdictToken,
      sessionId
    );

    // 5. Learn from human sessions (online learning)
    if (verdict === 'human') {
      learnFromSession(signalScores, 'human');
    }

    // 6. Record bot signatures for future detection
    if (verdict === 'bot') {
      recordBotSignature(sessionRow.ip_hash, uaHash);
    }

    return { success: powValid, token: verdictToken, score: finalScore, verdict };
  });
}
