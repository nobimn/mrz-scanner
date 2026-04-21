/**
 * MRZ region localization using morphological image processing.
 *
 * Port of the Python script by Adrian Rosebrock:
 * https://www.pyimagesearch.com/2015/11/30/detecting-machine-readable-zones-in-passport-images/
 *
 * Original JS implementation: alsenet-labs/mrz-detection
 * Modernized for image-js v1.x with TypeScript.
 */

import {
  type Image,
  type Mask,
  type Roi,
  resize,
  grey,
  gaussianBlur,
  bottomHat,
  directConvolution,
  threshold,
  erode,
  dilate,
  rotate,
  crop,
  fromMask,
  getRois,
} from 'image-js';

import {
  radToDeg,
  rotateDEG,
  translate,
  transform,
  applyToPoint,
  applyToPoints,
  distance,
  type Point,
} from './geometry.js';

export interface MrzDetectionOptions {
  debug?: boolean;
}

export interface MrzDetectionResult {
  crop: Image;
  debugImages?: Record<string, Image | Mask>;
}

// Rectangular morphological kernels
function getRectKernel(w: number, h: number): number[][] {
  return Array.from({ length: w }, () => new Array(h).fill(1) as number[]);
}

const rectKernel = getRectKernel(9, 5);
const sqKernel = getRectKernel(19, 19);

function checkRatio(ratio: number): boolean {
  // TD3 passports (2 lines, 44 chars): ratio ~7-10
  // TD1 ID cards (3 lines, 30 chars): ratio ~2.5-5
  // TD2 (2 lines, 36 chars): ratio ~5-8
  return ratio > 2 && ratio < 12;
}

function getRotationAround(width: number, height: number, angle: number) {
  const cx = width / 2;
  const cy = height / 2;
  return transform(translate(cx, cy), rotateDEG(angle), translate(-cx, -cy));
}

/** Morphological close = dilate then erode */
function closeImage(image: Image, kernel: number[][]): Image {
  return erode(dilate(image, { kernel }), { kernel });
}


/**
 * Detect and crop the MRZ region from a document image.
 * Tries all four orientations (0°, 90°, 180°, 270°) to handle
 * images that were uploaded rotated.
 */
export function getMrz(image: Image, options: MrzDetectionOptions = {}): MrzDetectionResult {
  const rotations: Array<[string, () => Image]> = [
    ['0°', () => image],
    ['-90°', () => rotate(image, -90)],
    ['180°', () => rotate(image, 180)],
    ['90°', () => rotate(image, 90)],
  ];

  for (const [, getRotated] of rotations) {
    try {
      return internalGetMrz(getRotated(), options);
    } catch {
      // Try next orientation
    }
  }

  throw new Error('No MRZ region found. Try a clearer image with good lighting.');
}

