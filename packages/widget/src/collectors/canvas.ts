export interface CanvasData {
  canvasHash: string;
  isCanvasSupported: boolean;
}

export function collectCanvasData(): CanvasData {
  const isCanvasSupported = typeof document !== 'undefined' && !!document.createElement('canvas');

  if (!isCanvasSupported) {
    return { canvasHash: 'unsupported', isCanvasSupported: false };
  }

  try {
    const canvas = document.createElement('canvas');
    canvas.width = 200;
    canvas.height = 50;
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      return { canvasHash: 'no-context', isCanvasSupported: true };
    }

    ctx.textBaseline = 'top';
    ctx.font = '14px Arial';
    ctx.fillStyle = '#f60';
    ctx.fillRect(125, 1, 62, 20);
    ctx.fillStyle = '#069';
    ctx.fillText('SavannaGuard', 2, 15);
    ctx.fillStyle = 'rgba(102,204,0,0.7)';
    ctx.fillText('Widget', 4, 17);

    const dataUrl = canvas.toDataURL();
    const hash = simpleHash(dataUrl);

    return { canvasHash: hash, isCanvasSupported: true };
  } catch {
    return { canvasHash: 'error', isCanvasSupported: true };
  }
}

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  const hex = Math.abs(hash).toString(16);
  return hex.padStart(8, '0').slice(-8);
}

export function scoreCanvas(data: CanvasData): number {
  if (!data.isCanvasSupported) return 20;
  if (data.canvasHash === 'unsupported') return 15;
  if (data.canvasHash === 'error' || data.canvasHash === 'no-context') return 30;

  return 70;
}
