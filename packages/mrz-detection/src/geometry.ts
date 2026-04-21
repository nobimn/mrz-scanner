// Inline replacements for transformation-matrix, radians-degrees, and ml-matrix.
// Only the 5 functions actually used by the detection pipeline.

export interface Point {
  x: number;
  y: number;
}

export interface Matrix2D {
  a: number; b: number; c: number;
  d: number; e: number; f: number;
}

export function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

export function rotateDEG(angle: number): Matrix2D {
  const rad = (angle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
}

export function translate(tx: number, ty: number): Matrix2D {
  return { a: 1, b: 0, c: 0, d: 1, e: tx, f: ty };
}

export function transform(...matrices: Matrix2D[]): Matrix2D {
  return matrices.reduce((acc, m) => ({
    a: acc.a * m.a + acc.c * m.b,
    b: acc.b * m.a + acc.d * m.b,
    c: acc.a * m.c + acc.c * m.d,
    d: acc.b * m.c + acc.d * m.d,
    e: acc.a * m.e + acc.c * m.f + acc.e,
    f: acc.b * m.e + acc.d * m.f + acc.f,
  }));
}

export function applyToPoint(m: Matrix2D, p: Point | { x: number; y: number }): Point {
  return {
    x: m.a * p.x + m.c * p.y + m.e,
    y: m.b * p.x + m.d * p.y + m.f,
  };
}

export function applyToPoints(m: Matrix2D, points: Point[]): Point[] {
  return points.map((p) => applyToPoint(m, p));
}

export function distance(p1: [number, number], p2: [number, number]): number {
  const dx = p2[0] - p1[0];
  const dy = p2[1] - p1[1];
  return Math.sqrt(dx * dx + dy * dy);
}
