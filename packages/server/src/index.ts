import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import formbody from '@fastify/formbody';
import { config } from './config.js';
import { challengeRoutes } from './routes/challenge.js';
import { tokenRoutes } from './routes/token.js';
import { adminRoutes } from './routes/admin.js';
import { join, dirname, extname, normalize, resolve, sep } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { statSync, readFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const widgetDist = resolve(join(__dirname, '../../widget/dist'));

export function buildServer(): FastifyInstance {
  const app = Fastify({ logger: true });
  app.register(cookie);
  app.register(formbody);

  app.get('/health', async () => ({ ok: true }));

  challengeRoutes(app);
  tokenRoutes(app);
  adminRoutes(app);

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
  await app.listen({ port: config.port });

  console.log(`SavannaGuard server running on port ${config.port}`);
  console.log(`  API:        http://localhost:${config.port}/api/v1/`);
  console.log(`  Admin:      http://localhost:${config.port}/admin`);
  console.log(`  Widget:     http://localhost:${config.port}/widget/savanna-widget.iife.js`);

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