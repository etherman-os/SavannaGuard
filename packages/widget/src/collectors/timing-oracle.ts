/**
 * Timing Oracle Collector
 *
 * Detects headless browsers (Puppeteer, Playwright, Selenium) by measuring
 * timing characteristics that differ between real browsers and automation tools.
 *
 * Anti-evasion: Measurement values include random jitter (±10-20%) and
 * collection order is randomized. This prevents replay attacks where a bot
 * records deterministic timing values and replays them verbatim.
 */

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

const HEADLESS_JIT_VARIANCE_THRESHOLD = 0.5;
const HEADLESS_RAF_VARIANCE_THRESHOLD = 2.0;

function jitter(value: number, percent: number): number {
  if (value === 0) return 0;
  const noise = value * (percent / 100) * (Math.random() * 2 - 1);
  return Math.max(0, value + noise);
}

function shuffleArray<T>(array: T[]): T[] {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function createHotFunction() {
  const cache: Array<{ type: string; value: number }> = [];

  return function hotFunction(obj: { type: string; value: number }) {
    const polymorphicPenalty = cache.length > 0 && cache[0].type !== obj.type ? 1 : 0;
    cache.push(obj);
    if (cache.length > 10) cache.shift();

    let result = 0;
    for (let i = 0; i < 100; i++) {
      result += Math.sqrt(obj.value + i) * Math.sin(i);
    }
    return result + polymorphicPenalty;
  };
}

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

    let perfNowMonotonic = true;
    let setTimeoutDrift = 0;
    let datePerfDrift = 0;
    let cryptoTimings = { signTimingMs: 0, deriveTimingMs: 0 };
    let cryptoTimingAvailable = false;
    let hotFunctionTimings: number[] = [];
    let jitPatternVariance = 0;
    let polymorphicTiming = 0;
    let rafLatencyVariance = 0;
    let rafFrameBudgetRatio = 1;
    let rafMetricsAvailable = false;

    type SectionResult = {
      type: string;
      run: () => void;
    };

    const sections: SectionResult[] = shuffleArray([
      {
        type: 'timerAccuracy',
        run: () => {
          performance.now();
          const samples: number[] = [];
          let previousAfter = -Infinity;
          for (let i = 0; i < 10; i++) {
            const before = performance.now();
            // eslint-disable-next-line no-empty
            while (performance.now() === before) {}
            const after = performance.now();
            samples.push(after - before);
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
        },
      },
      {
        type: 'cryptoTiming',
        run: () => {
          // Synchronous measurement (crypto timing was already awaited above)
          if (cryptoTimingAvailable && cryptoTimings.signTimingMs < 1.5) {
            detectionSignals.push('cryptoTooFast');
            headlessScore += 25;
          }
          signalCount++;
        },
      },
      {
        type: 'jitPattern',
        run: () => {
          const hotFn = createHotFunction();
          for (let i = 0; i < 5; i++) {
            const start = performance.now();
            hotFn(getTypeAlternatingObject(i));
            hotFunctionTimings.push(performance.now() - start);
          }
          // Apply jitter to each timing measurement
          hotFunctionTimings = hotFunctionTimings.map(t => jitter(t, 10));

          jitPatternVariance = jitter(calculateVariance(hotFunctionTimings), 15);
          if (calculateVariance(hotFunctionTimings) < HEADLESS_JIT_VARIANCE_THRESHOLD) {
            detectionSignals.push('jitLowVariance');
            headlessScore += 35;
          }
          signalCount++;
        },
      },
      {
        type: 'polymorphic',
        run: () => {
          polymorphicTiming = jitter(measurePolymorphicCalls(), 15);
          if (polymorphicTiming < 0.5) {
            detectionSignals.push('polymorphicTooFast');
            headlessScore += 20;
          }
          signalCount++;
        },
      },
      {
        type: 'raf',
        run: () => {
          if (rafMetricsAvailable) {
            rafLatencyVariance = jitter(rafLatencyVariance, 15);
            rafFrameBudgetRatio = jitter(rafFrameBudgetRatio, 10);
            if (rafLatencyVariance < HEADLESS_RAF_VARIANCE_THRESHOLD) {
              detectionSignals.push('rafLowVariance');
              headlessScore += 20;
            }
            if (rafFrameBudgetRatio < 0.3) {
              detectionSignals.push('rafFrameBudgetLow');
              headlessScore += 15;
            }
          }
          signalCount++;
        },
      },
    ]);

    const asyncMeasurements = await Promise.all([
      measureSetTimeoutDrift(),
      measureDateNowVsPerformanceNowDrift(),
      measureCryptoTiming(),
      measureRAFBehavior(),
    ]);

    setTimeoutDrift = jitter(asyncMeasurements[0], 15);
    datePerfDrift = jitter(asyncMeasurements[1], 15);
    cryptoTimings = asyncMeasurements[2];
    cryptoTimings = {
      signTimingMs: jitter(cryptoTimings.signTimingMs, 20),
      deriveTimingMs: jitter(cryptoTimings.deriveTimingMs, 20),
    };
    cryptoTimingAvailable = true;

    if (asyncMeasurements[3]) {
      rafLatencyVariance = asyncMeasurements[3].latencyVariance;
      rafFrameBudgetRatio = asyncMeasurements[3].frameBudgetRatio;
      rafMetricsAvailable = true;
    }

    // Warm up hot function before JIT section reads it
    const warmFn = createHotFunction();
    for (let i = 0; i < 20; i++) {
      warmFn(getTypeAlternatingObject(i));
    }

    for (const section of sections) {
      section.run();
    }

    // detection signals from async measurements
    if (Math.abs(asyncMeasurements[0]) > 10) {
      detectionSignals.push('setTimeoutDrift');
      headlessScore += 20;
    }
    if (Math.abs(asyncMeasurements[1]) > 50) {
      detectionSignals.push('datePerfDrift');
      headlessScore += 15;
    }
    if (!cryptoTimingAvailable || (cryptoTimingAvailable && asyncMeasurements[2].signTimingMs < 1.5)) {
      if (!cryptoTimingAvailable) {
        detectionSignals.push('cryptoUnavailable');
        headlessScore += 5;
      }
    }
    if (!rafMetricsAvailable) {
      detectionSignals.push('rafUnavailable');
      headlessScore += 5;
    }

    const headlessLikelihood = signalCount > 0
      ? Math.min(100, Math.round(headlessScore))
      : 0;

    return {
      performanceNowMonotonic: perfNowMonotonic,
      setTimeoutDriftMs: parseFloat(setTimeoutDrift.toFixed(2)),
      dateNowVsPerformanceNowDriftMs: parseFloat(datePerfDrift.toFixed(2)),
      cryptoSignTimingMs: parseFloat(cryptoTimings.signTimingMs.toFixed(3)),
      cryptoDeriveTimingMs: parseFloat(cryptoTimings.deriveTimingMs.toFixed(3)),
      hotFunctionTimings: hotFunctionTimings.map(t => parseFloat(t.toFixed(3))),
      jitPatternVariance: parseFloat(jitPatternVariance.toFixed(3)),
      polymorphicCallTimingMs: parseFloat(polymorphicTiming.toFixed(3)),
      rafLatencyVarianceMs: parseFloat(rafLatencyVariance.toFixed(3)),
      rafFrameBudgetRatio: parseFloat(rafFrameBudgetRatio.toFixed(3)),
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

  const signStart = performance.now();
  await crypto.subtle.sign(
    { name: 'ECDSA', hash: { name: 'SHA-256' } },
    key.privateKey,
    data
  );
  const signTimingMs = performance.now() - signStart;

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

function measurePolymorphicCalls(): number {
  const hotFn = createHotFunction();
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

async function measureRAFBehavior(): Promise<{ latencyVariance: number; frameBudgetRatio: number } | null> {
  if (typeof requestAnimationFrame !== 'function') {
    return null;
  }

  const latencies: number[] = [];
  const frameBudgets: number[] = [];
  let completed = 0;
  let lastTimestamp: number | null = null;

  const expectedFrameTime = 16.67;

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

function calculateVariance(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = calculateMean(values);
  const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
  return Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / values.length);
}

function calculateMean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}