import { ApiError } from "../auth/client.js";
import { resourceMetadata, type Resource } from "./client.js";
export const progressKey = (r: Resource) =>
  JSON.stringify([r.courseId, r.id, r.fileId]);
export type WatchState = {
  resource?: Resource;
  error?: string;
  stopped?: boolean;
  superseded?: boolean;
  inaccessible?: boolean;
};
type Entry = {
  identity: Resource;
  listeners: Set<(state: WatchState) => void>;
  state: WatchState;
  start: number;
  next: number;
  failures: number;
  controller?: AbortController;
};
/** One metadata scheduler per mounted course. Requests never replace catalog/editor state. */
export class ProgressWatcher {
  private entries = new Map<string, Entry>();
  private active = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private disposed = false;
  onUpdate?: (resource: Resource) => void;
  onInvalidate?: (resource: Resource) => void;
  constructor() {
    document.addEventListener("visibilitychange", this.visibility);
  }
  private visibility = () => {
    clearTimeout(this.timer);
    for (const entry of this.entries.values()) {
      entry.controller?.abort();
      entry.controller = undefined;
      if (
        !document.hidden &&
        !entry.state.inaccessible &&
        !entry.state.superseded &&
        entry.state.resource?.textStatus !== "ready" &&
        (!entry.state.resource || entry.state.resource.textStatus === "pending")
      )
        this.reset(entry, true);
    }
    this.pump();
  };
  private emit(entry: Entry) {
    for (const listener of entry.listeners) listener(entry.state);
  }
  private reset(entry: Entry, immediate = false) {
    entry.start = Date.now();
    entry.next = Date.now() + (immediate ? 0 : 2000);
    entry.failures = 0;
    entry.state = { resource: entry.state.resource };
    this.emit(entry);
  }
  subscribe(identity: Resource, listener: (state: WatchState) => void) {
    const key = progressKey(identity);
    let entry = this.entries.get(key);
    if (!entry) {
      entry = {
        identity,
        listeners: new Set(),
        state: {},
        start: Date.now(),
        next: Date.now() + 2000,
        failures: 0,
      };
      this.entries.set(key, entry);
    }
    entry.listeners.add(listener);
    listener(entry.state);
    this.pump();
    return () => {
      entry!.listeners.delete(listener);
      if (!entry!.listeners.size) {
        entry!.controller?.abort();
        this.entries.delete(key);
      }
      this.pump();
    };
  }
  retry(identity: Resource) {
    const entry = this.entries.get(progressKey(identity));
    if (entry && !entry.state.inaccessible && !entry.state.superseded) {
      this.reset(entry, true);
      this.pump();
    }
  }
  private pump() {
    clearTimeout(this.timer);
    if (this.disposed || document.hidden) return;
    let next = Infinity;
    for (const entry of this.entries.values()) {
      if (
        entry.state.stopped ||
        entry.state.inaccessible ||
        entry.state.superseded ||
        (entry.state.resource && entry.state.resource.textStatus !== "pending")
      )
        continue;
      const deadline = entry.start + 16 * 60_000;
      if (Date.now() >= deadline) {
        entry.controller?.abort();
        entry.state = { ...entry.state, stopped: true };
        this.emit(entry);
        continue;
      }
      next = Math.min(next, deadline);
      if (entry.controller) continue;
      if (entry.next <= Date.now() && this.active < 4) void this.check(entry);
      else if (this.active < 4) next = Math.min(next, entry.next, deadline);
    }
    if (Number.isFinite(next))
      this.timer = setTimeout(
        () => this.pump(),
        Math.max(0, next - Date.now()),
      );
  }
  private async check(entry: Entry) {
    const controller = new AbortController();
    entry.controller = controller;
    this.active++;
    const current = () =>
      !this.disposed &&
      !controller.signal.aborted &&
      this.entries.get(progressKey(entry.identity)) === entry &&
      entry.controller === controller;
    try {
      const { data } = await resourceMetadata(
        entry.identity.courseId,
        entry.identity.id,
        controller.signal,
      );
      if (!current()) return;
      if (progressKey(data) !== progressKey(entry.identity)) {
        entry.state = { resource: entry.state.resource, superseded: true };
      } else {
        entry.failures = 0;
        entry.state = { resource: data };
        this.onUpdate?.(data);
        entry.next =
          Date.now() + (Date.now() - entry.start < 30_000 ? 2000 : 10_000);
      }
      this.emit(entry);
    } catch (error) {
      if (!current()) return;
      if (error instanceof ApiError && [401, 404].includes(error.status)) {
        entry.state = { inaccessible: true };
        this.onInvalidate?.(entry.identity);
      } else {
        entry.failures++;
        entry.state = {
          ...entry.state,
          error: "Extraction updates are unavailable. Please try again.",
          stopped: entry.failures >= 3,
        };
        entry.next = Date.now() + (entry.failures === 1 ? 10_000 : 30_000);
      }
      this.emit(entry);
    } finally {
      if (entry.controller === controller) entry.controller = undefined;
      this.active--;
      this.pump();
    }
  }
  dispose() {
    this.disposed = true;
    clearTimeout(this.timer);
    document.removeEventListener("visibilitychange", this.visibility);
    for (const entry of this.entries.values()) entry.controller?.abort();
    this.entries.clear();
  }
}
