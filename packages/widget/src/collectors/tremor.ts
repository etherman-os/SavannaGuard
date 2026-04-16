/**
 * Physiological Tremor Collector
 *
 * Detects the involuntary 8-12 Hz tremor inherent to human motor control.
 * This tremor is a biological constant that bots cannot naturally replicate.
 *
 * Detection approach:
 * 1. Collect mouse velocity time series
 * 2. Apply Hann window to reduce spectral leakage
 * 3. Compute FFT to get frequency spectrum
 * 4. Measure power in 4-12Hz "tremor band" vs total
 * 5. Compute spectral entropy for biological signal characterization
 */

import type { MousePoint } from './mouse.js';

export interface TremorData {
  dominantFrequencyHz: number;    // Primary frequency in 1-20Hz range
  tremorPowerRatio: number;       // Power in 4-12Hz / total power
  spectralEntropy: number;         // Shannon entropy of frequency distribution
  peakToPeakJitter: number;       // Amplitude variation
  sampleCount: number;            // Number of velocity samples
}

// Human physiological tremor range
const TREMOR_MIN_FREQ = 4;  // Hz
const TREMOR_MAX_FREQ = 12; // Hz
const ANALYSIS_MIN_FREQ = 1; // Hz
const ANALYSIS_MAX_FREQ = 20; // Hz
const COLLECTION_MS = 2500; // Collection duration for tremor

/**
 * Compute tremor analysis from raw mouse points
 */
export function analyzeTremor(points: MousePoint[]): TremorData {
  const defaultData: TremorData = {
    dominantFrequencyHz: 0,
    tremorPowerRatio: 0,
    spectralEntropy: 0,
    peakToPeakJitter: 0,
    sampleCount: 0,
  };

  if (points.length < 20) return defaultData;

  // Compute velocity time series
  const velocities = computeVelocities(points);
  if (velocities.length < 20) return defaultData;

  // Compute sample rate (samples per second)
  const dt = (points[points.length - 1].t - points[0].t) / 1000;
  const sampleRate = dt > 0 ? velocities.length / dt : 10;

  // Apply Hann window
  const windowed = applyHannWindow(velocities);

  // Compute FFT magnitude spectrum
  const spectrum = computeFFTMagnitude(windowed);

  // Get frequency bins
  const freqBins = computeFrequencyBins(ANALYSIS_MIN_FREQ, ANALYSIS_MAX_FREQ, spectrum.length, sampleRate);

  // Find dominant frequency
  const dominantFrequencyHz = findDominantFrequency(freqBins, spectrum);

  // Calculate power in tremor band
  const tremorPowerRatio = calculateBandPowerRatio(
    freqBins,
    spectrum,
    TREMOR_MIN_FREQ,
    TREMOR_MAX_FREQ
  );

  // Calculate spectral entropy
  const spectralEntropy = calculateSpectralEntropy(spectrum);

  // Calculate amplitude jitter
  const peakToPeakJitter = calculateJitter(velocities);

  return {
    dominantFrequencyHz: Math.round(dominantFrequencyHz * 10) / 10,
    tremorPowerRatio: Math.round(tremorPowerRatio * 100) / 100,
    spectralEntropy: Math.round(spectralEntropy * 100) / 100,
    peakToPeakJitter: Math.round(peakToPeakJitter * 100) / 100,
    sampleCount: velocities.length,
  };
}

/**
 * Compute velocity time series from mouse points
 */
function computeVelocities(points: MousePoint[]): number[] {
  const velocities: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    const dt = points[i].t - points[i - 1].t;
    if (dt > 0) {
      // Velocity in pixels per millisecond, then convert to deg/sec (approx)
      // Using px/ms * 1000 = px/sec, and we approximate 1px ~ 1deg on screen
      velocities.push(Math.sqrt(dx * dx + dy * dy) / dt * 1000);
    }
  }
  return velocities;
}

/**
 * Apply Hann window to reduce spectral leakage
 */
function applyHannWindow(signal: number[]): number[] {
  const n = signal.length;
  const windowed = new Array(n);
  for (let i = 0; i < n; i++) {
    const window = 0.5 * (1 - Math.cos(2 * Math.PI * i / (n - 1)));
    windowed[i] = signal[i] * window;
  }
  return windowed;
}

