#!/usr/bin/env node

import crypto from 'crypto';
import os from 'os';
import { performance } from 'perf_hooks';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const MAX_POW_ITERATIONS = 40_000_000;

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../..');
const outputPathArg = process.argv[2];
const outputPath = outputPathArg
  ? resolve(process.cwd(), outputPathArg)
  : resolve(repoRoot, 'docs/perf', `free-baseline-${new Date().toISOString().slice(0, 10)}.json`);

const benchConfig = {
  health: { durationMs: 10_000, concurrency: 64 },
  challengeCreate: { durationMs: 10_000, concurrency: 16 },
  fullFlow: { totalFlows: 40, concurrency: 2 },
};

function toMiB(bytes) {
  return Math.round((bytes / 1024 / 1024) * 100) / 100;
}

function percentile(sortedValues, p) {
  if (sortedValues.length === 0) return 0;
  const index = Math.min(sortedValues.length - 1, Math.max(0, Math.ceil((p / 100) * sortedValues.length) - 1));
  return sortedValues[index];
}

function summarizeLatencies(latenciesMs) {
  if (latenciesMs.length === 0) {
    return { min: 0, p50: 0, p95: 0, p99: 0, max: 0, avg: 0 };
  }

  const sorted = [...latenciesMs].sort((a, b) => a - b);
  const avg = latenciesMs.reduce((sum, value) => sum + value, 0) / latenciesMs.length;
  return {
    min: Number(sorted[0].toFixed(2)),
    p50: Number(percentile(sorted, 50).toFixed(2)),
    p95: Number(percentile(sorted, 95).toFixed(2)),
    p99: Number(percentile(sorted, 99).toFixed(2)),
    max: Number(sorted[sorted.length - 1].toFixed(2)),
    avg: Number(avg.toFixed(2)),
  };
}

function createLatencyTracker(maxSamples = 50_000) {
  const samples = [];
  let count = 0;
  let sum = 0;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  return {
    record(value) {
      count += 1;
      sum += value;
      if (value < min) min = value;
      if (value > max) max = value;

      if (samples.length < maxSamples) {
        samples.push(value);
        return;
      }

      const replaceIndex = Math.floor(Math.random() * count);
      if (replaceIndex < maxSamples) {
        samples[replaceIndex] = value;
      }
    },
    summarize() {
      if (count === 0) {
        return {
          min: 0,
          p50: 0,
          p95: 0,
          p99: 0,
          max: 0,
          avg: 0,
          samplesUsed: 0,
          totalCount: 0,
        };
      }

      const sampledSummary = summarizeLatencies(samples);
      return {
        min: Number(min.toFixed(2)),
        p50: sampledSummary.p50,
        p95: sampledSummary.p95,
        p99: sampledSummary.p99,
        max: Number(max.toFixed(2)),
        avg: Number((sum / count).toFixed(2)),
        samplesUsed: samples.length,
        totalCount: count,
      };
    },
  };
}

function summarizeAttempts(attempts) {
  if (attempts.length === 0) {
    return { min: 0, p50: 0, p95: 0, max: 0, avg: 0 };
  }
  const sorted = [...attempts].sort((a, b) => a - b);
  const avg = attempts.reduce((sum, value) => sum + value, 0) / attempts.length;
  return {
    min: sorted[0],
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    max: sorted[sorted.length - 1],
    avg: Number(avg.toFixed(2)),
  };
}

function solvePow(nonce, difficulty) {
  for (let candidate = 0; candidate < MAX_POW_ITERATIONS; candidate += 1) {
    const solution = String(candidate);
    const hash = crypto.createHash('sha256').update(nonce + solution).digest('hex');
    if (hash.slice(0, difficulty) === '0'.repeat(difficulty)) {
      return { solution, attempts: candidate + 1 };
    }
  }

  throw new Error(`PoW solve exceeded ${MAX_POW_ITERATIONS} iterations`);
}

let ipCounter = 1;
function nextRemoteAddress() {
  const value = ipCounter;
  ipCounter += 1;
  const b = value & 255;
  const c = (value >> 8) & 255;
  const d = (value >> 16) & 255;
  return `10.${d}.${c}.${b}`;
}