function internalGetMrz(image: Image, options: MrzDetectionOptions): MrzDetectionResult {
  const { debug = false } = options;
  const debugImages: Record<string, Image | Mask> = {};
  const original = image;

  // Step 1: Resize to 500px width
  const resized = resize(image, { width: 500 });
  if (debug) debugImages.resized = resized;

  const originalToTreatedRatio = original.width / resized.width;

  // Step 2: Convert to greyscale
  const greyed = grey(resized);
  if (debug) debugImages.grey = greyed;

  // Step 3: Gaussian blur (sigma ~0.5 with size 3 approximates the old radius=1)
  let processed = gaussianBlur(greyed, { sigma: 0.5, size: 3 });
  if (debug) debugImages.gaussian = processed;

  // Step 4: Black hat morphology (dark text on light background)
  // image-js v1.x renamed blackHat to bottomHat
  processed = bottomHat(processed, { kernel: rectKernel });
  if (debug) debugImages.blackhat = processed;

  // Step 5: Scharr edge detection (x-direction ONLY)
  // This is critical -- x-only emphasizes horizontal text lines (MRZ characters
  // have strong vertical strokes). Using both x+y would light up the entire
  // document and prevent MRZ isolation.
  const SCHARR_X = [
    [3, 0, -3],
    [10, 0, -10],
    [3, 0, -3],
  ];
  processed = directConvolution(processed, SCHARR_X);
  if (debug) debugImages.scharr = processed;

  // Step 6: Morphological closing to connect edges
  processed = closeImage(processed, rectKernel);
  if (debug) debugImages.close = processed;

  // Step 7: Otsu threshold to create binary mask
  let mask = threshold(processed, { algorithm: 'otsu' });
  if (debug) debugImages.mask = mask;

  // Step 8: Second closing with larger kernel to connect regions
  mask = mask.close({ kernel: sqKernel });
  if (debug) debugImages.close2 = mask;

  // Step 9: Erosion then dilation to filter by size
  mask = mask.erode({ iterations: 4 });
  mask = mask.dilate({ iterations: 8 });
  if (debug) debugImages.erode = mask;

  // Step 10: Find ROIs (connected components)
  // Use a low minSurface threshold — ratio filtering below is more reliable
  // for selecting the MRZ region vs. background noise.
  const roiManager = fromMask(mask);
  const rois = getRois(roiManager, { minSurface: 500 });

  if (rois.length === 0) {
    throw new Error('no MRZ region detected');
  }

  // Step 11: Filter by aspect ratio and compute rotation angle.
  // MRZ regions have a width/height ratio between 4 and 12.
  interface RoiMeta {
    angle: number;
    ratio: number;
    roi: Roi;
  }

  const candidates: RoiMeta[] = rois
    .map((roi) => {
      // Use bounding box width/height ratio as primary filter.
      // This is simpler and more robust than MBR for the initial filter.
      const bboxRatio = roi.width / roi.height;

      // Compute angle from MBR for rotation correction later
      let angle = 0;
      try {
        const roiMask = roi.getMask();
        const mbr = roiMask.getMbr();
        const corners = mbr.points;
        const d1 = distance(
          [corners[0].column, corners[0].row],
          [corners[1].column, corners[1].row],
        );
        const d2 = distance(
          [corners[1].column, corners[1].row],
          [corners[2].column, corners[2].row],
        );

        let pt1: { column: number; row: number };
        let pt2: { column: number; row: number };
        if (d2 > d1) {
          pt1 = corners[1];
          pt2 = corners[2];
        } else {
          pt1 = corners[0];
          pt2 = corners[1];
        }
        if (pt1.row < pt2.row) {
          [pt1, pt2] = [pt2, pt1];
        }

        angle =
          radToDeg(Math.atan2(pt2.row - pt1.row, pt2.column - pt1.column)) % 180;
        angle = -angle;
        if (angle > 90) angle -= 180;
      } catch {
        // MBR computation can fail on very small ROIs — just use angle=0
      }

      return { angle, ratio: bboxRatio, roi };
    })
    .filter((c) => checkRatio(c.ratio));

  if (candidates.length === 0) {
    throw new Error('no MRZ region detected');
  }

  // Prefer the largest candidate by surface area
  if (candidates.length > 1) {
    candidates.sort((a, b) => b.roi.surface - a.roi.surface);
  }

  // Step 12: Crop the MRZ from the original-resolution image
  let toCrop = original;
  const mrzRoi = candidates[0];
  let angle = mrzRoi.angle;
  let regionTransform: ReturnType<typeof transform> | undefined;

  if (Math.abs(angle) > 45) {
    if (angle < 0) {
      toCrop = rotate(toCrop, 90);
      angle += 90;
      regionTransform = transform(translate(toCrop.width, 0), rotateDEG(90));
    } else {
      toCrop = rotate(toCrop, -90);
      angle -= 90;
      regionTransform = transform(translate(0, toCrop.height), rotateDEG(-90));
    }
  }

  // ROI bounds: origin is relative to the resized image
  const roiOrigin = mrzRoi.roi.origin;
  const roiW = mrzRoi.roi.width;
  const roiH = mrzRoi.roi.height;

  let mrzCropOptions: { x: number; y: number; width: number; height: number };

  if (Math.abs(angle) < 1) {
    // Simple rectangular crop
    mrzCropOptions = {
      x: roiOrigin.column * originalToTreatedRatio,
      y: roiOrigin.row * originalToTreatedRatio,
      width: roiW * originalToTreatedRatio,
      height: roiH * originalToTreatedRatio,
    };
    if (regionTransform) {
      const rotated = applyToPoint(regionTransform, {
        x: mrzCropOptions.x,
        y: mrzCropOptions.y,
      });
      const tmp = mrzCropOptions.width;
      mrzCropOptions.width = mrzCropOptions.height;
      mrzCropOptions.height = tmp;
      mrzCropOptions.x = rotated.x;
      mrzCropOptions.y = rotated.y - mrzCropOptions.height;
    }
  } else {
    // Angled crop using convex hull
    const roiMask = mrzRoi.roi.getMask();
    const hull = roiMask.getConvexHull();
    let hullPoints: Point[] = hull.points.map((p) => ({
      x: (roiOrigin.column + p.column) * originalToTreatedRatio,
      y: (roiOrigin.row + p.row) * originalToTreatedRatio,
    }));

    if (regionTransform) {
      hullPoints = applyToPoints(regionTransform, hullPoints);
    }

    // For arbitrary-angle rotation, we rotate the image and compute new bounds.
    // image-js v1.x only supports 90/180/270 degree rotations, so for small
    // angles we skip rotation and just use a bounding box crop (the MRZ text
    // will be slightly angled but still readable by the OCR).
    // This is a pragmatic tradeoff vs adding a dependency for arbitrary rotation.
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const point of hullPoints) {
      if (point.x < minX) minX = point.x;
      if (point.x > maxX) maxX = point.x;
      if (point.y < minY) minY = point.y;
      if (point.y > maxY) maxY = point.y;
    }

    minX = Math.max(0, Math.round(minX));
    minY = Math.max(0, Math.round(minY));
    maxX = Math.min(toCrop.width, Math.round(maxX));
    maxY = Math.min(toCrop.height, Math.round(maxY));

    mrzCropOptions = {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
    };
  }

  // Step 13: Check for upside-down orientation
  if (mrzCropOptions.y < toCrop.height / 2) {
    toCrop = rotate(toCrop, 180);
    const newXY = applyToPoint(
      getRotationAround(toCrop.width, toCrop.height, 180),
      { x: mrzCropOptions.x, y: mrzCropOptions.y },
    );
    mrzCropOptions.x = newXY.x - mrzCropOptions.width;
    mrzCropOptions.y = newXY.y - mrzCropOptions.height;
  }

  const cropped = crop(toCrop, {
    origin: {
      column: Math.max(0, Math.round(mrzCropOptions.x)),
      row: Math.max(0, Math.round(mrzCropOptions.y)),
    },
    width: Math.min(Math.round(mrzCropOptions.width), toCrop.width),
    height: Math.min(Math.round(mrzCropOptions.height), toCrop.height),
  });

  if (debug) debugImages.crop = cropped;

  return debug ? { crop: cropped, debugImages } : { crop: cropped };
}
