export type { ParseResult } from 'mrz';

export type ScanProgress = (stage: 'detecting' | 'ocr' | 'parsing') => void;

export interface OcrResult {
  lines: string[];
  confidence?: number[];
}

export interface DetectionResult {
  crop: ImageData | ArrayBuffer;
  debugImages?: Record<string, unknown>;
}

export interface ScanResult {
  parsed?: import('mrz').ParseResult;
  ocrLines?: string[];
  error?: Error;
  modified?: string[];
}
