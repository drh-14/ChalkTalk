export function createPageEntrance(
  getElement: () => HTMLElement | null,
  prefersReducedMotion: () => boolean,
) {
  let current: Animation | null = null;
  return {
    play() {
      current?.cancel();
      current = null;
      if (prefersReducedMotion()) return;
      const element = getElement();
      if (typeof element?.animate !== "function") return;
      current = element.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: 160,
        easing: "ease",
        fill: "both",
      });
    },
    cancel() {
      current?.cancel();
      current = null;
    },
  };
}
