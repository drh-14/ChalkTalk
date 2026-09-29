import { history, historyKeymap, defaultKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import {
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  keymap,
  placeholder,
  WidgetType,
  type DecorationSet,
} from "@codemirror/view";
import katex from "katex";
import { useEffect, useRef, useState, type Ref } from "react";
import { formatBody, type FormatAction } from "./formatting.js";
import {
  type MathAnalysis,
  type MathDiagnostic,
  type MathFormula,
} from "./mathDiagnostics.js";
import { mathOptions } from "./mathOptions.js";

export type PostEditorHandle = { format: (action: FormatAction) => void };

const setMathAnalysis = StateEffect.define<MathAnalysis>();

class FormulaWidget extends WidgetType {
  constructor(readonly formula: MathFormula) {
    super();
  }

  eq(other: FormulaWidget) {
    return (
      this.formula.tex === other.formula.tex &&
      this.formula.displayMode === other.formula.displayMode &&
      this.formula.from === other.formula.from &&
      this.formula.to === other.formula.to
    );
  }

  toDOM(view: EditorView) {
    const { from, to, tex, displayMode } = this.formula;
    const element = document.createElement(displayMode ? "div" : "span");
    element.className = "post-editor-math";
    element.setAttribute("role", "button");
    element.setAttribute(
      "aria-label",
      displayMode ? "Edit block math" : "Edit inline math",
    );
    element.setAttribute("tabindex", "0");
    const reveal = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      view.dispatch({
        selection: { anchor: Math.min(from + (displayMode ? 3 : 1), to) },
        scrollIntoView: true,
      });
      view.focus();
    };
    element.addEventListener("mousedown", reveal);
    element.addEventListener("click", reveal);
    element.addEventListener("keydown", (event) => {
      if (
        event instanceof KeyboardEvent &&
        (event.key === "Enter" || event.key === " ")
      )
        reveal(event);
    });
    try {
      katex.render(tex, element, {
        ...mathOptions,
        displayMode,
        throwOnError: true,
      });
    } catch {
      element.textContent = view.state.doc.sliceString(from, to);
      queueMicrotask(() => {
        if (!view.dom.isConnected) return;
        const field = view.state.field(mathField, false);
        if (!field) return;
        const formulas = field.analysis.formulas.filter(
          (item) => item.from !== from || item.to !== to,
        );
        if (formulas.length !== field.analysis.formulas.length) {
          view.dispatch({
            effects: setMathAnalysis.of({ ...field.analysis, formulas }),
          });
        }
      });
    }
    return element;
  }

  ignoreEvent() {
    return true;
  }
}

function touchesFormula(state: EditorState, { from, to }: MathFormula) {
  return state.selection.ranges.some((range) =>
    range.empty
      ? range.from >= from && range.from <= to
      : range.from <= to && range.to >= from,
  );
}

function project(state: EditorState, analysis: MathAnalysis): DecorationSet {
  const decorations = [
    ...analysis.diagnostics.map(({ from, to, message }) =>
      Decoration.mark({ class: "invalid-math", title: message }).range(
        from,
        to,
      ),
    ),
    ...analysis.formulas
      .filter((formula) => !touchesFormula(state, formula))
      .map((formula) =>
        Decoration.replace({
          widget: new FormulaWidget(formula),
          block: formula.displayMode,
        }).range(formula.from, formula.to),
      ),
  ];
  return Decoration.set(decorations, true);
}

const mathField = StateField.define<{
  analysis: MathAnalysis;
  decorations: DecorationSet;
}>({
  create() {
    return {
      analysis: { diagnostics: [], formulas: [] },
      decorations: Decoration.none,
    };
  },
  update(value, transaction) {
    const applied = transaction.effects.find((effect) =>
      effect.is(setMathAnalysis),
    );
    const analysis = applied
      ? applied.value
      : transaction.docChanged
        ? { diagnostics: [], formulas: [] }
        : value.analysis;
    if (!applied && !transaction.docChanged && !transaction.selection)
      return value;
    return { analysis, decorations: project(transaction.state, analysis) };
  },
  provide: (field) =>
    EditorView.decorations.from(field, (value) => value.decorations),
});

