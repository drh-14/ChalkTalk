import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";

/** Nonmodal, viewport-bounded presentation only; filter state belongs to Discussion. */
export function useFilterOverlay(courseId: string, postId?: string) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>({});
  const close = useCallback((restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) trigger.current?.focus();
  }, []);
  useEffect(() => {
    setOpen(false);
  }, [courseId, postId]);
  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => {
      const anchor = trigger.current?.getBoundingClientRect();
      if (!anchor) return;
      const viewport = window.visualViewport;
      const left = viewport?.offsetLeft ?? 0;
      const top = viewport?.offsetTop ?? 0;
      const width = viewport?.width ?? window.innerWidth;
      const height = viewport?.height ?? window.innerHeight;
      const margin = 16;
      const overlayWidth = Math.min(330, width - margin * 2);
      const below = Math.max(0, top + height - margin - anchor.bottom - 8);
      const above = Math.max(0, anchor.top - top - margin - 8);
      const cap = width <= 850 ? 540 : 590;
      const flip = below < Math.min(cap, above);
      const maxHeight = Math.min(
        cap,
        Math.max(below, above),
        height - margin * 2,
      );
      setStyle({
        width: overlayWidth,
        maxHeight,
        left: Math.max(
          left + margin,
          Math.min(
            anchor.right - overlayWidth,
            left + width - margin - overlayWidth,
          ),
        ),
        top: Math.min(
          top + height - margin - maxHeight,
          Math.max(
            top + margin,
            flip ? anchor.top - 8 - maxHeight : anchor.bottom + 8,
          ),
        ),
      });
    };
    measure();
    panel.current
      ?.querySelector<HTMLElement>(
        ".filter-overlay-body button:not(:disabled), .filter-overlay-body input:not(:disabled)",
      )
      ?.focus();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    window.visualViewport?.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("scroll", measure);
    function outside(event: PointerEvent) {
      if (
        !document.querySelector(".confirm-dialog-backdrop") &&
        event.target instanceof Node &&
        !panel.current?.contains(event.target) &&
        !trigger.current?.contains(event.target)
      )
        close();
    }
    function escape(event: KeyboardEvent) {
      if (
        event.key === "Escape" &&
        !event.defaultPrevented &&
        !document.querySelector(".confirm-dialog-backdrop")
      ) {
        event.preventDefault();
        close(true);
      }
    }
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
      window.visualViewport?.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("scroll", measure);
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open, close]);
  return { open, trigger, panel, style, close, show: () => setOpen(true) };
}
