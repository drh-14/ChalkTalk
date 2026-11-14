import { expect, it } from "vitest";
import { boxFromPoints, boxToPixels, markerOffsets } from "./geometry.js";

const page = { width: 800, height: 600 };

it("turns a drag in any direction into page fractions", () => {
  expect(boxFromPoints({ x: 80, y: 120 }, { x: 400, y: 300 }, page)).toEqual({
    x: 0.1,
    y: 0.2,
    width: 0.4,
    height: 0.3,
  });
  expect(boxFromPoints({ x: 400, y: 300 }, { x: 80, y: 120 }, page)).toEqual({
    x: 0.1,
    y: 0.2,
    width: 0.4,
    height: 0.3,
  });
});

it("clamps a drag that leaves the page", () => {
  expect(boxFromPoints({ x: 600, y: 450 }, { x: 900, y: 700 }, page)).toEqual({
    x: 0.75,
    y: 0.75,
    width: 0.25,
    height: 0.25,
  });
  expect(boxFromPoints({ x: -40, y: -10 }, { x: 80, y: 60 }, page)).toEqual({
    x: 0,
    y: 0,
    width: 0.1,
    height: 0.1,
  });
});

it("ignores clicks and slivers", () => {
  expect(boxFromPoints({ x: 100, y: 100 }, { x: 102, y: 101 }, page)).toBe(
    null,
  );
  expect(boxFromPoints({ x: 100, y: 100 }, { x: 500, y: 104 }, page)).toBe(
    null,
  );
  expect(
    boxFromPoints({ x: 0, y: 0 }, { x: 10, y: 10 }, { width: 0, height: 0 }),
  ).toBe(null);
});

it("never lets rounding push the box past the page edge", () => {
  const odd = { width: 3, height: 7 };
  const box = boxFromPoints({ x: 1, y: 1 }, { x: 3, y: 7 }, odd)!;
  expect(box.x + box.width).toBeLessThanOrEqual(1);
  expect(box.y + box.height).toBeLessThanOrEqual(1);
});

it("maps a box back to pixels at any zoom", () => {
  expect(
    boxToPixels(
      { x: 0.1, y: 0.2, width: 0.4, height: 0.3 },
      { width: 1600, height: 1200 },
    ),
  ).toEqual({ left: 160, top: 240, width: 640, height: 360 });
});

it("offsets markers whose boxes start at the same spot", () => {
  expect(
    markerOffsets([
      { x: 0.1, y: 0.2, width: 0.1, height: 0.1 },
      { x: 0.5, y: 0.5, width: 0.1, height: 0.1 },
      { x: 0.101, y: 0.199, width: 0.3, height: 0.3 },
    ]),
  ).toEqual([0, 0, 1]);
});
