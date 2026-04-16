import { db } from '../db.js';

export interface SignalScores {
  mouseScore: number;
  keyboardScore: number;
  timingScore: number;
  canvasScore: number;
  webglScore: number;
  screenScore: number;
  navigatorScore: number;
  networkScore: number;
  timingOracleScore: number;
  tremorScore: number;
  webrtcOracleScore: number;
  overallScore: number;
}

const DEFAULT_WEIGHTS = {
  pow: 0.28,
  mouse: 0.10,
  keyboard: 0.07,
  timing: 0.07,
  canvas: 0.06,
  webgl: 0.06,
  screen: 0.04,
  navigator: 0.04,
  network: 0.03,
  timingOracle: 0.08,
  tremor: 0.08,
  webrtcOracle: 0.09,
};

export function calculateOverallScore(
  powScore: number,
  signalScores: SignalScores
): number {
  const { mouseScore, keyboardScore, timingScore, canvasScore, webglScore, screenScore, navigatorScore, networkScore, timingOracleScore, tremorScore, webrtcOracleScore } = signalScores;

  const weighted =
    powScore * DEFAULT_WEIGHTS.pow +
    mouseScore * DEFAULT_WEIGHTS.mouse +
    keyboardScore * DEFAULT_WEIGHTS.keyboard +
    timingScore * DEFAULT_WEIGHTS.timing +
    canvasScore * DEFAULT_WEIGHTS.canvas +
    webglScore * DEFAULT_WEIGHTS.webgl +
    screenScore * DEFAULT_WEIGHTS.screen +
    navigatorScore * DEFAULT_WEIGHTS.navigator +
    networkScore * DEFAULT_WEIGHTS.network +
    timingOracleScore * DEFAULT_WEIGHTS.timingOracle +
    tremorScore * DEFAULT_WEIGHTS.tremor +
    webrtcOracleScore * DEFAULT_WEIGHTS.webrtcOracle;

  return Math.round(Math.max(0, Math.min(100, weighted)));
}

export function getVerdict(score: number): 'human' | 'bot' | 'suspicious' {
  if (score >= 70) return 'human';
  if (score >= 40) return 'suspicious';
  return 'bot';
}

export function scoreMouse(straightLineRatio: number | undefined): number {
  if (typeof straightLineRatio !== 'number' || !Number.isFinite(straightLineRatio)) return 50;
  const ratio = Math.max(0, Math.min(1, straightLineRatio));
  if (ratio > 0.95) return 0;
  if (ratio > 0.9) return 15;
  if (ratio > 0.8) return 30;
  if (ratio > 0.6) return 60;
  if (ratio > 0.4) return 80;
  return 90;
}

export function scoreTiming(timeOnPageMs: number | undefined): number {
  if (typeof timeOnPageMs !== 'number' || !Number.isFinite(timeOnPageMs)) return 50;
  if (timeOnPageMs < 500) return 10;
  if (timeOnPageMs < 1000) return 25;
  if (timeOnPageMs < 2000) return 45;
  if (timeOnPageMs < 4000) return 65;
  if (timeOnPageMs <= 10 * 60 * 1000) return 85;
  return 55;
}

export function scoreKeystroke(data: {
  avgDwellTime?: number;
  avgFlightTime?: number;
  dwellVariance?: number;
  flightVariance?: number;
  totalKeystrokes?: number;
}): number {
  let score = 50;

  const keystrokes = data.totalKeystrokes ?? 0;
  if (keystrokes === 0) return 40;
  if (keystrokes < 5) score -= 15;
  else if (keystrokes > 20) score += 10;

  const dwell = data.avgDwellTime ?? 80;
  if (dwell < 30 || dwell > 300) score -= 10;

  const dwellVar = data.dwellVariance ?? 50;
  if (dwellVar < 5 && keystrokes > 10) score -= 25;

  const flight = data.avgFlightTime ?? 120;
  if (flight < 30) score -= 10;

  const flightVar = data.flightVariance ?? 80;
  if (flightVar < 10 && keystrokes > 10) score -= 20;

  return Math.max(0, Math.min(100, score));
}

export function scoreCanvas(isCanvasSupported: boolean | undefined, canvasHash: string | undefined): number {
  if (!isCanvasSupported) return 15;
  if (!canvasHash || canvasHash === 'unsupported' || canvasHash === 'error' || canvasHash === 'no-context') return 25;
  return 70;
}

