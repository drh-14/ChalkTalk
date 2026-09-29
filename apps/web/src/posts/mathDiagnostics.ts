import katex from "katex";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { mathOptions } from "./mathOptions.js";

export type MathDiagnostic = { from: number; to: number; message: string };
export type MathFormula = {
  from: number;
  to: number;
  tex: string;
  displayMode: boolean;
};
export type MathAnalysis = {
  formulas: MathFormula[];
  diagnostics: MathDiagnostic[];
};

type Node = {
  type: string;
  value?: string;
  position?: { start: { offset?: number }; end: { offset?: number } };
  children?: Node[];
};

const parser = unified().use(remarkParse).use(remarkMath);

export function getMathAnalysis(source: string): MathAnalysis {
  const result: MathAnalysis = { formulas: [], diagnostics: [] };
  const visit = (node: Node) => {
    if ((node.type === "math" || node.type === "inlineMath") && node.position) {
      const from = node.position.start.offset;
      const to = node.position.end.offset;
      if (from === undefined || to === undefined) return;
      const raw = source.slice(from, to);
      const closed =
        node.type === "math"
          ? /^\$\$[ \t]*\n[\s\S]*\n\$\$[ \t]*$/.test(raw)
          : raw.startsWith("$") && raw.endsWith("$") && raw.length >= 2;
      if (!closed) return;
      const displayMode = node.type === "math";
      try {
        katex.renderToString(node.value ?? "", {
          ...mathOptions,
          displayMode,
          throwOnError: true,
        });
        result.formulas.push({
          from,
          to,
          tex: node.value ?? "",
          displayMode,
        });
      } catch (error) {
        result.diagnostics.push({
          from,
          to,
          message:
            error instanceof Error ? error.message : "Invalid LaTeX expression",
        });
      }
    }
    node.children?.forEach(visit);
  };
  visit(parser.parse(source) as Node);
  return result;
}