export function PostEditor({
  value,
  onChange,
  ref,
}: {
  value: string;
  onChange: (value: string) => void;
  ref: Ref<PostEditorHandle>;
}) {
  const host = useRef<HTMLDivElement>(null);
  const initialValue = useRef(value);
  const view = useRef<EditorView | null>(null);
  const worker = useRef<Worker | null>(null);
  const version = useRef(0);
  const onChangeRef = useRef(onChange);
  const [diagnostics, setDiagnostics] = useState<MathDiagnostic[]>([]);
  const [status, setStatus] = useState("");
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!host.current) return;
    const disableAnalysis = () => {
      version.current++;
      worker.current?.terminate();
      worker.current = null;
      view.current?.dispatch({
        effects: setMathAnalysis.of({ diagnostics: [], formulas: [] }),
      });
      setDiagnostics([]);
      setStatus("LaTeX checking is unavailable.");
    };
    const receive = (reply: {
      version: number;
      diagnostics?: MathDiagnostic[];
      formulas?: MathFormula[];
      error?: string;
    }) => {
      if (reply.version !== version.current || !view.current) return;
      if (reply.error) {
        disableAnalysis();
        return;
      }
      setStatus("");
      const analysis = {
        diagnostics: reply.diagnostics ?? [],
        formulas: reply.formulas ?? [],
      };
      view.current.dispatch({ effects: setMathAnalysis.of(analysis) });
      setDiagnostics(analysis.diagnostics);
    };
    const analyze = (source: string, nextVersion: number) => {
      if (!worker.current) return;
      try {
        worker.current.postMessage({ version: nextVersion, source });
      } catch {
        disableAnalysis();
      }
    };
    try {
      if (typeof Worker !== "undefined") {
        worker.current = new Worker(
          new URL("./mathDiagnostics.worker.ts", import.meta.url),
          { type: "module" },
        );
        worker.current.onmessage = (event: MessageEvent) => receive(event.data);
        worker.current.onerror = disableAnalysis;
      } else disableAnalysis();
    } catch {
      disableAnalysis();
    }
    const extensions: Extension[] = [
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      markdown(),
      EditorView.lineWrapping,
      placeholder("Write your post…"),
      EditorView.contentAttributes.of({
        role: "textbox",
        "aria-label": "Post body",
        "aria-multiline": "true",
        "aria-describedby": "post-body-diagnostics",
      }),
      mathField,
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          const source = update.state.doc.toString();
          onChangeRef.current(source);
          setDiagnostics([]);
          const nextVersion = ++version.current;
          analyze(source, nextVersion);
        }
      }),
    ];
    const next = new EditorView({
      doc: initialValue.current,
      extensions,
      parent: host.current,
    });
    view.current = next;
    if (initialValue.current) {
      const source = initialValue.current;
      const initialVersion = ++version.current;
      analyze(source, initialVersion);
    }
    return () => {
      view.current = null;
      worker.current?.terminate();
      worker.current = null;
      next.destroy();
    };
  }, []);

  const handle = {
    format(action: FormatAction) {
      const current = view.current;
      if (!current) return;
      const source = current.state.doc.toString();
      const { from, to } = current.state.selection.main;
      const formatted = formatBody(source, { from, to }, action);
      current.dispatch({
        changes: { from: 0, to: source.length, insert: formatted.text },
        selection: { anchor: formatted.from, head: formatted.to },
        scrollIntoView: true,
      });
      current.focus();
    },
  };
  if (typeof ref === "function") ref(handle);
  else if (ref) ref.current = handle;

  return (
    <>
      <div className="post-source-editor" ref={host} />
      <div
        id="post-body-diagnostics"
        className="post-math-diagnostics"
        aria-label="LaTeX diagnostics"
      >
        {status && <p>{status}</p>}
        {diagnostics.map((item) => (
          <p key={`${item.from}-${item.to}`}>
            LaTeX at position {item.from + 1}: {item.message}
          </p>
        ))}
      </div>
    </>
  );
}
