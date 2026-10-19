import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import rehypeSanitize from "rehype-sanitize";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";
import { mathOptions } from "./mathOptions.js";

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
      rehypePlugins={[rehypeSanitize, [rehypeKatex, mathOptions]]}
      components={{
        ...(inertLinks
          ? {
              a: ({ children }: { children?: React.ReactNode }) => (
                <span>{children}</span>
              ),
            }
          : {}),
        ...(inertLinks || disableImages
          ? { img: ({ alt }: { alt?: string }) => <span>{alt}</span> }
          : {}),
      }}
    >
      {bodyMarkdown}
    </ReactMarkdown>
  );
}
