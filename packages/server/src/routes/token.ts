import type { FastifyInstance } from 'fastify';
import { verifyToken } from '../services/token.js';
import { db } from '../db.js';
import { config } from '../config.js';

export function tokenRoutes(app: FastifyInstance) {
  app.post('/api/v1/token/validate', { bodyLimit: config.bodyLimitBytes }, async (req, rep) => {
    const body = (req.body ?? {}) as { token?: unknown };
    if (typeof body.token !== 'string' || body.token.length === 0) {
      return rep.status(400).send({ valid: false, verdict: 'bot', score: 0 });
    }

    const verification = verifyToken(body.token);
    if (!verification.valid) {
      return { valid: false, verdict: 'bot', score: 0 };
    }

    if (config.tokenSingleUse) {
      const consumed = db.prepare(
        `UPDATE sessions
         SET verdict_token_used_at = ?
         WHERE id = ?
           AND verdict_token = ?
           AND verdict_token_used_at = 0`
      ).run(Date.now(), verification.sessionId, body.token);

      if (consumed.changes === 0) {
        return { valid: false, verdict: 'bot', score: 0 };
      }
    }

    const session = db.prepare('SELECT verdict, final_score, verdict_token FROM sessions WHERE id = ?').get(verification.sessionId) as {
      verdict: string;
      final_score: number;
      verdict_token: string | null;
    } | undefined;

    if (!session || session.verdict_token !== body.token) {
      return { valid: false, verdict: 'bot', score: 0 };
    }

    return { valid: true, verdict: session.verdict, score: session.final_score };
  });
}
