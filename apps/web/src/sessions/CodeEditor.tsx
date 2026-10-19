import { defaultKeymap, indentWithTab } from "@codemirror/commands";
import {
  bracketMatching,
  defaultHighlightStyle,
  indentOnInput,
  syntaxHighlighting,
} from "@codemirror/language";
import { Compartment, EditorState } from "@codemirror/state";
import {
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { useEffect, useId, useRef, useState } from "react";
import { yCollab, yUndoManagerKeymap } from "y-codemirror.next";
import * as Y from "yjs";
import type { Awareness } from "y-protocols/awareness";
import type { SessionLanguage } from "./client.js";
import { languageExtension } from "./languages.js";

const editability = (readOnly: boolean) => [
  EditorState.readOnly.of(readOnly),
  EditorView.editable.of(!readOnly),
];

/**
 * A shared code buffer bound to a Yjs text. Edits are applied as CRDT
 * operations, so concurrent changes from other participants merge in place.
 */
export function CodeEditor({
  text,
  awareness,
  language,
  readOnly,
  label = "Shared code",
}: {
  text: Y.Text;
  awareness?: Awareness | null;
  language: SessionLanguage;
  readOnly: boolean;
  label?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const languageSlot = useRef(new Compartment());
  const editableSlot = useRef(new Compartment());
  const initial = useRef({ language, readOnly });
  const [focused, setFocused] = useState(false);
  const hintId = useId();

  useEffect(() => {
    if (!host.current) return;
    const undoManager = new Y.UndoManager(text);
    const next = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: text.toString(),
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightActiveLine(),
          indentOnInput(),
          bracketMatching(),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          keymap.of([...yUndoManagerKeymap, indentWithTab, ...defaultKeymap]),
          languageSlot.current.of(languageExtension(initial.current.language)),
          editableSlot.current.of(editability(initial.current.readOnly)),
          yCollab(text, awareness ?? null, { undoManager }),
          EditorView.contentAttributes.of({
            "aria-label": label,
            "aria-describedby": hintId,
            "aria-multiline": "true",
            spellcheck: "false",
            autocorrect: "off",
            autocapitalize: "off",
          }),
        ],
      }),
    });
    view.current = next;
    return () => {
      view.current = null;
      next.destroy();
      undoManager.destroy();
    };
  }, [text, awareness, label, hintId]);

  useEffect(() => {
    view.current?.dispatch({
      effects: languageSlot.current.reconfigure(languageExtension(language)),
    });
  }, [language]);

  useEffect(() => {
    view.current?.dispatch({
      effects: editableSlot.current.reconfigure(editability(readOnly)),
    });
  }, [readOnly]);

  // Tab indents; CodeMirror lets Escape release the next Tab to move focus on.
  return (
    <div
      className="code-editor"
      data-language={language}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setFocused(false);
      }}
    >
      <div className="code-editor-host" ref={host} />
      <p
        id={hintId}
        className={`code-editor-hint${focused && !readOnly ? " visible" : ""}`}
      >
        Press Esc, then Tab, to leave the editor
      </p>
    </div>
  );
}
