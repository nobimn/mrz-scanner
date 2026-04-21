/**
 * MRZ character recognition using an ONNX CNN model.
 *
 * Replaces the old HOG+SVM pipeline with a small convolutional neural network
 * that runs via onnxruntime-web (browser WASM/WebGPU) or onnxruntime-node (server).
 *
 * The CNN takes 20x20 greyscale character images and classifies them into
 * one of 37 MRZ symbols (0-9, A-Z, <).
 */

import {
  type Image,
  type Roi,
  grey as toGrey,
  threshold,
  fromMask,
  getRois,
  crop,
  resize,
} from 'image-js';
import { MRZ_SYMBOLS } from './symbols.js';

// ONNX Runtime type -- compatible interface between onnxruntime-web and onnxruntime-node
interface OrtModule {
  InferenceSession: {
    create(
      path: string,
      options?: { executionProviders?: string[] },
    ): Promise<OrtSession>;
  };
  Tensor: new (type: string, data: Float32Array, dims: number[]) => OrtTensor;
}

interface OrtSession {
  run(feeds: Record<string, OrtTensor>): Promise<Record<string, OrtTensor>>;
}

interface OrtTensor {
  data: Float32Array;
}

export interface MrzOcrOptions {
  /** URL or file path to the ONNX model */
  modelPath?: string;
  /** Minimum characters per line to be considered valid */
  minCharsPerLine?: number;
  /** Maximum number of MRZ lines to keep */
  maxLines?: number;
  /** Provide the ONNX Runtime module directly (for Node.js, pass `import('onnxruntime-node')`) */
  ort?: OrtModule;
}

export interface CharPrediction {
  char: string;
  confidence: number;
}

export interface MrzOcrResult {
  lines: string[];
  confidence: number[][];
}

/** Maximum image size to process (prevents OOM on malicious input) */
const MAX_IMAGE_PIXELS = 20_000_000; // 20 megapixels

/**
 * Validate the model path to prevent path traversal and SSRF attacks.
 * Allows: relative paths without '..' and absolute /paths, or http(s) URLs to .onnx files.
 * Rejects: paths containing '..', non-onnx URLs, file:// protocol.
 */
function validateModelPath(modelPath: string): void {
  // Block path traversal
  if (modelPath.includes('..')) {
    throw new Error('Invalid model path: path traversal (..) not allowed');
  }

  // If it looks like a URL, validate it
  if (modelPath.startsWith('http://') || modelPath.startsWith('https://')) {
    if (!modelPath.endsWith('.onnx')) {
      throw new Error('Invalid model URL: must end with .onnx');
    }
    return;
  }

  // Block other URL schemes (file://, ftp://, data:, etc.)
  if (/^[a-z]+:\/\//i.test(modelPath)) {
    throw new Error('Invalid model path: only http(s) URLs or local paths allowed');
  }

  // Must end with .onnx
  if (!modelPath.endsWith('.onnx')) {
    throw new Error('Invalid model path: must end with .onnx');
  }
}

// ROI options for character segmentation (Otsu thresholding)
const ROI_OPTIONS = {
  positive: true,
  negative: false,
  minSurface: 5,
  minRatio: 0.3,
  maxRatio: 3.0,
  algorithm: 'otsu' as const,
};

/**
 * ONNX-based MRZ OCR engine.
 *
 * Usage:
 *   const ocr = new MrzOcr({ modelPath: './mrz-cnn.onnx' });
 *   await ocr.init();
 *   const result = await ocr.recognize(croppedMrzImage);
 */
export class MrzOcr {
  private session: OrtSession | null = null;
  private ort: OrtModule | null = null;
  private options: Required<Pick<MrzOcrOptions, 'modelPath' | 'minCharsPerLine' | 'maxLines'>>;
  private ortOverride: OrtModule | undefined;

  constructor(options: MrzOcrOptions = {}) {
    const modelPath = options.modelPath ?? 'mrz-cnn.onnx';
    validateModelPath(modelPath);
    this.options = {
      modelPath,
      minCharsPerLine: options.minCharsPerLine ?? 5,
      maxLines: options.maxLines ?? 3,
    };
    this.ortOverride = options.ort;
  }

  /**
   * Initialize the ONNX inference session.
   * Must be called before recognize().
   *
   * In the browser, onnxruntime-web is imported automatically.
   * In Node.js, pass the ort module via the constructor:
   *   new MrzOcr({ ort: await import('onnxruntime-node') })
   */
  async init(): Promise<void> {
    if (this.ortOverride) {
      this.ort = this.ortOverride;
    } else {
      // Browser: import onnxruntime-web
      this.ort = (await import('onnxruntime-web')) as unknown as OrtModule;
    }
    this.session = await this.ort.InferenceSession.create(this.options.modelPath, {
      executionProviders: ['wasm'],
    });
  }

  /**
   * Recognize MRZ text from a cropped MRZ image.
   * The image should contain just the MRZ region (output of detection stage).
   */
  async recognize(image: Image): Promise<MrzOcrResult> {
    if (image.width * image.height > MAX_IMAGE_PIXELS) {
      throw new Error(
        `Image too large (${image.width}x${image.height}). Max ${MAX_IMAGE_PIXELS} pixels.`,
      );
    }
    const { charImages, lineBreaks } = this.segmentCharacters(image);

    if (charImages.length === 0) {
      return { lines: [], confidence: [] };
    }

    const predictions = await this.predictBatch(charImages);

    // Reconstruct lines from predictions
    const lines: string[] = [];
    const confidence: number[][] = [];
    let lineChars = '';
    let lineConf: number[] = [];
    let charIdx = 0;

    for (let i = 0; i < predictions.length; i++) {
      if (lineBreaks.includes(i) && lineChars.length > 0) {
        lines.push(lineChars);
        confidence.push(lineConf);
        lineChars = '';
        lineConf = [];
      }
      lineChars += predictions[charIdx].char;
      lineConf.push(predictions[charIdx].confidence);
      charIdx++;
    }
    if (lineChars.length > 0) {
      lines.push(lineChars);
      confidence.push(lineConf);
    }

    return { lines, confidence };
  }

