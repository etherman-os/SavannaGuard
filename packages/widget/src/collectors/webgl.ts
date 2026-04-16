export interface WebGLData {
  renderer: string;
  vendor: string;
  hasWebGL: boolean;
}

export function collectWebGLData(): WebGLData {
  const hasWebGL = typeof document !== 'undefined';

  if (!hasWebGL) {
    return { renderer: 'none', vendor: 'none', hasWebGL: false };
  }

  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl') as WebGLRenderingContext | null;

    if (!gl) {
      return { renderer: 'no-context', vendor: 'no-context', hasWebGL: true };
    }

    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');

    let renderer = 'unknown';
    let vendor = 'unknown';

    if (debugInfo) {
      renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || 'unknown';
      vendor = gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) || 'unknown';
    }

    renderer = sanitizeString(renderer);
    vendor = sanitizeString(vendor);

    return { renderer, vendor, hasWebGL: true };
  } catch {
    return { renderer: 'error', vendor: 'error', hasWebGL: true };
  }
}

function sanitizeString(str: string): string {
  return str.replace(/[^a-zA-Z0-9 ()]/g, '').substring(0, 100);
}

export function scoreWebGL(data: WebGLData): number {
  if (!data.hasWebGL) return 15;
  if (data.renderer === 'none' || data.renderer === 'no-context') return 20;
  if (data.renderer === 'error') return 25;

  const isCommonRenderer = data.renderer.toLowerCase().includes('nvidia') ||
    data.renderer.toLowerCase().includes('amd') ||
    data.renderer.toLowerCase().includes('intel') ||
    data.renderer.toLowerCase().includes('apple');

  const isSwiftShader = data.renderer.toLowerCase().includes('swiftshader') ||
    data.renderer.toLowerCase().includes('llvmpipe');

  if (isSwiftShader) return 30;

  if (isCommonRenderer) return 75;

  return 60;
}
