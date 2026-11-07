import { ProgressLabel } from "./progress.js";
import { useTextProgress } from "./use-progress.js";
import { SearchablePdfView } from "./searchable-pdf.js";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { extractedText, type ExtractedText, type Resource } from "./client.js";
import { readableExtractedText, extractedTextFilename } from "./text-format.js";

export function ResourceExtractedText({
  courseId,
  resourceId,
  name,
  mediaType,
  csrfToken,
  resource,
}: {
  courseId: string;
  resourceId: string;
  name: string;
  mediaType?: string;
  csrfToken: string;
  resource?: Resource;
}) {
  const [expanded, setExpanded] = useState(false);
  const [cycle, setCycle] = useState(0);
  const [data, setData] = useState<ExtractedText>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [layout, setLayout] = useState("readable");
  const pdfLayout = layout === "pdf";
  const [downloadUrl, setDownloadUrl] = useState<string>();
  const state = useTextProgress(
    resource,
    expanded && layout !== "pdf" && data?.status === "pending",
  );
  const readyFetched = useRef(false);
  useEffect(() => {
    if (!expanded || layout === "pdf" || state.inaccessible) return;
    if (
      state.resource?.textStatus === "ready" &&
      data?.status === "pending" &&
      !readyFetched.current
    ) {
      readyFetched.current = true;
      setCycle((c) => c + 1);
    } else if (
      state.resource?.textStatus === "failed" ||
      state.resource?.textStatus === "unsupported"
    ) {
      setData(
        (old) =>
          old && { ...old, status: state.resource!.textStatus!, text: null },
      );
    }
  }, [state.resource, state.inaccessible, expanded, layout, data?.status]);
  const displayedText = useMemo(
    () =>
      layout === "original"
        ? (data?.text ?? "")
        : readableExtractedText(data?.text ?? ""),
    [data?.text, layout],
  );
  useEffect(() => {
    if (
      !expanded ||
      layout === "pdf" ||
      loading ||
      error ||
      data?.status !== "ready"
    ) {
      setDownloadUrl(undefined);
      return;
    }
    const url = URL.createObjectURL(
      new Blob([displayedText], { type: "text/plain;charset=utf-8" }),
    );
    setDownloadUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [expanded, layout, loading, error, data?.status, displayedText]);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
    if (!expanded || pdfLayout) return;
    const controller = new AbortController();
    setLoading(true);
    setData(undefined);
    setError(undefined);
    extractedText(courseId, resourceId, controller.signal)
      .then(({ data }) => {
        if (!controller.signal.aborted) setData(data);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setError(
            error instanceof Error
              ? error.message
              : "Extracted text is unavailable. Please try again.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [courseId, resourceId, expanded, cycle, pdfLayout]);
  function close() {
    readyFetched.current = false;
    setExpanded(false);
    trigger.current?.focus();
  }
  return (
    <div className="resource-extracted-text">
      <button
        ref={trigger}
        type="button"
        className="button secondary resource-action"
        aria-expanded={expanded}
        aria-controls={expanded ? id : undefined}
        onClick={() => (expanded ? close() : setExpanded(true))}
      >
        {expanded ? "Hide extracted text" : "View extracted text"}
      </button>
      {expanded && !state.inaccessible && (
        <section
          id={id}
          role="region"
          aria-label={`Extracted text for ${name}`}
          className="resource-text-panel"
        >
          <div className="resource-text-panel-heading">
            <h4>Extracted text</h4>
            <label className="resource-text-layout">
              Text layout
              <select
                value={layout}
                onChange={(event) => setLayout(event.target.value)}
              >
                <option value="readable">Readable paragraphs</option>
                <option value="original">Original line breaks</option>
                {mediaType === "application/pdf" && (
                  <option value="pdf">Searchable PDF</option>
                )}
              </select>
            </label>
            <div className="resource-text-panel-actions">
              {downloadUrl && (
                <a
                  className="button secondary resource-action"
                  href={downloadUrl}
                  download={extractedTextFilename(name)}
                >
                  Download .txt
                </a>
              )}
              <button
                type="button"
                className="button secondary resource-action"
                onClick={close}
              >
                Close extracted text
              </button>
            </div>
          </div>
          {layout === "pdf" ? (
            <SearchablePdfView
              courseId={courseId}
              resourceId={resourceId}
              csrfToken={csrfToken}
            />
          ) : (
            <>
              {loading && (
                <p role="status" className="loading-line">
                  Loading extracted text…
                </p>
              )}
              {error && (
                <div role="alert">
                  <p>{error}</p>
                  <button
                    type="button"
                    className="button secondary resource-action"
                    onClick={() => setCycle((c) => c + 1)}
                  >
                    Try again
                  </button>
                </div>
              )}
              {!loading && !error && data && (
                <>
                  {data.status === "ready" ? (
                    <>
                      {data.truncated && (
                        <p className="course-file-meta">
                          Only part of this file's text was extracted.
                        </p>
                      )}
                      {data.text ? (
                        <pre
                          tabIndex={0}
                          aria-label="Extracted text"
                          className={
                            layout === "original"
                              ? "resource-text-original"
                              : undefined
                          }
                        >
                          {displayedText}
                        </pre>
                      ) : (
                        <p>No text was found in this file.</p>
                      )}
                    </>
                  ) : (
                    <>
                      <div role="status">
                        {data.status === "pending" ? (
                          <ProgressLabel
                            progress={
                              (state.resource ?? resource)?.textProgress
                            }
                          />
                        ) : data.status === "failed" ? (
                          "Text could not be extracted from this file."
                        ) : (
                          "Text extraction is not supported for this file."
                        )}
                      </div>
                      {state.error && <p role="status">{state.error}</p>}
                      {state.superseded && (
                        <p role="status">
                          This file was replaced. Reload the page to see its
                          latest status.
                        </p>
                      )}
                      {state.stopped && (
                        <p>
                          Automatic checks paused.{" "}
                          <button
                            type="button"
                            className="button secondary resource-action"
                            onClick={state.retry}
                          >
                            Check again
                          </button>
                        </p>
                      )}
                      {data.status === "pending" && (
                        <button
                          type="button"
                          className="button secondary resource-action"
                          onClick={() => setCycle((c) => c + 1)}
                        >
                          Refresh text
                        </button>
                      )}
                    </>
                  )}
                </>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}
