# mrz-scanner v2

Detect, OCR, and parse Machine Readable Zones (MRZ) from passport and ID-document
images. Runs entirely client-side — in the browser, in Node.js, or from the
command line. No document data ever leaves the machine.

Based on [mrz-detection](https://github.com/image-js/mrz-detection) by
[Daniel Kostro](https://github.com/stropitek) and
[Michael Zasso](https://github.com/targos); rewritten as a TypeScript pnpm
monorepo with a small ONNX CNN in place of the original HOG+SVM OCR.

## Architecture

```
packages/
  mrz-core/        Types, MRZ parsing, error correction (wraps `mrz` v5)
  mrz-detection/   Morphological MRZ region localization (image-js v1.x)
  mrz-ocr/         Character recognition via ONNX CNN (~300 KB model, 37 classes)
  mrz-scanner/     Orchestrator: detect -> OCR -> parse
  mrz-cli/         Command-line tool (`mrz2json`)
  mrz-demo/        Browser demo (upload or live camera, Comlink Web Worker)
```

Each package is versioned independently under `@mrz-scanner/*` and built to an
ES-module bundle with type declarations via `vite-plugin-dts`.

## Pipeline

1. **Detection** (`packages/mrz-detection/src/get-mrz.ts`). Classical CV:
   resize → greyscale → Gaussian blur → bottom-hat morphology → Scharr x-edges
   → Otsu threshold → close/erode/dilate → connected components → aspect-ratio
   filter → rotation correction → crop. The image is tried in all four
   90° orientations so rotated uploads still work.
2. **OCR** (`packages/mrz-ocr/src/mrz-ocr.ts`). A small CNN
   (`Conv2D→MaxPool→Conv2D→MaxPool→Dense→Dense`, ≈75 K params) classifies
   20×20 character crops into 37 MRZ symbols (`0-9`, `A-Z`, `<`). Runs on
   `onnxruntime-web` (WASM) in the browser and `onnxruntime-node` (native)
   in Node.js.
3. **Parsing** (`packages/mrz-core/src/mrz-relax.ts`). Delegates to the `mrz`
   package and, when validation fails, applies field-aware OCR-confusion
   substitutions (e.g. `O↔0`, `I↔1`, `S↔5`, `B↔8`, `Z↔2`) within the ranges
   reported by `mrz` and retries recursively until fixpoint.

When detection fails (image is already a tight MRZ crop, or the morphology
pass rejects the region), `scanMrz` falls back to running OCR on the full
input image.

## Tech Stack

- **TypeScript 5.8** + **Vite 8** + **pnpm 10** workspaces (Node ≥ 22)
- **image-js** v1.x for image processing (standalone function API)
- **onnxruntime-web** / **onnxruntime-node** for inference
- **mrz** v5 for format parsing
- **Comlink** for Web Worker RPC in the demo
- **Vitest** for tests, **ESLint** + **Prettier** for code quality,
  **GitHub Actions** for CI (lint → typecheck → test → build)

## Quick Start

```bash
pnpm install
pnpm build        # build every package
pnpm test         # run vitest (headless)
pnpm lint         # eslint
pnpm typecheck    # tsc --noEmit across packages
pnpm --filter @mrz-scanner/demo dev   # browser demo on http://localhost:5173
```

## CLI Usage

```bash
pnpm --filter @mrz-scanner/cli build
node packages/mrz-cli/dist/cli.js passport.jpg
# or, once installed globally / linked: `mrz2json passport.jpg`
```

Options:

| Flag | Description |
|---|---|
| `-d, --dest-dir <path>` | Write `<file>.mrz.json` into this directory (must exist, must be under cwd) |
| `-f, --format <json\|text>` | `json` (default) writes a JSON file; `text` prints the raw MRZ lines to stdout |
| `-c, --confidence` | Include per-character confidence scores in the JSON output |
| `-h, --help` / `-v, --version` | Help / version |

Security: inputs are rejected above 50 MB; output files are written with
`0600` permissions; `--dest-dir` is resolved and forced to stay under `cwd`
to prevent path traversal; raw MRZ text is never echoed to stderr on parse
failure (partial PII).

## Browser Usage

```ts
import { decode } from 'image-js';
import { scanMrz } from '@mrz-scanner/scanner';

const bytes = new Uint8Array(await file.arrayBuffer());
const image = decode(bytes);

const result = await scanMrz(image, {
  modelPath: '/mrz-cnn.onnx',      // served as a static asset
  onProgress: (stage) => console.log(stage),  // 'detecting' | 'ocr' | 'parsing'
});

if (result.parsed?.valid) {
  console.log(result.parsed.fields);
}
```

The `mrz-cnn.onnx` model (≈300 KB) and the onnxruntime-web WASM runtime must
be served as static assets. Heavy work should run in a Web Worker — see
`packages/mrz-demo/src/worker.ts` for a minimal Comlink setup.

## Node.js Usage

The OCR package imports `onnxruntime-web` by default. In Node.js, pass the
native runtime explicitly:

```ts
import { read } from 'image-js';
import { MrzOcr } from '@mrz-scanner/ocr';
import { getMrz } from '@mrz-scanner/detection';
import { parse } from '@mrz-scanner/core';
import * as ort from 'onnxruntime-node';

const ocr = new MrzOcr({
  modelPath: './packages/mrz-ocr/models/mrz-cnn.onnx',
  ort,
});
await ocr.init();

const image = await read('passport.jpg');
const { crop } = getMrz(image);
const { lines } = await ocr.recognize(crop);
const result = parse(lines);
```

The CLI (`packages/mrz-cli/src/cli.ts`) uses this same pattern behind the
scenes through `@mrz-scanner/scanner`.

## Demo

```bash
pnpm --filter @mrz-scanner/demo dev
```

Two input modes:

- **Upload** — pick any image, get results in the page.
- **Camera** — opens the rear camera, draws a guide box over the lower part
  of the frame, continuously scans at ~7 fps, and turns green when a valid
  MRZ is parsed. All processing runs in a Web Worker; nothing is uploaded.

A PII notice is shown alongside every successful result.

## OCR Model

A trained model is shipped at `packages/mrz-ocr/models/mrz-cnn.onnx`
(≈300 KB, 37 classes, input 1×20×20). The sidecar `mrz-cnn.json` records the
symbol table and the test accuracy from the last training run.

### Retraining

```bash
cd packages/mrz-ocr/training
pip install -r requirements.txt

# (optional) regenerate training data from the legacy OCR-B fingerprints
python extract_ocrb.py

# Train from the extracted real-document characters
python train_cnn.py --data-dir ./ocrb_chars --epochs 30 \
    --output ../models/mrz-cnn.onnx

# ...or train purely from synthetic bitmaps (lower quality, no external data)
python train_cnn.py --generate --epochs 30 --output ../models/mrz-cnn.onnx
```

After retraining, rebuild any consumer that bundles the model asset
(e.g. copy the `.onnx` into `packages/mrz-demo/public/`).

## Repository layout

```
.
├── .github/workflows/ci.yml    CI: lint, typecheck, test, build
├── eslint.config.js            flat ESLint config (TS rules)
├── vitest.config.ts            test matcher: packages/**/src/**/*.test.ts
├── tsconfig.base.json          strict ES2022 / bundler resolution
├── pnpm-workspace.yaml
├── _legacy/                    the pre-v2 Gulp/Browserify/jQuery codebase (reference only)
└── packages/                   see Architecture above
```

## License

```
Copyright (c) 2018-2025 ALSENET SA

Author(s):
      Luc Deschenaux <luc.deschenaux@freesurf.ch>

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
```

See [LICENSE](LICENSE) for the full text.
