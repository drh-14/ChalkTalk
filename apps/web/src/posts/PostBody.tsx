import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import rehypeSanitize from "rehype-sanitize";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";
import { mathOptions } from "./mathOptions.js";

export function PostBody({ bodyMarkdown }: { bodyMarkdown: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkMath]}
      rehypePlugins={[rehypeSanitize, [rehypeKatex, mathOptions]]}
    >
      {bodyMarkdown}
    </ReactMarkdown>
  );
}
