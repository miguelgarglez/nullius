// Camera: world position (centre) + scale (px per world unit).

export interface Camera {
  x: number;
  y: number;
  scale: number; // px per world unit
}

export const MIN_SCALE = 0.14;
export const MAX_SCALE = 3.6;

export function clampScale(s: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
}
