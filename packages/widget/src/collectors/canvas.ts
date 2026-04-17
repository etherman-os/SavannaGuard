export interface CanvasData {
  canvasHash: string;
  isCanvasSupported: boolean;
  canvasBlankHash: string;
  webglRendererFromCanvas: string;
}

export function collectCanvasData(): CanvasData {
  const isCanvasSupported = typeof document !== 'undefined' && !!document.createElement('canvas');

  if (!isCanvasSupported) {
    return { canvasHash: 'unsupported', isCanvasSupported: false, canvasBlankHash: 'unsupported', webglRendererFromCanvas: '' };
  }

  try {
    const canvas = document.createElement('canvas');
    canvas.width = 200;
    canvas.height = 50;
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      return { canvasHash: 'no-context', isCanvasSupported: true, canvasBlankHash: 'no-context', webglRendererFromCanvas: '' };
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
    const canvasHash = simpleHash(dataUrl);

    // Blank canvas hash: same size canvas with only a fill rect, no text
    // Fingerprint blockers often randomize all canvas output including blank ones
    // A real browser should produce different hashes for blank vs text canvas
    const blankCanvas = document.createElement('canvas');
    blankCanvas.width = 200;
    blankCanvas.height = 50;
    const blankCtx = blankCanvas.getContext('2d');
    let canvasBlankHash = 'no-blank-context';
    if (blankCtx) {
      blankCtx.fillStyle = '#f60';
      blankCtx.fillRect(125, 1, 62, 20);
      const blankDataUrl = blankCanvas.toDataURL();
      canvasBlankHash = simpleHash(blankDataUrl);
    }

    // Try to get WebGL renderer from canvas to cross-check with WebGLData
    let webglRendererFromCanvas = '';
    try {
      const glCanvas = document.createElement('canvas');
      const gl = glCanvas.getContext('webgl') || glCanvas.getContext('experimental-webgl') as WebGLRenderingContext | null;
      if (gl) {
        const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
        if (debugInfo) {
          webglRendererFromCanvas = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || '';
          webglRendererFromCanvas = webglRendererFromCanvas.replace(/[^a-zA-Z0-9 ()]/g, '').substring(0, 100);
        }
      }
    } catch {
      // WebGL not available
    }

    return { canvasHash, isCanvasSupported: true, canvasBlankHash, webglRendererFromCanvas };
  } catch {
    return { canvasHash: 'error', isCanvasSupported: true, canvasBlankHash: 'error', webglRendererFromCanvas: '' };
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