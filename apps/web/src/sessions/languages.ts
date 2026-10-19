import { cpp } from "@codemirror/lang-cpp";
import { java } from "@codemirror/lang-java";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { sql } from "@codemirror/lang-sql";
import type { Extension } from "@codemirror/state";
import type { SessionLanguage } from "./client.js";

/** CodeMirror language support for a session language; plain text has none. */
export function languageExtension(language: SessionLanguage): Extension {
  switch (language) {
    case "python":
      return python();
    case "java":
      return java();
    case "c":
    case "cpp":
      return cpp();
    case "javascript":
      return javascript();
    case "typescript":
      return javascript({ typescript: true });
    case "sql":
      return sql();
    default:
      return [];
  }
}
