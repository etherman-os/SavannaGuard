/**
 * Timing Oracle Collector
 *
 * Detects headless browsers (Puppeteer, Playwright, Selenium) by measuring
 * timing characteristics that differ between real browsers and automation tools.
 *
 * Detection signals:
 * - performance.now() monotonicity
 * - setTimeout accuracy drift
 * - crypto.subtle operation timing
 * - V8 JIT compilation pattern variance
 * - requestAnimationFrame latency variance
 */

export interface TimingOracleData {
  // Timer accuracy tests
  performanceNowMonotonic: boolean;
  setTimeoutDriftMs: number;
  dateNowVsPerformanceNowDriftMs: number;

  // Crypto timing (deterministic in real browsers)
  cryptoSignTimingMs: number;
  cryptoDeriveTimingMs: number;

  // V8 JIT pattern detection
  hotFunctionTimings: number[];
  jitPatternVariance: number;
  polymorphicCallTimingMs: number;

  // RAF behavior
  rafLatencyVarianceMs: number;
  rafFrameBudgetRatio: number;

  // Composite detection
  headlessLikelihood: number;
  detectionSignals: string[];
}

// Threshold constants
const HEADLESS_JIT_VARIANCE_THRESHOLD = 0.5; // Lower variance = automated
const HEADLESS_RAF_VARIANCE_THRESHOLD = 2.0; // Higher variance = real browser

// Hot function for JIT pattern detection
// This specific pattern triggers different V8 optimization behavior
function createHotFunction() {
  const cache: Array<{ type: string; value: number }> = [];

  return function hotFunction(obj: { type: string; value: number }) {
    // Polymorphic inline cache bypass pattern
    // Real JIT recompiles, headless often doesn't
    const polymorphicPenalty = cache.length > 0 && cache[0].type !== obj.type ? 1 : 0;
    cache.push(obj);
    if (cache.length > 10) cache.shift();

    // Mathematical operations that JIT handles differently
    let result = 0;
    for (let i = 0; i < 100; i++) {
      result += Math.sqrt(obj.value + i) * Math.sin(i);
    }
    return result + polymorphicPenalty;
  };
}

// Generate type-alternating objects for IC bypass
function getTypeAlternatingObject(index: number): { type: string; value: number } {
  return index % 2 === 0
    ? { type: 'A', value: index }
    : { type: 'B', value: index * 2 };
}

