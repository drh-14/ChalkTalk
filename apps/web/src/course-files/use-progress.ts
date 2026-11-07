import { createContext, useContext, useEffect, useState } from "react";
import type { Resource } from "./client.js";
import {
  ProgressWatcher,
  progressKey,
  type WatchState,
} from "./progress-watcher.js";
export const ProgressContext = createContext<ProgressWatcher | undefined>(
  undefined,
);
export const useProgressWatcher = () => useContext(ProgressContext);
export function useTextProgress(
  resource: Resource | undefined,
  enabled: boolean,
) {
  const watcher = useProgressWatcher();
  const [state, setState] = useState<WatchState>({});
  const key = resource ? progressKey(resource) : "";
  useEffect(() => {
    setState({});
    if (watcher && resource && enabled)
      return watcher.subscribe(resource, setState);
    // Identity, not each metadata tick, owns the subscription.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watcher, key, enabled]);
  return { ...state, retry: () => resource && watcher?.retry(resource) };
}
