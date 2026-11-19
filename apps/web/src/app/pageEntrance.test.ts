import { expect, it, vi } from "vitest";
import { createPageEntrance } from "./pageEntrance.js";

it("plays and restarts the production opacity entrance", () => {
  const cancel = vi.fn();
  const animate = vi.fn(() => ({ cancel }));
  const element = { animate } as unknown as HTMLElement;
  const entrance = createPageEntrance(
    () => element,
    () => false,
  );
  entrance.play();
  expect(animate).toHaveBeenCalledWith([{ opacity: 0 }, { opacity: 1 }], {
    duration: 160,
    easing: "ease",
    fill: "both",
  });
  entrance.play();
  expect(cancel).toHaveBeenCalledOnce();
});

it("skips motion when reduced motion is preferred", () => {
  const animate = vi.fn();
  const entrance = createPageEntrance(
    () => ({ animate }) as unknown as HTMLElement,
    () => true,
  );
  entrance.play();
  expect(animate).not.toHaveBeenCalled();
});
