export interface ScreenData {
  width: number;
  height: number;
  colorDepth: number;
  pixelRatio: number;
  availableWidth: number;
  availableHeight: number;
}

export function collectScreenData(): ScreenData {
  if (typeof window === 'undefined' || typeof screen === 'undefined') {
    return {
      width: 0,
      height: 0,
      colorDepth: 0,
      pixelRatio: 1,
      availableWidth: 0,
      availableHeight: 0,
    };
  }

  return {
    width: screen.width,
    height: screen.height,
    colorDepth: screen.colorDepth,
    pixelRatio: window.devicePixelRatio || 1,
    availableWidth: screen.availWidth,
    availableHeight: screen.availHeight,
  };
}

export function scoreScreen(data: ScreenData): number {
  if (data.width === 0 || data.height === 0) return 20;

  if (data.width < 320 || data.height < 240) return 25;

  const commonResolutions = [
    [1920, 1080], [1366, 768], [1536, 864], [1440, 900],
    [1280, 720], [2560, 1440], [3840, 2160], [1600, 900],
    [1280, 800], [1280, 1024], [1024, 768], [800, 600],
  ];

  const isCommon = commonResolutions.some(
    ([w, h]) => Math.abs(data.width - w) < 50 && Math.abs(data.height - h) < 50
  );

  if (isCommon) return 75;

  if (data.width > 7680 || data.height > 4320) return 55;

  return 65;
}
