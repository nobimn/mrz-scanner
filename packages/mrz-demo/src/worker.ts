/**
 * Web Worker for MRZ scanning.
 * Runs the heavy CV/ML pipeline off the main thread.
 * Exposed via Comlink for clean RPC-style API.
 *
 * SECURITY: No PII is logged. All processing is local.
 */

import * as Comlink from 'comlink';

interface ScanWorkerResult {
  parsed?: unknown;
  ocrLines?: string[];
  confidence?: number[][];
  error?: string;
}

const api = {
  async scan(imageDataUrl: string): Promise<ScanWorkerResult> {
    const { decode } = await import('image-js');
    const { scanMrz } = await import('@mrz-scanner/scanner');

    try {
      const bytes = Uint8Array.from(atob(imageDataUrl.split(',')[1]), (c) =>
        c.charCodeAt(0),
      );
      const image = decode(bytes);

      const result = await scanMrz(image, {
        modelPath: import.meta.env.BASE_URL + 'mrz-cnn.onnx',
        onProgress: (stage) => {
          self.postMessage({ type: 'progress', stage });
        },
      });

      if (result.error) {
        return { error: result.error.message, ocrLines: result.ocrLines };
      }

      return {
        parsed: result.parsed,
        ocrLines: result.ocrLines,
        confidence: result.confidence,
      };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  },
};

Comlink.expose(api);

export type ScanWorkerApi = typeof api;
