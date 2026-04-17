export interface WebGLData {
  renderer: string;
  vendor: string;
  hasWebGL: boolean;
  webglExtensions: number;
  maxTextureSize: number;
  maxRenderbufferSize: number;
}

export function collectWebGLData(): WebGLData {
  const hasWebGL = typeof document !== 'undefined';

  if (!hasWebGL) {
    return { renderer: 'none', vendor: 'none', hasWebGL: false, webglExtensions: 0, maxTextureSize: 0, maxRenderbufferSize: 0 };
  }

  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl') as WebGLRenderingContext | null;

    if (!gl) {
      return { renderer: 'no-context', vendor: 'no-context', hasWebGL: true, webglExtensions: 0, maxTextureSize: 0, maxRenderbufferSize: 0 };
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

    const webglExtensions = gl.getSupportedExtensions()?.length ?? 0;
    const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    const maxRenderbufferSize = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number;

    return { renderer, vendor, hasWebGL: true, webglExtensions, maxTextureSize, maxRenderbufferSize };
  } catch {
    return { renderer: 'error', vendor: 'error', hasWebGL: true, webglExtensions: 0, maxTextureSize: 0, maxRenderbufferSize: 0 };
  }
}

function sanitizeString(str: string): string {
  return str.replace(/[^a-zA-Z0-9 ()]/g, '').substring(0, 100);
}