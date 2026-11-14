import { useEffect, useRef, useState } from "react";
import { searchablePdf, type SearchablePdf } from "../course-files/client.js";

export function useSearchableCopy(courseId: string, resourceId: string, fileId: string | undefined, csrfToken: string, enabled: boolean) {
  const [data, setData] = useState<SearchablePdf>();
  const [error, setError] = useState("");
  const [stalled, setStalled] = useState(false);
  const [changed, setChanged] = useState(false);
  const prepared = useRef("");
  const [action, setAction] = useState({cycle: 0, prepare: false});
  useEffect(() => {
    setData(undefined);
    setChanged(false);
    setAction({cycle: 0, prepare: false});
  }, [fileId, courseId, resourceId]);
  useEffect(() => {
    if (!enabled || !fileId) return;
    const controller = new AbortController();
    const startedAt = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    setError("");
    setStalled(false);
    async function read(prepare = false) {
      try {
        const result = await searchablePdf(courseId, resourceId, controller.signal, prepare ? csrfToken : undefined);
        if (controller.signal.aborted) return;
        if (result.data.fileId !== fileId) {
          setChanged(true);
          setData(undefined);
          return;
        }
        setData(result.data);
        if (result.data.status === "pending") {
          const elapsed = Date.now() - startedAt;
          if (elapsed >= 16 * 60_000) setStalled(true);
          else timer = setTimeout(() => void read(), elapsed < 30_000 ? 2_000 : 10_000);
        }
      } catch (caught) {
        if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "The searchable copy couldn’t load.");
      }
    }
    const requestKey = `${courseId}:${resourceId}:${fileId}:${action.cycle}`;
    const prepare = action.prepare && prepared.current !== requestKey;
    if (prepare) prepared.current = requestKey;
    void read(prepare);
    return () => {controller.abort(); clearTimeout(timer);};
  }, [courseId, resourceId, fileId, csrfToken, enabled, action]);
  return {data, error, stalled, changed, retry: (prepare = false) => setAction(old => ({cycle: old.cycle + 1, prepare}))};
}