/**
 * Compute FFT magnitude using naive DFT (suitable for small N)
 * Returns magnitude spectrum
 */
function computeFFTMagnitude(signal: number[]): number[] {
  const n = signal.length;
  const magnitudes: number[] = [];

  // Only compute first half (positive frequencies)
  const halfN = Math.floor(n / 2);

  for (let k = 0; k < halfN; k++) {
    let real = 0;
    let imag = 0;

    for (let t = 0; t < n; t++) {
      const angle = -2 * Math.PI * k * t / n;
      real += signal[t] * Math.cos(angle);
      imag += signal[t] * Math.sin(angle);
    }

    magnitudes.push(Math.sqrt(real * real + imag * imag) / n);
  }

  return magnitudes;
}

/**
 * Compute frequency for each FFT bin
 */
function computeFrequencyBins(
  minFreq: number,
  maxFreq: number,
  numBins: number,
  sampleRate: number
): number[] {
  const bins: number[] = [];
  const freqResolution = sampleRate / (numBins * 2); // Due to Nyquist

  for (let i = 0; i < numBins; i++) {
    const freq = i * freqResolution;
    if (freq >= minFreq && freq <= maxFreq) {
      bins.push(freq);
    }
  }
  return bins;
}

/**
 * Find dominant frequency in the given range
 */
function findDominantFrequency(freqBins: number[], magnitudes: number[]): number {
  let maxMag = 0;
  let dominantFreq = 0;

  for (let i = 0; i < Math.min(freqBins.length, magnitudes.length); i++) {
    if (magnitudes[i] > maxMag) {
      maxMag = magnitudes[i];
      dominantFreq = freqBins[i];
    }
  }

  return dominantFreq;
}

/**
 * Calculate ratio of power in a specific frequency band vs total
 */
function calculateBandPowerRatio(
  freqBins: number[],
  magnitudes: number[],
  minBand: number,
  maxBand: number
): number {
  let bandPower = 0;
  let totalPower = 0;

  for (let i = 0; i < Math.min(freqBins.length, magnitudes.length); i++) {
    const power = magnitudes[i] * magnitudes[i];
    totalPower += power;

    if (freqBins[i] >= minBand && freqBins[i] <= maxBand) {
      bandPower += power;
    }
  }

  return totalPower > 0 ? bandPower / totalPower : 0;
}

/**
 * Calculate Shannon entropy of frequency spectrum
 * Higher entropy = more natural/biological signal
 */
function calculateSpectralEntropy(magnitudes: number[]): number {
  if (magnitudes.length === 0) return 0;

  // Normalize to probability distribution
  const total = magnitudes.reduce((a, b) => a + b, 0);
  if (total === 0) return 0;

  const probabilities = magnitudes.map(m => m / total);

  // Calculate Shannon entropy
  let entropy = 0;
  for (const p of probabilities) {
    if (p > 0) {
      entropy -= p * Math.log2(p);
    }
  }

  // Normalize by maximum possible entropy (uniform distribution)
  const maxEntropy = Math.log2(probabilities.length);
  return maxEntropy > 0 ? entropy / maxEntropy : 0;
}

/**
 * Calculate peak-to-peak jitter of velocity signal
 * Human tremor causes natural amplitude variation
 */
function calculateJitter(velocities: number[]): number {
  if (velocities.length < 2) return 0;

  const mean = velocities.reduce((a, b) => a + b, 0) / velocities.length;
  if (mean === 0) return 0;

  // Calculate coefficient of variation (CV) as jitter metric
  const squaredDiffs = velocities.map(v => Math.pow(v - mean, 2));
  const variance = squaredDiffs.reduce((a, b) => a + b, 0) / velocities.length;
  const stdDev = Math.sqrt(variance);

  // Return CV (coefficient of variation)
  return stdDev / mean;
}

/**
 * Collect mouse data and analyze for physiological tremor
 */
export async function collectTremor(): Promise<TremorData> {
  const points: MousePoint[] = [];

  const handler = (e: MouseEvent) => {
    points.push({ x: e.clientX, y: e.clientY, t: Date.now() });
  };

  document.addEventListener('mousemove', handler, { passive: true });

  await new Promise((resolve) => setTimeout(resolve, COLLECTION_MS));

  document.removeEventListener('mousemove', handler);

  return analyzeTremor(points);
}
