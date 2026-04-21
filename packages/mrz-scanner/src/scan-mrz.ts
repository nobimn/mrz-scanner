/**
 * Full MRZ scanning pipeline: detect -> OCR -> parse.
 *
 * This is the main entry point that orchestrates the three stages:
 * 1. Localize the MRZ region in the document image
 * 2. Recognize characters using the ONNX CNN model
 * 3. Parse and validate the MRZ data with error correction
 */

import type { Image } from 'image-js';
import { getMrz } from '@mrz-scanner/detection';
import { MrzOcr } from '@mrz-scanner/ocr';
import { parse, type ParseResult, type ScanProgress } from '@mrz-scanner/core';

export interface ScanMrzOptions {
  /** URL or file path to the ONNX model */
  modelPath?: string;
  /** Progress callback for UI feedback */
  onProgress?: ScanProgress;
  /** Enable debug mode (returns intermediate images) */
  debug?: boolean;
}

export interface ScanMrzResult {
  /** Parsed and validated MRZ fields */
  parsed?: ParseResult;
  /** Raw OCR text lines */
  ocrLines?: string[];
  /** Per-character confidence scores */
  confidence?: number[][];
  /** Error if any stage failed */
  error?: Error;
  /** Debug images from the detection stage */
  debugImages?: Record<string, unknown>;
}

let sharedOcr: MrzOcr | null = null;

/**
 * Scan a document image for MRZ data.
 *
 * @param image - An image-js Image of the document
 * @param options - Configuration options
 * @returns Parsed MRZ result with fields, or error details
 *
 * @example
 * ```ts
 * import { Image } from 'image-js';
 * import { scanMrz } from '@mrz-scanner/scanner';
 *
 * const image = await Image.load('passport.jpg');
 * const result = await scanMrz(image);
 * if (result.parsed?.valid) {
 *   console.log(result.parsed.fields);
 * }
 * ```
 */
export async function scanMrz(
  image: Image,
  options: ScanMrzOptions = {},
): Promise<ScanMrzResult> {
  const { onProgress, debug = false } = options;
  const result: ScanMrzResult = {};

  // Initialize OCR engine
  onProgress?.('detecting');
  if (!sharedOcr) {
    sharedOcr = new MrzOcr({ modelPath: options.modelPath });
    await sharedOcr.init();
  }

  try {
    // Stage 1: Detect MRZ region
    const detection = getMrz(image, { debug });
    if (debug) result.debugImages = detection.debugImages;

    // Stage 2: OCR the detected region
    onProgress?.('ocr');
    const ocrResult = await sharedOcr.recognize(detection.crop);
    result.ocrLines = ocrResult.lines;
    result.confidence = ocrResult.confidence;

    // Stage 3: Parse with error correction
    onProgress?.('parsing');
    result.parsed = parse(ocrResult.lines);
  } catch (detectionError) {
    // Detection failed -- the image might already be a cropped MRZ region.
    // Try OCR directly on the full image as a fallback.
    try {
      onProgress?.('ocr');
      const ocrResult = await sharedOcr.recognize(image);
      if (ocrResult.lines.length > 0) {
        result.ocrLines = ocrResult.lines;
        result.confidence = ocrResult.confidence;
        onProgress?.('parsing');
        result.parsed = parse(ocrResult.lines);
      } else {
        // Neither detection nor direct OCR worked
        result.error = detectionError instanceof Error
          ? detectionError
          : new Error(String(detectionError));
      }
    } catch {
      result.error = detectionError instanceof Error
        ? detectionError
        : new Error(String(detectionError));
    }
  }

  return result;
}