  /**
   * Segment the MRZ image into individual character images.
   * Uses Otsu thresholding and connected component analysis.
   */
  private segmentCharacters(image: Image): {
    charImages: Image[];
    lineBreaks: number[];
  } {
    const greyImg = image.colorModel === 'GREY' ? image : toGrey(image);
    const mask = threshold(greyImg, { algorithm: ROI_OPTIONS.algorithm });

    // Find connected components for character ROIs.
    // MRZ has dark text on light background, so after Otsu thresholding
    // the characters are the black regions. We need to invert the mask
    // so characters become white (positive) ROIs, or request black ROIs.
    const roiManager = fromMask(mask);

    // Try black ROIs first (dark characters), fall back to white
    let allRois = getRois(roiManager, {
      minSurface: ROI_OPTIONS.minSurface,
      kind: 'black',
    });
    if (allRois.length === 0) {
      allRois = getRois(roiManager, {
        minSurface: ROI_OPTIONS.minSurface,
        kind: 'white',
      });
    }

    if (allRois.length === 0) {
      return { charImages: [], lineBreaks: [] };
    }

    interface RoiInfo {
      roi: Roi;
      minX: number;
      minY: number;
      maxX: number;
      maxY: number;
      width: number;
      height: number;
      centerY: number;
    }

    // Group ROIs into lines by Y-coordinate clustering
    const sortedRois: RoiInfo[] = allRois
      .map((roi) => ({
        roi,
        minX: roi.origin.column,
        minY: roi.origin.row,
        maxX: roi.origin.column + roi.width,
        maxY: roi.origin.row + roi.height,
        width: roi.width,
        height: roi.height,
        centerY: roi.origin.row + roi.height / 2,
      }))
      .filter((r) => {
        const ratio = r.width / r.height;
        return ratio >= ROI_OPTIONS.minRatio && ratio <= ROI_OPTIONS.maxRatio;
      });

    // Cluster into lines by Y-coordinate
    const lineThreshold = image.height / 6; // rough line height estimate
    const lines: RoiInfo[][] = [];
    let currentLine: RoiInfo[] = [];

    const ySorted = [...sortedRois].sort((a, b) => a.centerY - b.centerY);
    for (const roi of ySorted) {
      if (
        currentLine.length === 0 ||
        Math.abs(roi.centerY - currentLine[0].centerY) < lineThreshold
      ) {
        currentLine.push(roi);
      } else {
        lines.push(currentLine);
        currentLine = [roi];
      }
    }
    if (currentLine.length > 0) lines.push(currentLine);

    // Filter lines with too few characters and keep last N lines
    const validLines = lines
      .filter((line) => line.length >= this.options.minCharsPerLine)
      .slice(-this.options.maxLines);

    // Sort characters within each line left-to-right and extract crops
    const charImages: Image[] = [];
    const lineBreaks: number[] = [];

    for (const line of validLines) {
      lineBreaks.push(charImages.length);
      const sorted = line.sort((a, b) => a.minX - b.minX);
      for (const char of sorted) {
        const charCrop = crop(greyImg, {
          origin: { column: char.minX, row: char.minY },
          width: char.width,
          height: char.height,
        });
        charImages.push(charCrop);
      }
    }

    return { charImages, lineBreaks };
  }

  /**
   * Run batch inference on character images.
   * Preprocesses all characters into a single tensor for efficient inference.
   */
  private async predictBatch(images: Image[]): Promise<CharPrediction[]> {
    if (!this.session || !this.ort) {
      throw new Error('MrzOcr not initialized. Call init() first.');
    }

    const ort = this.ort;

    const batchSize = images.length;
    const inputSize = 20;
    const data = new Float32Array(batchSize * 1 * inputSize * inputSize);

    // Preprocess: resize to 20x20, normalize to [0, 1]
    for (let i = 0; i < images.length; i++) {
      const resized = resize(images[i], { width: inputSize, height: inputSize });
      const greyImg = resized.colorModel === 'GREY' ? resized : toGrey(resized);
      const offset = i * inputSize * inputSize;
      for (let row = 0; row < inputSize; row++) {
        for (let col = 0; col < inputSize; col++) {
          data[offset + row * inputSize + col] =
            greyImg.getValue(col, row, 0) / 255.0;
        }
      }
    }

    const inputTensor = new ort.Tensor('float32', data, [
      batchSize,
      1,
      inputSize,
      inputSize,
    ]);

    const results = await this.session.run({ input: inputTensor });
    const output = results[Object.keys(results)[0]];
    const outputData = output.data as Float32Array;
    const numClasses = MRZ_SYMBOLS.length;

    const predictions: CharPrediction[] = [];
    for (let i = 0; i < batchSize; i++) {
      const offset = i * numClasses;
      let maxIdx = 0;
      let maxVal = -Infinity;

      // Softmax to get confidence
      let sumExp = 0;
      const exps = new Float32Array(numClasses);
      for (let j = 0; j < numClasses; j++) {
        exps[j] = Math.exp(outputData[offset + j]);
        sumExp += exps[j];
      }

      for (let j = 0; j < numClasses; j++) {
        const prob = exps[j] / sumExp;
        if (prob > maxVal) {
          maxVal = prob;
          maxIdx = j;
        }
      }

      predictions.push({
        char: MRZ_SYMBOLS[maxIdx],
        confidence: maxVal,
      });
    }

    return predictions;
  }
}
