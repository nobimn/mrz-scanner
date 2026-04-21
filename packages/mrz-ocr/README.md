# @mrz-scanner/ocr

MRZ character recognition using a small ONNX CNN. Replaces the HOG+SVM
pipeline in the original mrz-detection repo. Runs on `onnxruntime-web`
(WASM) in the browser and `onnxruntime-node` in Node.js.

## Install

```bash
pnpm add @mrz-scanner/ocr image-js onnxruntime-web
# or, for Node.js
pnpm add @mrz-scanner/ocr image-js onnxruntime-node
```

## Usage (browser)

```ts
import { decode } from 'image-js';
import { MrzOcr } from '@mrz-scanner/ocr';

const ocr = new MrzOcr({ modelPath: '/mrz-cnn.onnx' });  // served as a static asset
await ocr.init();

const image = decode(bytes);
const { lines, confidence } = await ocr.recognize(image);
```

## Usage (Node.js)

```ts
import { MrzOcr } from '@mrz-scanner/ocr';
import * as ort from 'onnxruntime-node';

const ocr = new MrzOcr({
  modelPath: './packages/mrz-ocr/models/mrz-cnn.onnx',
  ort,   // <-- required in Node.js; browser build defaults to onnxruntime-web
});
await ocr.init();
```

## Recognition pipeline

`recognize(image)` assumes the input is a tight crop of the MRZ band (what
`@mrz-scanner/detection` produces):

1. Greyscale + Otsu threshold on the crop.
2. Connected-component ROIs; try black-pixel ROIs first, fall back to white.
3. Filter by aspect ratio (0.3–3.0), cluster into lines by center-Y
   (line height ≈ `image.height / 6`).
4. Drop short lines (`minCharsPerLine`, default 5) and keep the last
   `maxLines` (default 3) — covers TD1 (3 lines) and TD2/TD3 (2 lines).
5. Sort each line left-to-right, resize each character to 20×20, normalize
   to `[0, 1]`, batch into a single `(N, 1, 20, 20)` tensor.
6. Run the ONNX session; softmax over the 37 output logits; emit the argmax
   character and its probability as confidence.

## Model

- Architecture: `Conv(1→32, 3×3)→ReLU→MaxPool→Conv(32→64, 3×3)→ReLU→MaxPool→
  Flatten→Dense(128)→ReLU→Dropout(0.3)→Dense(37)`.
- ≈75 K parameters, ≈300 KB ONNX (opset 17).
- 37 classes: `0-9`, `A-Z`, `<`.
- Shipped at `models/mrz-cnn.onnx` with a `models/mrz-cnn.json` sidecar
  recording the symbol table and last test accuracy.

### Retraining

```bash
cd training
pip install -r requirements.txt
python extract_ocrb.py                     # unpack legacy OCR-B fingerprints
python train_cnn.py --data-dir ./ocrb_chars --output ../models/mrz-cnn.onnx
# or synthetic only:
python train_cnn.py --generate --output ../models/mrz-cnn.onnx
```

## Exports

```ts
interface MrzOcrOptions {
  modelPath?: string;          // default 'mrz-cnn.onnx'
  minCharsPerLine?: number;    // default 5
  maxLines?: number;           // default 3
  ort?: OrtModule;             // pass onnxruntime-node in Node.js
}

interface MrzOcrResult {
  lines: string[];
  confidence: number[][];      // per-character softmax probabilities
}

class MrzOcr {
  constructor(options?: MrzOcrOptions);
  init(): Promise<void>;
  recognize(image: Image): Promise<MrzOcrResult>;
}

const MRZ_SYMBOLS: readonly string[];
```

## Security

Constructor inputs are validated:

- `modelPath` must end in `.onnx`; `..` is rejected; only `http(s)://` URLs
  and local paths are allowed (no `file://`, `data:`, `ftp://`).
- `recognize()` refuses images above 20 megapixels to bound memory.

## License

AGPL-3.0-or-later.
