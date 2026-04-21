import { describe, it, expect } from 'vitest';
import {
  radToDeg,
  rotateDEG,
  translate,
  transform,
  applyToPoint,
  applyToPoints,
  distance,
} from './geometry.js';

describe('radToDeg', () => {
  it('should convert radians to degrees', () => {
    expect(radToDeg(Math.PI)).toBeCloseTo(180);
    expect(radToDeg(Math.PI / 2)).toBeCloseTo(90);
    expect(radToDeg(0)).toBeCloseTo(0);
  });
});

describe('distance', () => {
  it('should compute euclidean distance', () => {
    expect(distance([0, 0], [3, 4])).toBeCloseTo(5);
    expect(distance([1, 1], [1, 1])).toBeCloseTo(0);
    expect(distance([0, 0], [1, 0])).toBeCloseTo(1);
  });
});

describe('translate', () => {
  it('should create a translation matrix', () => {
    const m = translate(10, 20);
    const p = applyToPoint(m, { x: 0, y: 0 });
    expect(p.x).toBeCloseTo(10);
    expect(p.y).toBeCloseTo(20);
  });
});

describe('rotateDEG', () => {
  it('should rotate 90 degrees', () => {
    const m = rotateDEG(90);
    const p = applyToPoint(m, { x: 1, y: 0 });
    expect(p.x).toBeCloseTo(0);
    expect(p.y).toBeCloseTo(1);
  });

  it('should rotate 180 degrees', () => {
    const m = rotateDEG(180);
    const p = applyToPoint(m, { x: 1, y: 0 });
    expect(p.x).toBeCloseTo(-1);
    expect(p.y).toBeCloseTo(0);
  });
});

describe('transform', () => {
  it('should compose translate + rotate', () => {
    const m = transform(translate(5, 0), rotateDEG(90));
    const p = applyToPoint(m, { x: 1, y: 0 });
    // First rotate (1,0) -> (0,1), then translate -> (5,1)
    expect(p.x).toBeCloseTo(5);
    expect(p.y).toBeCloseTo(1);
  });
});

describe('applyToPoints', () => {
  it('should transform multiple points', () => {
    const m = translate(10, 20);
    const points = [
      { x: 0, y: 0 },
      { x: 5, y: 5 },
    ];
    const result = applyToPoints(m, points);
    expect(result).toHaveLength(2);
    expect(result[0].x).toBeCloseTo(10);
    expect(result[0].y).toBeCloseTo(20);
    expect(result[1].x).toBeCloseTo(15);
    expect(result[1].y).toBeCloseTo(25);
  });
});
