import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import formbody from '@fastify/formbody';
import { config } from './config.js';
import { isDbHealthy } from './db.js';
import { challengeRoutes } from './routes/challenge.js';
import { tokenRoutes } from './routes/token.js';
import { adminRoutes } from './routes/admin.js';
import { federationRoutes } from './routes/federation.js';
import { startBackgroundSync } from './services/federation.js';
import { join, dirname, extname, normalize, resolve, sep } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { statSync, readFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const widgetDist = resolve(join(__dirname, '../../widget/dist'));
const PUBLIC_CORS_PATH_PREFIXES = ['/api/v1/challenge/'];
const PUBLIC_CORS_PATHS = ['/api/v1/token/validate'];

function isPublicCorsPath(url: string): boolean {
  return PUBLIC_CORS_PATHS.includes(url) || PUBLIC_CORS_PATH_PREFIXES.some((prefix) => url.startsWith(prefix));
}

function resolveCorsOrigin(origin: string | undefined): string | null {
  const allowedOrigins = config.cors.allowedOrigins;
  if (allowedOrigins.length === 0) return null;
  if (allowedOrigins.includes('*')) return '*';
  if (origin && allowedOrigins.includes(origin)) return origin;
  return null;
}

export function buildServer(): FastifyInstance {
  const app = Fastify({
    logger: true,
    trustProxy: config.trustProxy,
    bodyLimit: Math.max(config.bodyLimitBytes, config.federation.maxPayloadBytes),
  });
  app.register(cookie);
  app.register(formbody);

  app.addHook('onRequest', async (req, rep) => {
    if (!isPublicCorsPath(req.url)) return;

    const origin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined;
    const corsOrigin = resolveCorsOrigin(origin);
    if (corsOrigin) {
      rep.header('Access-Control-Allow-Origin', corsOrigin);
      rep.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
      rep.header('Access-Control-Allow-Headers', 'Content-Type');
      rep.header('Access-Control-Max-Age', '600');
      if (corsOrigin !== '*') rep.header('Vary', 'Origin');
    }
  });

  app.options('/api/v1/*', async (req, rep) => {
    if (!isPublicCorsPath(req.url)) return rep.status(404).send('Not found');
    return rep.status(204).send();
  });

  if (config.securityHeaders.enabled) {
    app.addHook('onRequest', async (_req, rep) => {
      rep.header('X-Content-Type-Options', 'nosniff');
      rep.header('X-Frame-Options', 'DENY');
      rep.header('Referrer-Policy', 'no-referrer');
      rep.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
      rep.header(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
      );
    });

    app.addHook('onSend', async (req, rep, payload) => {
      if (req.url.startsWith('/admin') || req.url.startsWith('/api/')) {
        rep.header('Cache-Control', 'no-store');
      }
      return payload;
    });
  }

  app.get('/health', async (_req, rep) => {
    const dbOk = isDbHealthy();
    if (!dbOk) {
      return rep.status(503).send({ ok: false, error: 'Database unavailable' });
    }
    return { ok: true };
  });

  challengeRoutes(app);
  tokenRoutes(app);
  adminRoutes(app);
  federationRoutes(app);

  const staticDir = resolve(__dirname, 'static');
  app.get('/admin/static/*', async (req, rep) => {
    const routeParams = req.params as Record<string, string | undefined>;
    const requestedPath = routeParams['*'] ?? '';
    const normalizedPath = normalize(requestedPath);
    if (normalizedPath.includes('..')) return rep.status(403).send('Forbidden');
    const filePath = resolve(staticDir, normalizedPath);
    if (!filePath.startsWith(staticDir + sep)) return rep.status(403).send('Forbidden');
    try {
      const fileStats = statSync(filePath);
      if (!fileStats.isFile()) return rep.status(404).send('Not found');
      const content = readFileSync(filePath);
      const ext = extname(filePath);
      if (ext === '.js') return rep.type('application/javascript').send(content);
      if (ext === '.css') return rep.type('text/css').send(content);
      return rep.type('application/octet-stream').send(content);
    } catch {
      return rep.status(404).send('Not found');
    }
  });

  app.get('/widget/*', async (req, rep) => {
    const routeParams = req.params as Record<string, string | undefined>;
    const requestedPath = routeParams['*'] ?? '';
    const normalizedPath = normalize(requestedPath);
    const filePath = resolve(widgetDist, normalizedPath);

    if (!requestedPath || requestedPath.startsWith('/')) {
      return rep.status(404).send('Not found');
    }

    if (filePath !== widgetDist && !filePath.startsWith(widgetDist + sep)) {
      return rep.status(403).send('Forbidden');
    }

    try {
      const fileStats = statSync(filePath);
      if (!fileStats.isFile()) {
        return rep.status(404).send('Not found');
      }

      const content = readFileSync(filePath, 'utf-8');
      const extension = extname(filePath);
      if (extension === '.js') {
        return rep.type('application/javascript').send(content);
      }
      if (extension === '.css') {
        return rep.type('text/css').send(content);
      }
      return rep.type('text/plain').send(content);
    } catch {
      return rep.status(404).send('Not found');
    }
  });

  return app;
}

export async function startServer(): Promise<FastifyInstance> {
  const app = buildServer();
  await app.listen({ host: config.host, port: config.port });

  console.log(`SavannaGuard server running on ${config.host}:${config.port}`);
  console.log(`  API:        http://localhost:${config.port}/api/v1/`);
  console.log(`  Admin:      http://localhost:${config.port}/admin`);
  console.log(`  Widget:     http://localhost:${config.port}/widget/savanna-widget.iife.js`);

  // Start federation background sync if enabled
  startBackgroundSync();

  return app;
}

function isEntrypoint(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

if (isEntrypoint()) {
  startServer().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}

export default buildServer;
