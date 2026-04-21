# @mrz-scanner/detection

Locate and crop the MRZ region from a document image using classical
morphological image processing (no ML). TypeScript port of the algorithm
from Adrian Rosebrock's
[PyImageSearch article](https://www.pyimagesearch.com/2015/11/30/detecting-machine-readable-zones-in-passport-images/),
modernized for [image-js](https://image-js.github.io/image-js/) v1.x.

## Install

```bash
pnpm add @mrz-scanner/detection image-js
```

## Usage

```ts
import { read } from 'image-js';   // Node; use `decode(bytes)` in the browser
import { getMrz } from '@mrz-scanner/detection';

const image = await read('passport.jpg');
const { crop } = getMrz(image);
// crop is an image-js Image containing just the MRZ band
```

With debug images (useful for tuning / troubleshooting):

```ts
const { crop, debugImages } = getMrz(image, { debug: true });
// debugImages: { resized, grey, gaussian, blackhat, scharr, close, mask, close2, erode, crop }
```

## Algorithm

1. Resize to 500 px wide for speed.
2. Grey, Gaussian blur (σ≈0.5).
3. Bottom-hat morphology (9×5 rectangular kernel) — emphasises dark text on a
   light background. In image-js v0.21 this was called `blackHat`.
4. Scharr convolution **in the x direction only** — critical. The y direction
   would light up the whole document and drown out the MRZ.
5. Morphological close, Otsu threshold, second close with a 19×19 kernel,
   then 4× erode and 8× dilate to isolate connected regions.
6. Enumerate ROIs (min surface 500 px), filter by bounding-box aspect ratio
   (2–12, covers TD1/TD2/TD3 documents), pick the largest surviving
   candidate.
7. Compute a rotation angle from the minimum bounding rectangle; if |angle| > 45°
   rotate the original 90° and recompute coordinates. Small angles are
   handled with a bounding-box crop over the convex hull (image-js v1.x
   doesn't support arbitrary-angle rotation out of the box).
8. If the crop sits in the top half of the frame, assume the document was
   uploaded upside-down and rotate 180°.
9. Crop from the original-resolution image.

If no candidate survives the ratio filter, `getMrz()` rotates the whole
image 90°, 180°, 270° and retries — so rotated photos and portrait-shot
documents still work. It throws if all four orientations fail.

## Exports

```ts
interface MrzDetectionOptions {
  debug?: boolean;   // include intermediate images in the result
}

interface MrzDetectionResult {
  crop: Image;
  debugImages?: Record<string, Image | Mask>;
}

function getMrz(image: Image, options?: MrzDetectionOptions): MrzDetectionResult
```

The package also contains `src/geometry.ts`, a small inline replacement for
`transformation-matrix` + `radians-degrees` (5 pure functions, no runtime
dependencies).

## Notes on image-js v1 compat

- `Point` is `{ column, row }`, not `{ x, y }`.
- Thresholding is `threshold(image, { algorithm: 'otsu' })`, not `image.mask(...)`.
- ROI construction: `fromMask(mask)` + `getRois(roiManager, opts)`.
- Black-hat → `bottomHat`.
- Only 90/180/270° rotations are supported — angled crops are approximated
  by a convex-hull bounding box.

## License

AGPL-3.0-or-later.
