import { db } from '../db.js';

interface SignalStats {
  mean: number;
  count: number;
  variance: number;
}

const LEARNING_SIGNALS = [
  'mouse_score',
  'keyboard_score',
  'timing_score',
  'canvas_score',
  'webgl_score',
  'screen_score',
  'navigator_score',
  'network_score',
] as const;

type SignalName = typeof LEARNING_SIGNALS[number];

interface ScoreInput {
  mouseScore: number;
  keyboardScore: number;
  timingScore: number;
  canvasScore: number;
  webglScore: number;
  screenScore: number;
  navigatorScore: number;
  networkScore: number;
}

export interface AdaptiveResult {
  adjustedScore: number;
  confidence: number;
  sampleSize: number;
}

function getSignalStats(signal: SignalName): SignalStats {
  const row = db.prepare(
    'SELECT mean_value, count, stddev FROM site_signals WHERE signal_key = ?'
  ).get(signal) as { mean_value: number; count: number; stddev: number } | undefined;

  if (!row || row.count < 10) {
    return { mean: 50, count: 0, variance: 400 };
  }

  return {
    mean: row.mean_value,
    count: row.count,
    variance: Math.max(row.stddev * row.stddev, 1),
  };
}

function updateSignalStats(signal: SignalName, value: number): void {
  const existing = db.prepare(
    'SELECT mean_value, count, stddev FROM site_signals WHERE signal_key = ?'
  ).get(signal) as { mean_value: number; count: number; stddev: number } | undefined;

  if (!existing || existing.count === 0) {
    db.prepare(
      'INSERT OR REPLACE INTO site_signals (signal_key, signal_name, mean_value, count, stddev, last_updated) VALUES (?, ?, ?, 1, 0, ?)'
    ).run(signal, signal, value, Date.now());
    return;
  }

  const n = existing.count + 1;
  const oldMean = existing.mean_value;
  const newMean = oldMean + (value - oldMean) / n;
  const oldVariance = existing.stddev * existing.stddev;
  const newVariance = n > 2
    ? ((n - 2) * oldVariance + (value - oldMean) * (value - newMean)) / (n - 1)
    : 0;
  const newStddev = Math.sqrt(Math.max(0, newVariance));

  db.prepare(
    'UPDATE site_signals SET mean_value = ?, count = ?, stddev = ?, last_updated = ? WHERE signal_key = ?'
  ).run(newMean, n, newStddev, Date.now(), signal);
}

function gaussianProbability(value: number, stats: SignalStats): number {
  if (stats.count < 10) return 0.5;

  const diff = value - stats.mean;
  const exponent = -(diff * diff) / (2 * stats.variance);
  return Math.exp(exponent);
}

export function adaptScores(scores: ScoreInput): AdaptiveResult {
  const signalValues: Record<SignalName, number> = {
    mouse_score: scores.mouseScore,
    keyboard_score: scores.keyboardScore,
    timing_score: scores.timingScore,
    canvas_score: scores.canvasScore,
    webgl_score: scores.webglScore,
    screen_score: scores.screenScore,
    navigator_score: scores.navigatorScore,
    network_score: scores.networkScore,
  };

  let totalWeight = 0;
  let weightedAnomaly = 0;
  let totalConfidence = 0;
  let sampleCount = 0;

  for (const signal of LEARNING_SIGNALS) {
    const value = signalValues[signal];
    const stats = getSignalStats(signal);

    if (stats.count >= 10) {
      const prob = gaussianProbability(value, stats);
      const weight = stats.count / 100;

      weightedAnomaly += (1 - prob) * weight;
      totalWeight += weight;
      totalConfidence += Math.min(stats.count / 200, 1);
      sampleCount = Math.max(sampleCount, stats.count);
    }
  }

  const anomalyScore = totalWeight > 0 ? weightedAnomaly / totalWeight : 0;
  const confidence = LEARNING_SIGNALS.length > 0 ? totalConfidence / LEARNING_SIGNALS.length : 0;

  const anomalyPenalty = Math.round(anomalyScore * 30 * confidence);

  const rawAvg = LEARNING_SIGNALS.reduce((sum, s) => sum + signalValues[s], 0) / LEARNING_SIGNALS.length;
  const adjustedScore = Math.round(Math.max(0, Math.min(100, rawAvg - anomalyPenalty)));

  return {
    adjustedScore,
    confidence: Math.round(confidence * 100),
    sampleSize: sampleCount,
  };
}

export function learnFromSession(scores: ScoreInput, verdict: string): void {
  if (verdict !== 'human') return;

  const signalValues: Record<SignalName, number> = {
    mouse_score: scores.mouseScore,
    keyboard_score: scores.keyboardScore,
    timing_score: scores.timingScore,
    canvas_score: scores.canvasScore,
    webgl_score: scores.webglScore,
    screen_score: scores.screenScore,
    navigator_score: scores.navigatorScore,
    network_score: scores.networkScore,
  };

  for (const signal of LEARNING_SIGNALS) {
    updateSignalStats(signal, signalValues[signal]);
  }
}

export function getLearningStatus(): Record<string, { mean: number; stddev: number; count: number }> {
  const result: Record<string, { mean: number; stddev: number; count: number }> = {};
  for (const signal of LEARNING_SIGNALS) {
    const stats = getSignalStats(signal);
    result[signal] = { mean: Math.round(stats.mean * 10) / 10, stddev: Math.round(Math.sqrt(stats.variance) * 10) / 10, count: stats.count };
  }
  return result;
}
