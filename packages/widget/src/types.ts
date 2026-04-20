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
  cookiesEnabled?: boolean;
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

/** Configuration options for the SavannaGuard widget. */
export interface WidgetConfig {
  /** The base URL of the SavannaGuard server API. */
  apiUrl: string;
  /**
   * Optional CSP nonce marker for integrations that require explicit widget re-init
   * under a nonce-scoped page lifecycle.
   */
  cspNonce?: string;
}

/** Callbacks that consumers can hook into for widget lifecycle events. */
export interface WidgetCallbacks {
  /** Called when a verification token is successfully obtained. */
  onSuccess?: (token: string) => void;
  /** Called when verification fails (no token obtained). */
  onError?: (error: Error) => void;
}

/** Public API surface of the SavannaGuard widget exposed on window.SavannaGuard. */
export interface SavannaGuardWidget {
  /**
   * Initialize or re-initialize the widget with a specific API URL.
   * If already running with the same URL, this is a no-op.
   */
  init: (apiUrl: string, config?: { cspNonce?: string }) => void;
  /**
   * Retrieve the current verification token.
   * Returns immediately if a token is already available,
   * otherwise waits for the current challenge cycle to complete.
   */
  getToken: () => Promise<string | null>;
}
