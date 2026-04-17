export interface ChallengeResponse {
  challengeId: string;
  nonce: string;
  difficulty: number;
  sessionId: string;
  obfKey: string;
}

export interface SolveResponse {
  success: boolean;
  token: string | null;
  score: number;
  verdict: string;
  federatedSource?: boolean;
}

export interface BehavioralData {
  straightLineRatio: number;
  timeOnPage: number;
  avgDwellTime?: number;
  avgFlightTime?: number;
  dwellVariance?: number;
  flightVariance?: number;
  totalKeystrokes?: number;
  canvasHash?: string;
  isCanvasSupported?: boolean;
  canvasBlankHash?: string;
  webglRendererFromCanvas?: string;
  webglRenderer?: string;
  webglVendor?: string;
  hasWebGL?: boolean;
  webglExtensions?: number;
  maxTextureSize?: number;
  maxRenderbufferSize?: number;
  screenWidth?: number;
  screenHeight?: number;
  colorDepth?: number;
  pixelRatio?: number;
  userAgent?: string;
  platform?: string;
  language?: string;
  timezone?: string;
  timezoneOffset?: number;
  hardwareConcurrency?: number;
  maxTouchPoints?: number;
  networkType?: string;
  networkDownlink?: number;
  latencyMs?: number;
  mouseVelocity?: number;
  maxVelocity?: number;
  directionChanges?: number;
  totalMovement?: number;
  // Timing Oracle data (headless browser detection)
  timingOracle?: {
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
  };
  // Physiological Tremor data (biological human signature)
  tremor?: {
    dominantFrequencyHz: number;
    tremorPowerRatio: number;
    spectralEntropy: number;
    peakToPeakJitter: number;
    sampleCount: number;
  };
  // WebRTC Topology Oracle data (network classification)
  webrtcOracle?: {
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
  };
}
