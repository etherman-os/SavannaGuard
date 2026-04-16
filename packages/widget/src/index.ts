import { createChallenge, solveChallenge, setApiUrl } from './api.js';
import { collectMouseData, type MouseData } from './collectors/mouse.js';
import { collectTiming, resetTiming } from './collectors/timing.js';
import { collectKeystrokeData } from './collectors/keystroke.js';
import { collectCanvasData } from './collectors/canvas.js';
import { collectWebGLData } from './collectors/webgl.js';
import { collectScreenData } from './collectors/screen.js';
import { collectNavigatorData } from './collectors/navigator.js';
import { collectNetworkData, measureLatency } from './collectors/network.js';
import type { BehavioralData } from './types.js';

declare global {
  interface Window {
    SavannaGuard: {
      getToken: () => Promise<string | null>;
      init: (apiUrl: string) => void;
    };
  }
}

let pendingToken: string | null = null;
let pendingResolvers: Array<(token: string | null) => void> = [];
let runPromise: Promise<void> | null = null;
let currentApiUrl = '';

function flushPending(token: string | null): void {
  for (const resolve of pendingResolvers) {
    resolve(token);
  }
  pendingResolvers = [];
}

function detectDefaultApiUrl(): string {
  const script = document.currentScript as HTMLScriptElement | null;
  if (script?.src) {
    return new URL(script.src, window.location.href).origin;
  }

  const scripts = document.getElementsByTagName('script');
  for (let i = scripts.length - 1; i >= 0; i--) {
    const src = scripts[i].src;
    if (src.includes('savanna-widget')) {
      return new URL(src, window.location.href).origin;
    }
  }

  return window.location.origin;
}

async function collectAllBehavioralData(): Promise<BehavioralData> {
  const mousePromise = collectMouseData();
  const keystrokePromise = collectKeystrokeData();

  const [mouseData, keystrokeData] = await Promise.all([mousePromise, keystrokePromise]);

  const screenData = collectScreenData();
  const navigatorData = collectNavigatorData();
  const canvasData = collectCanvasData();
  const webglData = collectWebGLData();
  const networkData = collectNetworkData();
  const { timeOnPage } = collectTiming();

  const latency = await measureLatency(currentApiUrl);

  const behavioral: BehavioralData = {
    straightLineRatio: mouseData.straightLineRatio,
    timeOnPage,
    avgDwellTime: keystrokeData.avgDwellTime,
    avgFlightTime: keystrokeData.avgFlightTime,
    dwellVariance: keystrokeData.dwellVariance,
    flightVariance: keystrokeData.flightVariance,
    totalKeystrokes: keystrokeData.totalKeystrokes,
    canvasHash: canvasData.canvasHash,
    isCanvasSupported: canvasData.isCanvasSupported,
    webglRenderer: webglData.renderer,
    webglVendor: webglData.vendor,
    hasWebGL: webglData.hasWebGL,
    screenWidth: screenData.width,
    screenHeight: screenData.height,
    colorDepth: screenData.colorDepth,
    pixelRatio: screenData.pixelRatio,
    userAgent: navigatorData.userAgent,
    platform: navigatorData.platform,
    language: navigatorData.language,
    timezone: navigatorData.timezone,
    timezoneOffset: navigatorData.timezoneOffset,
    hardwareConcurrency: navigatorData.hardwareConcurrency,
    maxTouchPoints: navigatorData.maxTouchPoints,
    networkType: networkData.effectiveType || undefined,
    networkDownlink: networkData.downlink || undefined,
    latencyMs: latency,
    mouseVelocity: mouseData.avgVelocity,
    maxVelocity: mouseData.maxVelocity,
    directionChanges: mouseData.directionChanges,
    totalMovement: mouseData.totalMovement,
  };

  return behavioral;
}

async function run(apiUrl: string): Promise<void> {
  setApiUrl(apiUrl);
  resetTiming();
  currentApiUrl = apiUrl;

  const { challengeId, nonce, difficulty, sessionId } = await createChallenge();

  const worker = new Worker(new URL('./pow.worker.ts', import.meta.url), { type: 'module' });
  try {
    const solution = await new Promise<string>((resolve) => {
      worker.onmessage = (event: MessageEvent<{ solution: string }>) => resolve(event.data.solution);
      worker.postMessage({ nonce, difficulty });
    });

    const behavioral = await collectAllBehavioralData();

    const result = await solveChallenge(challengeId, solution, sessionId, behavioral);
    pendingToken = result.token ?? null;
    flushPending(pendingToken);
  } finally {
    worker.terminate();
  }
}

function ensureRun(apiUrl: string): void {
  const normalizedApiUrl = apiUrl.replace(/\/$/, '');
  if (runPromise && normalizedApiUrl === currentApiUrl) return;

  currentApiUrl = normalizedApiUrl;
  pendingToken = null;

  runPromise = run(normalizedApiUrl)
    .catch(() => {
      pendingToken = null;
      flushPending(null);
    })
    .finally(() => {
      runPromise = null;
    });
}

const defaultApiUrl = detectDefaultApiUrl();
ensureRun(defaultApiUrl);

window.SavannaGuard = {
  init(apiUrl: string) {
    ensureRun(apiUrl);
  },
  getToken(): Promise<string | null> {
    if (pendingToken) return Promise.resolve(pendingToken);
    if (!runPromise) {
      ensureRun(currentApiUrl || defaultApiUrl);
    }
    return new Promise((resolve) => {
      pendingResolvers.push(resolve);
    });
  },
};
