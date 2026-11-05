import { useEffect, useState } from "react";
import { searchablePdf, type SearchablePdf } from "./client.js";

// The server gives up on a copy after 15 minutes, so polling stops a little
// after that instead of continuing forever when no worker is generating it.
const FAST_POLL_MS = 2_000;
const SLOW_POLL_MS = 10_000;
const FAST_POLL_WINDOW_MS = 30_000;
const GIVE_UP_AFTER_MS = 16 * 60_000;

export function SearchablePdfView({
  courseId,
  resourceId,
  csrfToken,
}: {
  courseId: string;
  resourceId: string;
  csrfToken: string;
}) {
  const [data, setData] = useState<SearchablePdf>();
  const [error, setError] = useState<string>();
  const [stalled, setStalled] = useState(false);
  const [cycle, setCycle] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const startedAt = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    setError(undefined);
    setStalled(false);
    setData(undefined);
    async function read(initial = false) {
      try {
        let result = await searchablePdf(
          courseId,
          resourceId,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        if (
          result.data.status === "not_requested" ||
          (initial && cycle > 0 && result.data.status === "failed")
        )
          result = await searchablePdf(
            courseId,
            resourceId,
            controller.signal,
            csrfToken,
          );
        if (controller.signal.aborted) return;
        setData(result.data);
        if (result.data.status === "pending") {
          const elapsed = Date.now() - startedAt;
          if (elapsed >= GIVE_UP_AFTER_MS) setStalled(true);
          else
            timer = setTimeout(
              () => void read(),
              elapsed < FAST_POLL_WINDOW_MS ? FAST_POLL_MS : SLOW_POLL_MS,
            );
        }
      } catch (e) {
        if (!controller.signal.aborted)
          setError(
            e instanceof Error ? e.message : "Searchable PDF is unavailable.",
          );
      }
    }
    void read(true);
    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [courseId, resourceId, csrfToken, cycle]);
  return (
    <div className="resource-searchable-pdf">
      {!error && !stalled && (!data || data.status === "pending") && (
        <p role="status">Preparing searchable PDF…</p>
      )}
      {stalled && (
        <div role="alert">
          <p>
            This is taking longer than expected. The searchable copy may still
            be preparing in the background.
          </p>
          <button
            type="button"
            className="button secondary resource-action"
            onClick={() => setCycle((c) => c + 1)}
          >
            Check again
          </button>
        </div>
      )}
      {(error || data?.status === "failed") && (
        <div role="alert">
          <p>{error ?? "The searchable PDF could not be prepared."}</p>
          <button
            type="button"
            className="button secondary resource-action"
            onClick={() => setCycle((c) => c + 1)}
          >
            Try again
          </button>
        </div>
      )}
      {data?.status === "ready" && data.viewUrl && data.downloadUrl && (
        <>
          <div className="resource-text-panel-actions">
            <a
              className="button secondary resource-action"
              href={data.viewUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open searchable PDF
            </a>
            <a
              className="button secondary resource-action"
              href={data.downloadUrl}
            >
              Download searchable PDF
            </a>
          </div>
          <iframe
            title="Searchable PDF document"
            src={data.viewUrl}
            className="resource-pdf-frame"
          />
          <p className="resource-searchable-note">
            This searchable copy may have less zoom detail. The original PDF is
            still available from the file title.
          </p>
        </>
      )}
    </div>
  );
}
