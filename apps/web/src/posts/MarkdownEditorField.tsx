import { useRef, useState, type Ref } from "react";
import { PostBody } from "./PostBody.js";
import { PostEditor, type PostEditorHandle } from "./PostEditor.js";
import type { FormatAction } from "./formatting.js";
import type * as Y from "yjs";

export function MarkdownEditorField({
  label,
  value,
  onChange,
  containerRef,
  disableImages = false,
  liveText,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  containerRef?: Ref<HTMLDivElement>;
  disableImages?: boolean;
  liveText?: Y.Text;
}) {
  const [preview, setPreview] = useState(false);
  const editor = useRef<PostEditorHandle>(null);
  const options: [FormatAction, string][] = [
    ["bold", "Bold"],
    ["italic", "Italic"],
    ["heading", "Heading"],
    ["link", "Link"],
    ["bullet-list", "Bulleted list"],
    ["numbered-list", "Numbered list"],
    ["code", "Inline code"],
    ["inline-math", "Inline math"],
    ["block-math", "Block math"],
  ];
  return (
    <div className="post-body-field">
      <span className="post-body-label">{label}</span>
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
        {options.map(([action, actionLabel]) => (
          <button
            key={action}
            type="button"
            aria-label={actionLabel}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => editor.current?.format(action)}
          >
            {actionLabel}
          </button>
        ))}
      </div>
      <div hidden={preview} ref={containerRef}>
        <PostEditor
          ref={editor}
          label={label}
          value={value}
          onChange={onChange}
          liveText={liveText}
        />
      </div>
      {preview && (
        <div
          className="post-markdown post-preview"
          role="region"
          aria-label={`${label} preview`}
        >
          <PostBody bodyMarkdown={value} disableImages={disableImages} />
        </div>
      )}
      <small>
        Use $…$ for inline math and standalone $$ lines for block math.
      </small>
    </div>
  );
}
