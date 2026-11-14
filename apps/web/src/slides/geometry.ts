import type { AnchorBox } from "../posts/client.js";

/** Boxes thinner or shorter than this share of the page are treated as clicks. */
export const MIN_SIDE = 0.01;
export const FULL_PAGE: AnchorBox = { x: 0, y: 0, width: 1, height: 1 };

type Point = { x: number; y: number };
type Size = { width: number; height: number };

const clamp = (value: number, max: number) => Math.min(Math.max(value, 0), max);
// Fractions are kept to six places so x + width never drifts past 1.
const round = (value: number) => Math.round(value * 1e6) / 1e6;

/**
 * The box between two points on a page of the given displayed size, as page
 * fractions, or null when it is too small to be a deliberate selection.
 */
export function boxFromPoints(
  start: Point,
  end: Point,
  page: Size,
): AnchorBox | null {
  if (page.width <= 0 || page.height <= 0) return null;
  const left = clamp(Math.min(start.x, end.x), page.width);
  const right = clamp(Math.max(start.x, end.x), page.width);
  const top = clamp(Math.min(start.y, end.y), page.height);
  const bottom = clamp(Math.max(start.y, end.y), page.height);
  const box = {
    x: round(left / page.width),
    y: round(top / page.height),
    width: round((right - left) / page.width),
    height: round((bottom - top) / page.height),
  };
  if (box.width < MIN_SIDE || box.height < MIN_SIDE) return null;
  return {
    ...box,
    width: Math.min(box.width, round(1 - box.x)),
    height: Math.min(box.height, round(1 - box.y)),
  };
}

/** The box in pixels on a page drawn at the given size. */
export function boxToPixels(box: AnchorBox, page: Size) {
  return {
    left: box.x * page.width,
    top: box.y * page.height,
    width: box.width * page.width,
    height: box.height * page.height,
  };
}

/**
 * How far to shift each marker so markers for boxes that start at nearly the
 * same spot sit side by side instead of on top of one another.
 */
export function markerOffsets(boxes: AnchorBox[]): number[] {
  const seen = new Map<string, number>();
  return boxes.map((box) => {
    const spot = `${Math.round(box.x * 50)}:${Math.round(box.y * 50)}`;
    const index = seen.get(spot) ?? 0;
    seen.set(spot, index + 1);
    return index;
  });
}
