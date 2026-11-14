import { useEffect, useRef, useState } from "react";
import type { AnchorBox } from "../posts/client.js";
import { loadPdf } from "./pdf.js";

/** The box is drawn this many CSS pixels wide, before the frame scales it down. */
const CROP_WIDTH = 480;

/**
 * Draws one anchored area of a PDF page inside a fixed-height frame, so the
 * frame holds its space while pdf.js renders. Lazily loaded with pdf.js.
 */
export default function AnchorCrop({
  courseId,
  fileId,
  page,
  box,
  label,
}: {
  courseId: string;
  fileId: string;
  page: number;
  box: AnchorBox;
  /** Alternative text naming the slides and page. */
  label: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  useEffect(() => {
    let active = true;
    let cancel = () => {};
    setState("loading");
    (async () => {
      const doc = await loadPdf(courseId, fileId);
      const pdfPage = await doc.getPage(page);
      const base = pdfPage.getViewport({ scale: 1 });
      const ratio = window.devicePixelRatio || 1;
      // Scale the page so the box comes out CROP_WIDTH wide, within sane limits.
      const scale =
        Math.min(Math.max(CROP_WIDTH / (box.width * base.width), 0.5), 6) *
        ratio;
      const viewport = pdfPage.getViewport({
        scale,
        offsetX: -box.x * base.width * scale,
        offsetY: -box.y * base.height * scale,
      });
      const target = canvas.current;
      if (!active || !target) return;
      target.width = Math.max(1, Math.round(box.width * base.width * scale));
      target.height = Math.max(1, Math.round(box.height * base.height * scale));
      const task = pdfPage.render({
        canvasContext: target.getContext("2d")!,
        viewport,
      });
      cancel = () => task.cancel();
      await task.promise;
      if (active) setState("ready");
    })().catch(() => {
      if (active) setState("error");
    });
    return () => {
      active = false;
      cancel();
    };
  }, [courseId, fileId, page, box.x, box.y, box.width, box.height]);
  return (
    <figure
      className={`anchor-crop${state === "loading" ? " loading" : ""}`}
      role="img"
      aria-label={label}
    >
      {state === "error" ? (
        <p className="anchor-crop-error">The slide preview couldn't load.</p>
      ) : (
        <canvas ref={canvas} aria-hidden="true" />
      )}
    </figure>
  );
}
