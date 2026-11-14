import { useCallback, useEffect, useRef, useState } from "react";
import { listResourceQuestions, type ResourceQuestions } from "./client.js";

export function useQuestions(courseId: string, resourceId: string, fileId?: string) {
  const [questions, setQuestions] = useState<ResourceQuestions>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [changed, setChanged] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const refreshRef = useRef<() => Promise<void>>(async () => {});
  const refresh = useCallback(() => refreshRef.current(), []);
  useEffect(() => {
    setQuestions(undefined);
    setError("");
    setChanged(false);
    setUnavailable(false);
    setLoading(true);
    if (!fileId) return;
    const controller = new AbortController();
    let pending = false;
    let queued = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let replaced = false;
    async function read() {
      if (controller.signal.aborted || replaced) return;
      if (pending) {queued = true; return;}
      pending = true;
      clearTimeout(timer);
      try {
        const result = await listResourceQuestions(courseId, resourceId, controller.signal);
        if (controller.signal.aborted) return;
        if (result.fileId !== fileId) {
          replaced = true;
          setChanged(true);
          return;
        }
        setQuestions(result);
        setError("");
      } catch (caught) {
        if (controller.signal.aborted) return;
        const status = caught && typeof caught === "object" && "status" in caught ? caught.status : undefined;
        if (status === 401 || status === 404) {
          setQuestions(undefined);
          setUnavailable(true);
          replaced = true;
        }
        setError("Questions couldn’t load. Please try again.");
      } finally {
        pending = false;
        if (!controller.signal.aborted) {
          setLoading(false);
          if (queued && !replaced) {queued = false; void read();}
          else if (!replaced && document.visibilityState === "visible")
            timer = setTimeout(() => void read(), 15_000);
        }
      }
    }
    function onReturn() {
      clearTimeout(timer);
      if (document.visibilityState === "visible") void read();
    }
    refreshRef.current = read;
    void read();
    document.addEventListener("visibilitychange", onReturn);
    window.addEventListener("focus", onReturn);
    return () => {
      controller.abort();
      clearTimeout(timer);
      refreshRef.current = async () => {};
      document.removeEventListener("visibilitychange", onReturn);
      window.removeEventListener("focus", onReturn);
    };
  }, [courseId, resourceId, fileId]);
  return {questions, loading, error, changed, unavailable, refresh, markChanged: () => setChanged(true)};
}