export function scoreWebGL(hasWebGL: boolean | undefined, renderer: string | undefined): number {
  if (!hasWebGL) return 15;
  if (!renderer || renderer === 'none' || renderer === 'no-context' || renderer === 'error') return 25;

  const lower = renderer.toLowerCase();
  if (lower.includes('swiftshader') || lower.includes('llvmpipe')) return 30;

  return 75;
}

export function scoreScreen(screenWidth: number | undefined, screenHeight: number | undefined): number {
  if (!screenWidth || !screenHeight || screenWidth === 0 || screenHeight === 0) return 20;
  if (screenWidth < 320 || screenHeight < 240) return 25;

  const commonResolutions = [
    [1920, 1080], [1366, 768], [1536, 864], [1440, 900],
    [1280, 720], [2560, 1440], [3840, 2160], [1600, 900],
    [1280, 800], [1280, 1024], [1024, 768], [800, 600],
  ];

  const isCommon = commonResolutions.some(
    ([w, h]) => Math.abs(screenWidth - w) < 50 && Math.abs(screenHeight - h) < 50
  );

  return isCommon ? 80 : 60;
}

export function scoreNavigator(data: {
  userAgent?: string;
  platform?: string;
  language?: string;
  cookiesEnabled?: boolean;
  hardwareConcurrency?: number;
  maxTouchPoints?: number;
}): number {
  let score = 55;

  const ua = data.userAgent ?? '';
  if (!ua || ua === 'unknown' || ua.length < 20) {
    score -= 20;
  }

  const isHeadless = ua.toLowerCase().includes('headless') ||
    ua.toLowerCase().includes('phantom') ||
    ua.toLowerCase().includes('puppeteer') ||
    ua.toLowerCase().includes('selenium');

  if (isHeadless) score -= 30;

  if (!data.cookiesEnabled) score -= 10;

  const cores = data.hardwareConcurrency ?? 0;
  if (cores === 0) score -= 10;
  else if (cores >= 4) score += 10;

  if ((data.maxTouchPoints ?? 0) > 0) score += 5;

  const commonBrowsers = ['chrome', 'firefox', 'safari', 'edge', 'opera', 'brave'];
  const isCommonBrowser = commonBrowsers.some(b => ua.toLowerCase().includes(b));
  if (isCommonBrowser) score += 10;

  return Math.max(0, Math.min(100, score));
}

export function scoreNetwork(latencyMs: number | undefined, effectiveType: string | undefined): number {
  let score = 60;

  const latency = latencyMs ?? 0;
  if (latency > 500) score -= 15;
  else if (latency > 200) score -= 5;
  else if (latency > 0 && latency < 100) score += 10;

  if (effectiveType === 'slow-2g') score -= 20;
  else if (effectiveType === '2g') score -= 15;
  else if (effectiveType === '3g') score -= 5;
  else if (effectiveType === '4g') score += 10;

  return Math.max(0, Math.min(100, score));
}

export interface TimingOracleData {
  performanceNowMonotonic: boolean;
  setTimeoutDriftMs: number;
  dateNowVsPerformanceNowDriftMs: number;
  cryptoSignTimingMs: number;
  cryptoDeriveTimingMs: number;
  hotFunctionTimings: number[];
  jitPatternVariance: number;
  polymorphicCallTimingMs: number;
  rafLatencyVarianceMs: number;
  rafFrameBudgetRatio: number;
  headlessLikelihood: number;
  detectionSignals: string[];
}

export function scoreTimingOracle(data: TimingOracleData | null | undefined): number {
  // If no timing oracle data, return neutral score
  if (!data) return 50;

  // headlessLikelihood is 0-100, higher means more likely headless
  // We invert it: 0 = definitely headless, 100 = definitely real browser
  const baseScore = 100 - data.headlessLikelihood;

  // Additional penalties based on specific detection signals
  let penalty = 0;
  const signals = data.detectionSignals ?? [];

  if (signals.includes('perfNowNonMonotonic')) penalty += 15;
  if (signals.includes('setTimeoutDrift')) penalty += 10;
  if (signals.includes('datePerfDrift')) penalty += 10;
  if (signals.includes('cryptoTooFast')) penalty += 20;
  if (signals.includes('jitLowVariance')) penalty += 25;
  if (signals.includes('polymorphicTooFast')) penalty += 15;
  if (signals.includes('rafLowVariance')) penalty += 15;
  if (signals.includes('rafFrameBudgetLow')) penalty += 10;

  return Math.max(0, Math.min(100, baseScore - penalty));
}

export interface TremorData {
  dominantFrequencyHz: number;
  tremorPowerRatio: number;
  spectralEntropy: number;
  peakToPeakJitter: number;
  sampleCount: number;
}

