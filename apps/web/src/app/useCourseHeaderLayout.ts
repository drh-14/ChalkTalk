import { useLayoutEffect, type RefObject } from "react";

/** Keep the existing header controls mounted; only their available space changes. */
export function useCourseHeaderLayout(
  header: RefObject<HTMLElement | null>,
  enabled: boolean,
) {
  useLayoutEffect(() => {
    const root = header.current;
    const inner = root?.querySelector<HTMLElement>(".app-bar-inner");
    if (!enabled || !root || !inner) return;
    let frame = 0;
    let disposed = false;
    let geometry: Element[] = [];
    const update = () => {
      const next = Array.from(
        root.parentElement?.querySelectorAll(
          ".discussion-columns, .discussion-feed",
        ) ?? [],
      );
      for (const node of geometry)
        if (!next.includes(node)) resize?.unobserve(node);
      for (const node of next)
        if (!geometry.includes(node)) resize?.observe(node);
      geometry = next;
      const course = inner.querySelector<HTMLElement>(".app-bar-course");
      const title = course?.querySelector<HTMLElement>("h1");
      const logo = inner.querySelector<HTMLElement>(".wordmark");
      const nav = inner.querySelector<HTMLElement>(".course-tabs");
      const account = inner.querySelector<HTMLElement>(".account-controls");
      if (!course || !title || !logo || !nav || !account) return;
      const box = inner.getBoundingClientRect();
      const style = getComputedStyle(inner);
      const gap = parseFloat(style.columnGap);
      const start = logo.getBoundingClientRect().right - box.left + gap;
      const end = box.width - parseFloat(style.paddingRight);
      const navWidth = nav.scrollWidth;
      const accountWidth = account.getBoundingClientRect().width;
      const detail = root.parentElement?.querySelector(".discussion-detail");
      const boundary =
        detail?.getBoundingClientRect().left ??
        root.querySelector(".course-split-boundary")?.getBoundingClientRect()
          .right ??
        box.left;
      const split = boundary - box.left;
      const aligned =
        split + navWidth + gap + accountWidth <= end &&
        split - start - gap >= 44;
      const maximum = Math.max(
        0,
        aligned
          ? split - start - gap
          : end - start - navWidth - accountWidth - 2 * gap,
      );
      const courseStyle = getComputedStyle(course);
      const flowChildren = Array.from(course.children).filter(
        (child) => getComputedStyle(child).position !== "absolute",
      );
      // scrollWidth is integer-rounded; allow fractional glyphs before clamping.
      const natural =
        flowChildren.reduce(
          (width, child) =>
            width +
            (child === title
              ? title.scrollWidth + 1
              : child.getBoundingClientRect().width),
          0,
        ) +
        Math.max(0, flowChildren.length - 1) *
          parseFloat(courseStyle.columnGap) +
        parseFloat(courseStyle.paddingLeft) +
        parseFloat(courseStyle.paddingRight);
      const offset = aligned
        ? Math.max(0, split - start - Math.min(natural, maximum) - gap)
        : 0;
      for (const [property, value] of [
        ["--course-title-width", `${Math.min(natural, maximum)}px`],
        ["--course-nav-offset", `${offset}px`],
      ]) {
        if (inner.style.getPropertyValue(property) !== value)
          inner.style.setProperty(property, value);
      }
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    const resize =
      typeof ResizeObserver === "function"
        ? new ResizeObserver(schedule)
        : null;
    resize?.observe(inner);
    const marker = root.querySelector(".course-split-boundary");
    if (marker) resize?.observe(marker);
    for (const selector of [
      ".course-tabs",
      ".account-controls",
      ".app-bar-course",
    ])
      inner.querySelectorAll(selector).forEach((node) => resize?.observe(node));
    update();
    window.addEventListener("resize", schedule);
    const changes = new MutationObserver(schedule);
    changes.observe(root, {
      childList: true,
      characterData: true,
      subtree: true,
    });
    const content = root.nextElementSibling;
    if (content) changes.observe(content, { childList: true });
    document.fonts?.addEventListener("loadingdone", schedule);
    void document.fonts?.ready.then(() => {
      if (!disposed) schedule();
    });
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      resize?.disconnect();
      window.removeEventListener("resize", schedule);
      changes.disconnect();
      document.fonts?.removeEventListener("loadingdone", schedule);
      inner.style.removeProperty("--course-title-width");
      inner.style.removeProperty("--course-nav-offset");
    };
  }, [enabled, header]);
}
