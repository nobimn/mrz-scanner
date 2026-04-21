# @mrz-scanner/scanner

Top-level orchestrator. Combines `@mrz-scanner/detection`,
`@mrz-scanner/ocr`, and `@mrz-scanner/core` into a single `scanMrz(image)`
entry point.

## Install

```bash
pnpm add @mrz-scanner/scanner image-js onnxruntime-web
```

## Usage

```ts
import { decode } from 'image-js';
import { scanMrz } from '@mrz-scanner/scanner';

const image = decode(bytes);

const result = await scanMrz(image, {
  modelPath: '/mrz-cnn.onnx',
  onProgress: (stage) => console.log(stage),   // 'detecting' | 'ocr' | 'parsing'
});

if (result.parsed?.valid) {
  console.log(result.parsed.fields);
} else {
  console.log('OCR lines:', result.ocrLines);
  console.log('Error:', result.error);
}
```

## Pipeline

1. Lazy-initialize a shared `MrzOcr` instance on first call (cached between
   calls — model is only loaded once).
2. `getMrz(image, { debug })` localizes and crops the MRZ region.
3. `ocr.recognize(crop)` produces `lines` + per-character confidence.
4. `parse(lines)` validates and, if necessary, applies OCR-confusion
   corrections from `@mrz-scanner/core`.

### Fallback

If detection throws (e.g. the image is already a tight MRZ crop, or the
morphology pipeline rejects the region), `scanMrz` runs OCR directly on the
full input image and returns whatever it finds. Only if **that** also fails
is the detection error propagated back in `result.error`.

## Exports

```ts
interface ScanMrzOptions {
  modelPath?: string;
  onProgress?: ScanProgress;
  debug?: boolean;             // include detection debug images in the result
}

interface ScanMrzResult {
  parsed?: ParseResult;        // from @mrz-scanner/core (extends mrz v5 result)
  ocrLines?: string[];
  confidence?: number[][];
  error?: Error;
  debugImages?: Record<string, unknown>;
}

function scanMrz(image: Image, options?: ScanMrzOptions): Promise<ScanMrzResult>
```

Also re-exports `parse`, `ScanProgress`, `OcrResult`, `ParseResult` from
`@mrz-scanner/core`, and `MrzDetectionResult` / `MrzOcrResult` from the
other packages.

## Node.js

In Node.js the OCR sub-package needs the native runtime explicitly. Build
your own pipeline from the lower-level packages — see the top-level README
section "Node.js Usage" for an example — or reuse the CLI
(`@mrz-scanner/cli`) which wires it up for you.

## License

AGPL-3.0-or-later.