export function scoreTremor(data: TremorData | null | undefined): number {
  // If no tremor data, return neutral score
  if (!data || data.sampleCount < 20) return 50;

  let score = 60;

  // Check dominant frequency in human tremor range (4-12 Hz)
  if (data.dominantFrequencyHz < 4 || data.dominantFrequencyHz > 12) {
    score -= 30; // wrong frequency band
  }

  // Check power ratio - human tremor should have energy in 4-12Hz band
  if (data.tremorPowerRatio < 0.15) {
    score -= 25; // not enough biological tremor
  }

  // Check spectral entropy - real biological signals have entropy
  if (data.spectralEntropy < 0.35) {
    score -= 20; // too deterministic = bot
  }

  return Math.max(0, Math.min(100, score));
}

export interface WebRTCOracleData {
  iceCandidateCount: number;
  localIPCount: number;
  hasRFC1918Local: boolean;
  hasSrflxCandidate: boolean;
  hasRelayedCandidate: boolean;
  hasPrflxCandidate: boolean;
  likelyDatacenter: boolean;
  likelyVPN: boolean;
  networkComplexity: number;
  collected: boolean;
}

export function scoreWebRTCOracle(data: WebRTCOracleData | null | undefined): number {
  // If unavailable, return neutral score
  if (!data || !data.collected) return 50;

  let score = 55;

  // No candidates at all = suspicious (likely headless)
  if (data.iceCandidateCount === 0) {
    return 30; // likely headless or blocked
  }

  // Single interface / datacenter signal
  if (data.likelyDatacenter) {
    score -= 35;
  }

  // VPN detection
  if (data.likelyVPN) {
    score -= 15;
  }

  // Positive signals: NAT traversal successful
  if (data.hasRFC1918Local) score += 10;
  if (data.hasSrflxCandidate) score += 15;
  if (data.hasRelayedCandidate) score += 5; // real network constraints

  return Math.max(0, Math.min(100, score));
}

export function calculateAllScores(behavioral: Record<string, unknown>): SignalScores {
  const mouseScore = scoreMouse(behavioral.straightLineRatio as number | undefined);
  const timingScore = scoreTiming(behavioral.timeOnPage as number | undefined);
  const keyboardScore = scoreKeystroke({
    avgDwellTime: behavioral.avgDwellTime as number | undefined,
    avgFlightTime: behavioral.avgFlightTime as number | undefined,
    dwellVariance: behavioral.dwellVariance as number | undefined,
    flightVariance: behavioral.flightVariance as number | undefined,
    totalKeystrokes: behavioral.totalKeystrokes as number | undefined,
  });
  const canvasScore = scoreCanvas(
    behavioral.isCanvasSupported as boolean | undefined,
    behavioral.canvasHash as string | undefined
  );
  const webglScore = scoreWebGL(
    behavioral.hasWebGL as boolean | undefined,
    behavioral.renderer as string | undefined
  );
  const screenScore = scoreScreen(
    behavioral.screenWidth as number | undefined,
    behavioral.screenHeight as number | undefined
  );
  const navigatorScore = scoreNavigator({
    userAgent: behavioral.userAgent as string | undefined,
    platform: behavioral.platform as string | undefined,
    language: behavioral.language as string | undefined,
    cookiesEnabled: behavioral.cookiesEnabled as boolean | undefined,
    hardwareConcurrency: behavioral.hardwareConcurrency as number | undefined,
    maxTouchPoints: behavioral.maxTouchPoints as number | undefined,
  });
  const networkScore = scoreNetwork(
    behavioral.latencyMs as number | undefined,
    behavioral.networkType as string | undefined
  );
  const timingOracleScore = scoreTimingOracle(
    behavioral.timingOracle as TimingOracleData | undefined
  );
  const tremorScore = scoreTremor(
    behavioral.tremor as TremorData | undefined
  );
  const webrtcOracleScore = scoreWebRTCOracle(
    behavioral.webrtcOracle as WebRTCOracleData | undefined
  );

  return {
    mouseScore,
    keyboardScore,
    timingScore,
    canvasScore,
    webglScore,
    screenScore,
    navigatorScore,
    networkScore,
    timingOracleScore,
    tremorScore,
    webrtcOracleScore,
    overallScore: 0,
  };
}

export function learnFromHuman(sessionId: string, finalScore: number): void {
  if (finalScore < 70) return;

  try {
    db.prepare(
      'INSERT OR REPLACE INTO sessions (id, created_at, ip_hash, user_agent, final_score, verdict) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(sessionId, Date.now(), '', '', finalScore, 'human');
  } catch {
    // Ignore learning errors
  }
}