export async function collectTimingOracle(): Promise<TimingOracleData> {
  const fallback: TimingOracleData = {
    performanceNowMonotonic: true,
    setTimeoutDriftMs: 0,
    dateNowVsPerformanceNowDriftMs: 0,
    cryptoSignTimingMs: 0,
    cryptoDeriveTimingMs: 0,
    hotFunctionTimings: [],
    jitPatternVariance: 0,
    polymorphicCallTimingMs: 0,
    rafLatencyVarianceMs: 0,
    rafFrameBudgetRatio: 1,
    headlessLikelihood: 0,
    detectionSignals: [],
  };

  try {
  const detectionSignals: string[] = [];
  let headlessScore = 0;
  let signalCount = 0;

  // ============================================
  // 1. Timer Accuracy Tests
  // ============================================

  // Test performance.now() monotonicity
  const perfNowSamples: number[] = [];
  let perfNowMonotonic = true;
  let previousAfter = -Infinity;
  for (let i = 0; i < 10; i++) {
    const before = performance.now();
    // eslint-disable-next-line no-empty
    while (performance.now() === before) {}
    const after = performance.now();
    perfNowSamples.push(after - before);
    if (after < previousAfter) {
      perfNowMonotonic = false;
    }
    previousAfter = after;
  }
  if (!perfNowMonotonic) {
    detectionSignals.push('perfNowNonMonotonic');
    headlessScore += 30;
  }
  signalCount++;

  // Test setTimeout accuracy
  const setTimeoutDrift = await measureSetTimeoutDrift();
  if (Math.abs(setTimeoutDrift) > 10) {
    detectionSignals.push('setTimeoutDrift');
    headlessScore += 20;
  }
  signalCount++;

  // Test Date.now() vs performance.now() drift
  const datePerfDrift = measureDateNowVsPerformanceNowDrift();
  if (Math.abs(datePerfDrift) > 50) {
    detectionSignals.push('datePerfDrift');
    headlessScore += 15;
  }
  signalCount++;

  // ============================================
  // 2. Crypto Timing Tests
  // ============================================

  let cryptoTimings = { signTimingMs: 0, deriveTimingMs: 0 };
  let cryptoTimingAvailable = false;
  try {
    cryptoTimings = await measureCryptoTiming();
    cryptoTimingAvailable = true;
  } catch {
    detectionSignals.push('cryptoUnavailable');
    headlessScore += 5;
  }
  // Crypto in headless is often faster due to no sandbox overhead
  if (cryptoTimingAvailable && cryptoTimings.signTimingMs < 1.5) {
    detectionSignals.push('cryptoTooFast');
    headlessScore += 25;
  }
  signalCount++;

  // ============================================
  // 3. V8 JIT Pattern Detection
  // ============================================

  const hotFn = createHotFunction();
  const hotFunctionTimings: number[] = [];

  // Warm up phase
  for (let i = 0; i < 20; i++) {
    hotFn(getTypeAlternatingObject(i));
  }

  // Measure phase - timing of hot function calls
  for (let i = 0; i < 5; i++) {
    const start = performance.now();
    hotFn(getTypeAlternatingObject(i));
    hotFunctionTimings.push(performance.now() - start);
  }

  const jitPatternVariance = calculateVariance(hotFunctionTimings);
  // Headless browsers show suspiciously low variance
  if (jitPatternVariance < HEADLESS_JIT_VARIANCE_THRESHOLD) {
    detectionSignals.push('jitLowVariance');
    headlessScore += 35;
  }
  signalCount++;

  // Polymorphic call timing
  const polymorphicTiming = await measurePolymorphicCalls();
  if (polymorphicTiming < 0.5) {
    detectionSignals.push('polymorphicTooFast');
    headlessScore += 20;
  }
  signalCount++;

  // ============================================
  // 4. requestAnimationFrame Behavior
  // ============================================

  let rafMetrics = { latencyVariance: 0, frameBudgetRatio: 1 };
  let rafMetricsAvailable = false;
  try {
    rafMetrics = await measureRAFBehavior();
    rafMetricsAvailable = true;
  } catch {
    detectionSignals.push('rafUnavailable');
    headlessScore += 5;
  }
  if (rafMetricsAvailable && rafMetrics.latencyVariance < HEADLESS_RAF_VARIANCE_THRESHOLD) {
    detectionSignals.push('rafLowVariance');
    headlessScore += 20;
  }
  if (rafMetricsAvailable && rafMetrics.frameBudgetRatio < 0.3) {
    detectionSignals.push('rafFrameBudgetLow');
    headlessScore += 15;
  }
  signalCount++;

  // ============================================
  // 5. Composite Score
  // ============================================

  const headlessLikelihood = signalCount > 0
    ? Math.min(100, Math.round(headlessScore))
    : 0;

  return {
    performanceNowMonotonic: perfNowMonotonic,
    setTimeoutDriftMs: setTimeoutDrift,
    dateNowVsPerformanceNowDriftMs: datePerfDrift,
    cryptoSignTimingMs: cryptoTimings.signTimingMs,
    cryptoDeriveTimingMs: cryptoTimings.deriveTimingMs,
    hotFunctionTimings,
    jitPatternVariance,
    polymorphicCallTimingMs: polymorphicTiming,
    rafLatencyVarianceMs: rafMetrics.latencyVariance,
    rafFrameBudgetRatio: rafMetrics.frameBudgetRatio,
    headlessLikelihood,
    detectionSignals,
  };
  } catch {
    return {
      ...fallback,
      headlessLikelihood: 50,
      detectionSignals: ['timingOracleError'],
    };
  }
}

