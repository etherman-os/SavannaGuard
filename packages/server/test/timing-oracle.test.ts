/// <reference types="vitest/globals" />
import { scoreTimingOracle, type TimingOracleData } from '../src/services/scoring.js';

function baseTimingData(): TimingOracleData {
  return {
    performanceNowMonotonic: true,
    setTimeoutDriftMs: 1,
    dateNowVsPerformanceNowDriftMs: 2,
    cryptoSignTimingMs: 2,
    cryptoDeriveTimingMs: 2,
    hotFunctionTimings: [0.9, 1.2, 0.8, 1.1, 1.0],
    jitPatternVariance: 0.9,
    polymorphicCallTimingMs: 1.1,
    rafLatencyVarianceMs: 3.2,
    rafFrameBudgetRatio: 0.92,
    headlessLikelihood: 8,
    detectionSignals: [],
  };
}

describe('timing oracle scoring', () => {
  it('testHeadlessDetection', () => {
    const data: TimingOracleData = {
      ...baseTimingData(),
      headlessLikelihood: 92,
      detectionSignals: ['jitLowVariance', 'cryptoTooFast', 'rafLowVariance'],
    };

    const score = scoreTimingOracle(data);
    expect(score).toBeLessThan(20);
  });

  it('testRealBrowserNotFlagged', () => {
    const data: TimingOracleData = {
      ...baseTimingData(),
      headlessLikelihood: 5,
      detectionSignals: [],
    };

    const score = scoreTimingOracle(data);
    expect(score).toBeGreaterThan(85);
  });

  it('returns neutral score when data is missing', () => {
    expect(scoreTimingOracle(undefined)).toBe(50);
    expect(scoreTimingOracle(null)).toBe(50);
  });
});