function defaultBehaviorPayload() {
  return {
    mouseData: { straightLineRatio: 0.2, velocity: 150, maxVelocity: 480, directionChanges: 5 },
    timingData: { timeOnPageMs: 2400 },
    keyboardData: { avgDwellTime: 85, avgFlightTime: 45, dwellVariance: 12, flightVariance: 9, totalKeystrokes: 18 },
    canvasData: { canvasHash: 'bench-canvas-hash', isCanvasSupported: true },
    webglData: { renderer: 'Bench GPU', vendor: 'Bench Vendor', hasWebGL: true, webglExtensions: 20, maxTextureSize: 4096, maxRenderbufferSize: 4096 },
    screenData: { width: 1920, height: 1080, colorDepth: 24, pixelRatio: 1 },
    navigatorData: {
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Bench/1.0',
      platform: 'Linux x86_64',
      language: 'en-US',
      timezone: 'UTC',
      timezoneOffset: 0,
      cookiesEnabled: true,
      hardwareConcurrency: 8,
      maxTouchPoints: 0,
    },
    networkData: { latencyMs: 45, effectiveType: '4g', downlink: 30 },
  };
}

async function runTimedScenario(name, cfg, requestFn) {
  const startedAt = new Date().toISOString();
  const statusCounts = {};
  const latencyTracker = createLatencyTracker();
  let requestCount = 0;
  let maxRssBytes = process.memoryUsage().rss;

  const cpuStart = process.cpuUsage();
  const wallStart = performance.now();
  const deadline = Date.now() + cfg.durationMs;

  const workers = Array.from({ length: cfg.concurrency }, async () => {
    while (Date.now() < deadline) {
      const start = performance.now();
      let statusCode = 0;
      try {
        statusCode = await requestFn();
      } catch {
        statusCode = -1;
      }
      const end = performance.now();

      latencyTracker.record(end - start);
      requestCount += 1;
      statusCounts[statusCode] = (statusCounts[statusCode] ?? 0) + 1;
      const rss = process.memoryUsage().rss;
      if (rss > maxRssBytes) maxRssBytes = rss;
    }
  });

  await Promise.all(workers);

  const wallMs = performance.now() - wallStart;
  const cpu = process.cpuUsage(cpuStart);

  return {
    name,
    startedAt,
    durationMs: Number(wallMs.toFixed(2)),
    concurrency: cfg.concurrency,
    requests: requestCount,
    rps: Number((requestCount / (wallMs / 1000)).toFixed(2)),
    latenciesMs: latencyTracker.summarize(),
    statusCodes: statusCounts,
    resources: {
      cpuUserMs: Number((cpu.user / 1000).toFixed(2)),
      cpuSystemMs: Number((cpu.system / 1000).toFixed(2)),
      cpuTotalMs: Number(((cpu.user + cpu.system) / 1000).toFixed(2)),
      maxRssMiB: toMiB(maxRssBytes),
      endRssMiB: toMiB(process.memoryUsage().rss),
    },
  };
}