// Helper: Measure setTimeout drift
function measureSetTimeoutDrift(): Promise<number> {
  return new Promise((resolve) => {
    const expectedMs = 10;
    const start = performance.now();
    setTimeout(() => {
      const actual = performance.now() - start;
      resolve(actual - expectedMs);
    }, expectedMs);
  });
}

// Helper: Measure Date.now() vs performance.now() drift
function measureDateNowVsPerformanceNowDrift(): number {
  const startPerf = performance.now();
  const startDate = Date.now();
  // eslint-disable-next-line no-empty
  while (performance.now() - startPerf < 100) {}
  const endPerf = performance.now();
  const endDate = Date.now();
  const perfElapsed = endPerf - startPerf;
  const dateElapsed = endDate - startDate;
  return dateElapsed - perfElapsed;
}

// Helper: Measure crypto operation timing
async function measureCryptoTiming(): Promise<{ signTimingMs: number; deriveTimingMs: number }> {
  if (!crypto?.subtle) {
    throw new Error('WebCrypto subtle API unavailable');
  }

  const key = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify']
  );

  const data = new Uint8Array(128);
  crypto.getRandomValues(data);

  // ECDSA sign timing
  const signStart = performance.now();
  await crypto.subtle.sign(
    { name: 'ECDSA', hash: { name: 'SHA-256' } },
    key.privateKey,
    data
  );
  const signTimingMs = performance.now() - signStart;

  // HKDF derive timing
  const hkdfKey = await crypto.subtle.importKey(
    'raw',
    data,
    'HKDF',
    false,
    ['deriveBits']
  );
  const deriveStart = performance.now();
  await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: data, info: new Uint8Array(16) },
    hkdfKey,
    256
  );
  const deriveTimingMs = performance.now() - deriveStart;

  return { signTimingMs, deriveTimingMs };
}

// Helper: Measure polymorphic call timing
async function measurePolymorphicCalls(): Promise<number> {
  const hotFn = createHotFunction();
  // Warm up
  for (let i = 0; i < 50; i++) {
    hotFn(getTypeAlternatingObject(i % 10));
  }

  const timings: number[] = [];
  for (let i = 0; i < 10; i++) {
    const obj = getTypeAlternatingObject(i % 5);
    const start = performance.now();
    hotFn(obj);
    timings.push(performance.now() - start);
  }

  return calculateMean(timings);
}

// Helper: Measure requestAnimationFrame behavior
async function measureRAFBehavior(): Promise<{ latencyVariance: number; frameBudgetRatio: number }> {
  if (typeof requestAnimationFrame !== 'function') {
    throw new Error('requestAnimationFrame unavailable');
  }

  const latencies: number[] = [];
  const frameBudgets: number[] = [];
  let completed = 0;
  let lastTimestamp: number | null = null;

  const expectedFrameTime = 16.67; // 60fps

  return new Promise((resolve) => {
    function measureRAF(timestamp: number) {
      const frameTime = lastTimestamp === null ? expectedFrameTime : timestamp - lastTimestamp;
      lastTimestamp = timestamp;

      const latency = performance.now() - timestamp;
      latencies.push(latency);
      frameBudgets.push(frameTime);

      completed++;
      if (completed < 30) {
        requestAnimationFrame(measureRAF);
      } else {
        const latencyVariance = calculateVariance(latencies);
        const underBudgetCount = frameBudgets.filter(t => t < expectedFrameTime).length;
        const frameBudgetRatio = underBudgetCount / frameBudgets.length;
        resolve({ latencyVariance, frameBudgetRatio });
      }
    }

    requestAnimationFrame(measureRAF);
  });
}

// Helper: Calculate variance
function calculateVariance(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = calculateMean(values);
  const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
  return Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / values.length);
}

// Helper: Calculate mean
function calculateMean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}
