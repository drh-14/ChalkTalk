import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import rehypeKatex from "rehype-katex";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";
import { useEffect, useRef, useState } from "react";
import { mathOptions } from "./mathOptions.js";

function ScrollableTable({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [overflowing, setOverflowing] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () =>
      setOverflowing(element.scrollWidth > element.clientWidth + 1);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    const table = element.querySelector("table");
    if (table) observer.observe(table);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="table-wrap">
      {overflowing && (
        <span className="table-scroll-hint" aria-hidden="true">
          Scroll table horizontally →
        </span>
      )}
      <div
        ref={ref}
        className="table-scroll"
        role={overflowing ? "region" : undefined}
        aria-label={overflowing ? "Scrollable table" : undefined}
        tabIndex={overflowing ? 0 : undefined}
      >
        <table>{children}</table>
      </div>
    </div>
  );
}

const MENTION =
  /^mention:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Mentions are `[@Name](mention:<userId>)` links; every other protocol keeps the
// default allowlist.
const sanitizeSchema = {
  ...defaultSchema,
  protocols: {
    ...defaultSchema.protocols,
    href: [...(defaultSchema.protocols?.href ?? []), "mention"],
  },
};
const urlTransform = (url: string) =>
  MENTION.test(url) ? url : defaultUrlTransform(url);

export function PostBody({
  bodyMarkdown,
  inertLinks = false,
  disableImages = false,
}: {
  bodyMarkdown: string;
  inertLinks?: boolean;
  disableImages?: boolean;
}) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[
        [rehypeSanitize, sanitizeSchema],
        [rehypeKatex, mathOptions],
      ]}
      urlTransform={urlTransform}
      components={{
        // Wide tables scroll inside the body instead of widening the page.
        table: ({ children }) => <ScrollableTable>{children}</ScrollableTable>,
        a: ({ href, title, children }) =>
          href && MENTION.test(href) ? (
            <span className="mention">{children}</span>
          ) : inertLinks ? (
            <span>{children}</span>
          ) : (
            <a href={href} title={title}>
              {children}
            </a>
          ),
        ...(inertLinks || disableImages
          ? { img: ({ alt }: { alt?: string }) => <span>{alt}</span> }
          : {}),
      }}
    >
      {bodyMarkdown}
    </ReactMarkdown>
  );
}
