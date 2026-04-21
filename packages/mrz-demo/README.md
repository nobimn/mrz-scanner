# @mrz-scanner/demo

Browser demo for the MRZ scanner. Vanilla TypeScript, Vite, no framework.
All processing happens in a Web Worker; nothing leaves the browser.

## Run

```bash
pnpm install
pnpm --filter @mrz-scanner/demo dev        # http://localhost:5173
pnpm --filter @mrz-scanner/demo build      # static output in dist/
pnpm --filter @mrz-scanner/demo preview    # serve the built bundle
```

## Features

- **Upload** — pick a JPEG/PNG; the result shows next to the image.
- **Live camera** — opens the rear camera (`facingMode: 'environment'`,
  ideal 1920×1080), draws a guide box over the lower part of the frame,
  and continuously scans that region at ~7 fps. Overlay colors:
  - blue = scanning
  - yellow = OCR lines seen, waiting for a valid parse ("Hold steady...")
  - green = MRZ parsed successfully.
- **Progress ticker** via `ScanProgress` (`detecting` → `ocr` → `parsing`).
- **PII notice** shown alongside every successful result, reminding users
  that no data is uploaded.

## Architecture

```
src/
  demo.ts       Main thread: UI, camera plumbing, overlay drawing
  worker.ts     Web Worker: decodes the data URL and calls @mrz-scanner/scanner
  styles.css
index.html
public/
  mrz-cnn.onnx  Copied here so Vite serves it at /mrz-cnn.onnx
```

- [Comlink](https://github.com/GoogleChromeLabs/comlink) wraps the worker
  with an RPC-style proxy (`api.scan(dataUrl) → result`).
- Only the cropped guide region is passed to the worker — full camera
  frames are never copied cross-thread.
- The `mrz-cnn.onnx` model plus the onnxruntime-web WASM runtime are loaded
  lazily on first scan.

## Serving the ONNX model

The model must be reachable from the Worker's origin. During `vite dev`,
`public/mrz-cnn.onnx` is served as `/mrz-cnn.onnx` and the Worker requests
it from that path (`modelPath: '/mrz-cnn.onnx'` in `worker.ts`). After a
retrain, re-copy the ONNX file into `public/` and rebuild.

## License

AGPL-3.0-or-later.