async function runFullFlowScenario(app, cfg) {
  const startedAt = new Date().toISOString();
  const flowLatencies = [];
  const createLatencies = [];
  const solveLatencies = [];
  const validateLatencies = [];
  const powAttempts = [];
  const statusCounts = {
    create: {},
    solve: {},
    validate: {},
  };

  let successfulFlows = 0;
  let flowCounter = 0;
  let maxRssBytes = process.memoryUsage().rss;

  const cpuStart = process.cpuUsage();
  const wallStart = performance.now();

  const workers = Array.from({ length: cfg.concurrency }, async () => {
    while (true) {
      const currentFlow = flowCounter;
      flowCounter += 1;
      if (currentFlow >= cfg.totalFlows) break;

      const flowStart = performance.now();

      const createStart = performance.now();
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/challenge/create',
        payload: {},
        remoteAddress: nextRemoteAddress(),
      });
      createLatencies.push(performance.now() - createStart);
      statusCounts.create[createRes.statusCode] = (statusCounts.create[createRes.statusCode] ?? 0) + 1;
      if (createRes.statusCode !== 200) {
        flowLatencies.push(performance.now() - flowStart);
        continue;
      }

      const created = createRes.json();
      const pow = solvePow(created.nonce, created.difficulty);
      powAttempts.push(pow.attempts);

      const solveStart = performance.now();
      const solveRes = await app.inject({
        method: 'POST',
        url: '/api/v1/challenge/solve',
        payload: {
          challengeId: created.challengeId,
          sessionId: created.sessionId,
          solution: pow.solution,
          ...defaultBehaviorPayload(),
        },
        remoteAddress: nextRemoteAddress(),
      });
      solveLatencies.push(performance.now() - solveStart);
      statusCounts.solve[solveRes.statusCode] = (statusCounts.solve[solveRes.statusCode] ?? 0) + 1;
      if (solveRes.statusCode !== 200) {
        flowLatencies.push(performance.now() - flowStart);
        continue;
      }

      const solved = solveRes.json();
      if (typeof solved.token !== 'string' || solved.token.length === 0) {
        flowLatencies.push(performance.now() - flowStart);
        continue;
      }

      const validateStart = performance.now();
      const validateRes = await app.inject({
        method: 'POST',
        url: '/api/v1/token/validate',
        payload: { token: solved.token },
        remoteAddress: nextRemoteAddress(),
      });
      validateLatencies.push(performance.now() - validateStart);
      statusCounts.validate[validateRes.statusCode] = (statusCounts.validate[validateRes.statusCode] ?? 0) + 1;

      if (validateRes.statusCode === 200) {
        const validated = validateRes.json();
        if (validated.valid === true) {
          successfulFlows += 1;
        }
      }

      flowLatencies.push(performance.now() - flowStart);
      const rss = process.memoryUsage().rss;
      if (rss > maxRssBytes) maxRssBytes = rss;
    }
  });

  await Promise.all(workers);

  const wallMs = performance.now() - wallStart;
  const cpu = process.cpuUsage(cpuStart);

  return {
    name: 'full_flow',
    startedAt,
    totalFlows: cfg.totalFlows,
    successfulFlows,
    flowSuccessRate: Number(((successfulFlows / cfg.totalFlows) * 100).toFixed(2)),
    durationMs: Number(wallMs.toFixed(2)),
    flowRps: Number((cfg.totalFlows / (wallMs / 1000)).toFixed(2)),
    flowLatenciesMs: summarizeLatencies(flowLatencies),
    stepLatenciesMs: {
      create: summarizeLatencies(createLatencies),
      solve: summarizeLatencies(solveLatencies),
      validate: summarizeLatencies(validateLatencies),
    },
    powAttempts: summarizeAttempts(powAttempts),
    statusCodes: statusCounts,
    resources: {
      cpuUserMs: Number((cpu.user / 1000).toFixed(2)),
      cpuSystemMs: Number((cpu.system / 1000).toFixed(2)),
      cpuTotalMs: Number(((cpu.user + cpu.system) / 1000).toFixed(2)),
      maxRssMiB: toMiB(maxRssBytes),
      endRssMiB: toMiB(process.memoryUsage().rss),
    },
  };
}

async function main() {
  const benchDbPath = resolve(repoRoot, 'data/bench/savannaguard-bench.db');
  rmSync(benchDbPath, { force: true });
  mkdirSync(dirname(benchDbPath), { recursive: true });
  mkdirSync(dirname(outputPath), { recursive: true });

  process.env.SECRET_KEY = process.env.SECRET_KEY ?? 'bench-secret-key';
  process.env.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'bench-admin';
  process.env.DB_PATH = benchDbPath;
  process.env.FEDERATION_ENABLED = 'false';
  process.env.NODE_ENV = 'production';

  const serverModuleUrl = pathToFileURL(resolve(repoRoot, 'packages/server/dist/index.js')).href;
  const { buildServer } = await import(serverModuleUrl);

  const app = buildServer();
  app.log.level = 'silent';
  await app.ready();

  const runStartedAt = new Date().toISOString();
  console.log(`[bench] Starting free baseline run at ${runStartedAt}`);

  const healthScenario = await runTimedScenario('health', benchConfig.health, async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
      remoteAddress: nextRemoteAddress(),
    });
    return response.statusCode;
  });

  const challengeCreateScenario = await runTimedScenario('challenge_create', benchConfig.challengeCreate, async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/challenge/create',
      payload: {},
      remoteAddress: nextRemoteAddress(),
    });
    return response.statusCode;
  });

  const fullFlowScenario = await runFullFlowScenario(app, benchConfig.fullFlow);

  await app.close();

  const runFinishedAt = new Date().toISOString();
  const output = {
    benchmark: 'savannaguard-free-baseline',
    runStartedAt,
    runFinishedAt,
    environment: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      cpuModel: os.cpus()[0]?.model ?? 'unknown',
      cpuCores: os.cpus().length,
      totalMemoryMiB: toMiB(os.totalmem()),
      benchmarkDbPath: benchDbPath,
    },
    configuration: benchConfig,
    scenarios: [healthScenario, challengeCreateScenario, fullFlowScenario],
  };

  writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf-8');

  console.log('[bench] Completed free baseline run.');
  console.log(`[bench] Output written to: ${outputPath}`);
  console.log(`[bench] health rps=${healthScenario.rps} | create rps=${challengeCreateScenario.rps} | full_flow rps=${fullFlowScenario.flowRps}`);
}

main().catch((error) => {
  console.error('[bench] Failed:', error);
  process.exit(1);
});
