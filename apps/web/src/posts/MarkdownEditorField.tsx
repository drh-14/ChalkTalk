import { useContext, useRef, useState, type Ref } from "react";
import { MentionContext } from "./mentions.js";
import { PostBody } from "./PostBody.js";
import { PostEditor, type PostEditorHandle } from "./PostEditor.js";
import type { FormatAction } from "./formatting.js";

// Lucide-style toolbar icons; each button keeps its text name for assistive
// technology and shows it as a tooltip.
const FORMAT_ICONS: Record<FormatAction, string[]> = {
  bold: [
    "M6 12h9a4 4 0 0 1 0 8H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7a4 4 0 0 1 0 8",
  ],
  italic: ["M19 4h-9", "M14 20H5", "M15 4 9 20"],
  heading: ["M6 12h12", "M6 20V4", "M18 20V4"],
  link: [
    "M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71",
    "M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71",
  ],
  "bullet-list": [
    "M3 6h.01",
    "M3 12h.01",
    "M3 18h.01",
    "M8 6h13",
    "M8 12h13",
    "M8 18h13",
  ],
  "numbered-list": [
    "M10 6h11",
    "M10 12h11",
    "M10 18h11",
    "M4 6h1v4",
    "M4 10h2",
    "M6 18H4c0-1 2-2 2-3s-1-1.5-2-1",
  ],
  code: ["m16 18 6-6-6-6", "m8 6-6 6 6 6"],
  "inline-math": [
    "M18 7V5a1 1 0 0 0-1-1H6.5a.5.5 0 0 0-.4.8l4.5 6a2 2 0 0 1 0 2.4l-4.5 6a.5.5 0 0 0 .4.8H17a1 1 0 0 0 1-1v-2",
  ],
  "block-math": [
    "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z",
    "M16 8.9V7H8l4 5-4 5h8v-1.9",
  ],
};
// Buttons are grouped: text style, link, lists, code and math.
const FORMAT_GROUPS: [FormatAction, string][][] = [
  [
    ["bold", "Bold"],
    ["italic", "Italic"],
    ["heading", "Heading"],
  ],
  [["link", "Link"]],
  [
    ["bullet-list", "Bulleted list"],
    ["numbered-list", "Numbered list"],
  ],
  [
    ["code", "Inline code"],
    ["inline-math", "Inline math"],
    ["block-math", "Block math"],
  ],
];

export function MarkdownEditorField({
  label,
  value,
  onChange,
  containerRef,
  disableImages = false,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  containerRef?: Ref<HTMLDivElement>;
  disableImages?: boolean;
  disabled?: boolean;
}) {
  const [preview, setPreview] = useState(false);
  const editor = useRef<PostEditorHandle>(null);
  const mentions = useContext(MentionContext);
  return (
    <div className="post-body-field">
      <span className="post-body-label">{label}</span>
      <div className="editor-frame">
        <div className="editor-bar">
          <div className="post-body-mode">
            <button
              type="button"
              aria-pressed={!preview}
              onClick={() => setPreview(false)}
            >
              Write
            </button>
            <button
              type="button"
              aria-pressed={preview}
              onClick={() => setPreview(true)}
            >
              Preview
            </button>
          </div>
          <div
            className="post-format-toolbar"
            role="toolbar"
            aria-label={`${label} formatting`}
            hidden={preview}
          >
            {FORMAT_GROUPS.map((group, index) => (
              <span className="post-format-group" key={index}>
                {group.map(([action, actionLabel]) => (
                  <button
                    key={action}
                    type="button"
                    aria-label={actionLabel}
                    title={actionLabel}
                    disabled={disabled}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => editor.current?.format(action)}
                  >
                    <svg
                      viewBox="0 0 24 24"
                      width="16"
                      height="16"
                      aria-hidden="true"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      {FORMAT_ICONS[action].map((d) => (
                        <path key={d} d={d} />
                      ))}
                    </svg>
                  </button>
                ))}
              </span>
            ))}
          </div>
        </div>
        <div hidden={preview} ref={containerRef}>
          <PostEditor
            mentions={mentions}
            ref={editor}
            label={label}
            value={value}
            onChange={onChange}
            disabled={disabled}
          />
        </div>
        {preview && (
          <div
            className="post-markdown post-preview"
            role="region"
            aria-label={`${label} preview`}
          >
            {value.trim() ? (
              <PostBody bodyMarkdown={value} disableImages={disableImages} />
            ) : (
              <p className="post-preview-empty">Nothing to preview yet.</p>
            )}
          </div>
        )}
        <small className="editor-hint">
          Markdown supported. Use $…$ for inline math and standalone $$ lines
          for block math.
        </small>
      </div>
    </div>
  );
}
