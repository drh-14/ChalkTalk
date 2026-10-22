import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import rehypeKatex from "rehype-katex";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";
import { mathOptions } from "./mathOptions.js";

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
      remarkPlugins={[remarkMath]}
      rehypePlugins={[
        [rehypeSanitize, sanitizeSchema],
        [rehypeKatex, mathOptions],
      ]}
      urlTransform={urlTransform}
      components={{
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
