import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import rehypeSanitize from "rehype-sanitize";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";
import { mathOptions } from "./mathOptions.js";

export function PostBody({
  bodyMarkdown,
  inertLinks = false,
}: {
  bodyMarkdown: string;
  inertLinks?: boolean;
}) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkMath]}
      rehypePlugins={[rehypeSanitize, [rehypeKatex, mathOptions]]}
      components={
        inertLinks
          ? {
              a: ({ children }) => <span>{children}</span>,
              img: ({ alt }) => <span>{alt}</span>,
            }
          : undefined
      }
    >
      {bodyMarkdown}
    </ReactMarkdown>
  );
}
