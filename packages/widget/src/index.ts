import { createChallenge, solveChallenge, setApiUrl } from './api.js';
import { collectMouseData } from './collectors/mouse.js';
import { collectTiming, resetTiming } from './collectors/timing.js';
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

async function run(apiUrl: string): Promise<void> {
  setApiUrl(apiUrl);
  resetTiming();

  const mousePromise = collectMouseData();

  const { challengeId, nonce, difficulty, sessionId } = await createChallenge();

  const worker = new Worker(new URL('./pow.worker.ts', import.meta.url), { type: 'module' });
  try {
    const solution = await new Promise<string>((resolve) => {
      worker.onmessage = (event: MessageEvent<{ solution: string }>) => resolve(event.data.solution);
      worker.postMessage({ nonce, difficulty });
    });

    const { straightLineRatio } = await mousePromise;
    const { timeOnPage } = collectTiming();
    const behavioral: BehavioralData = { straightLineRatio, timeOnPage };

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