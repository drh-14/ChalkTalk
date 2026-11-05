import { useEffect, useState, type ReactNode } from "react";
import type { Resource, TextProgress } from "./client.js";
import { ProgressWatcher } from "./progress-watcher.js";
import { ProgressContext, useTextProgress } from "./use-progress.js";
export function ProgressProvider({ children }: { children: ReactNode }) {
  const [watcher, setWatcher] = useState<ProgressWatcher>();
  useEffect(() => {
    const instance = new ProgressWatcher();
    setWatcher(instance);
    return () => instance.dispose();
  }, []);
  return (
    <ProgressContext.Provider value={watcher}>
      {children}
    </ProgressContext.Provider>
  );
}
export function ProgressLabel({
  progress,
}: {
  progress?: TextProgress | null;
}) {
  const phase = progress?.phase ?? "queued";
  if (phase === "ocr" && progress?.phase === "ocr")
    return (
      <span className="resource-extraction-progress">
        <span>
          OCR: {progress.completedPages} of {progress.totalPages} pages
        </span>
        <progress
          aria-label="OCR pages"
          max={progress.totalPages}
          value={progress.completedPages}
        />
      </span>
    );
  return (
    <span>
      {phase === "preparing"
        ? "Preparing extraction"
        : phase === "saving"
          ? "Saving extracted text"
          : "Queued for extraction"}
    </span>
  );
}
export function ResourceProgress({ resource }: { resource: Resource }) {
  const state = useTextProgress(resource, resource.textStatus === "pending");
  const current = state.resource ?? resource;
  if (state.inaccessible || current.textStatus !== "pending") return null;
  return (
    <span className="resource-text-status resource-text-status-pending">
      <ProgressLabel progress={current.textProgress} />
      {state.error && <span role="status">{state.error}</span>}
      {state.superseded && (
        <span role="status">
          This file was replaced. Reload the page to see its latest status.
        </span>
      )}
      {state.stopped && (
        <span>
          Automatic checks paused.{" "}
          <button
            type="button"
            className="button secondary resource-action"
            onClick={state.retry}
          >
            Check again
          </button>
        </span>
      )}
    </span>
  );
}
