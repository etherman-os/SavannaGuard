export interface NavigatorData {
  userAgent: string;
  platform: string;
  language: string;
  timezone: string;
  timezoneOffset: number;
  cookiesEnabled: boolean;
  doNotTrack: string | null;
  hardwareConcurrency: number;
  deviceMemory: number | null;
  maxTouchPoints: number;
  pdfViewerEnabled: boolean;
}

export function collectNavigatorData(): NavigatorData {
  if (typeof navigator === 'undefined') {
    return {
      userAgent: 'unknown',
      platform: 'unknown',
      language: 'unknown',
      timezone: 'unknown',
      timezoneOffset: 0,
      cookiesEnabled: false,
      doNotTrack: null,
      hardwareConcurrency: 0,
      deviceMemory: null,
      maxTouchPoints: 0,
      pdfViewerEnabled: false,
    };
  }

  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  return {
    userAgent: navigator.userAgent,
    platform: navigator.platform || 'unknown',
    language: navigator.language || 'unknown',
    timezone,
    timezoneOffset: new Date().getTimezoneOffset(),
    cookiesEnabled: navigator.cookieEnabled,
    doNotTrack: navigator.doNotTrack || null,
    hardwareConcurrency: navigator.hardwareConcurrency || 0,
    deviceMemory: (navigator as Record<string, unknown>)['deviceMemory'] as number | null || null,
    maxTouchPoints: navigator.maxTouchPoints || 0,
    pdfViewerEnabled: (navigator as Record<string, unknown>)['pdfViewerEnabled'] as boolean || false,
  };
}

export function scoreNavigator(data: NavigatorData): number {
  let score = 65;

  if (!data.cookiesEnabled) score -= 10;

  if (data.hardwareConcurrency === 0) score -= 10;
  else if (data.hardwareConcurrency >= 4) score += 10;

  if (data.maxTouchPoints > 0) {
    score += 5;
  }

  if (data.userAgent === 'unknown' || data.userAgent.length < 20) {
    score -= 20;
  }

  const isHeadless = data.userAgent.toLowerCase().includes('headless') ||
    data.userAgent.toLowerCase().includes('phantom') ||
    data.userAgent.toLowerCase().includes('puppeteer') ||
    data.userAgent.toLowerCase().includes('selenium');

  if (isHeadless) score -= 25;

  const commonBrowsers = ['chrome', 'firefox', 'safari', 'edge', 'opera', 'brave'];
  const isCommonBrowser = commonBrowsers.some(b => data.userAgent.toLowerCase().includes(b));
  if (isCommonBrowser) score += 10;

  return Math.max(0, Math.min(100, score));
}
