import { promises as fs, createReadStream } from "node:fs";
import path from "node:path";

export interface LogSpoolOptions {
  directory: string;
  maxBytes?: number;
  segmentBytes?: number;
  maxAgeMs?: number;
  maxQueuedEvents?: number;
  maxQueuedBytes?: number;
}
interface SpoolCallbacks {
  onDrop(count: number): void;
  onEvict(reason: "capacity" | "age", count: number): void;
  onError(): void;
}

// A single-process append-only transport. Logstash owns read checkpoints; this owns rotation and capacity.
export class LogSpool {
  private pending = Promise.resolve();
  private queued = 0;
  private queuedBytes = 0;
  private sequence = 0;
  private current: string | undefined;
  private currentBytes = 0;
  private readonly maxBytes: number;
  private readonly segmentBytes: number;
  private readonly maxAgeMs: number;
  private readonly maxQueuedEvents: number;
  private readonly maxQueuedBytes: number;
  private readonly cleanupTimer: NodeJS.Timeout;
  constructor(
    private readonly options: LogSpoolOptions,
    private readonly callbacks: SpoolCallbacks,
  ) {
    this.maxBytes = options.maxBytes ?? 256 * 1024 * 1024;
    this.segmentBytes = options.segmentBytes ?? 16 * 1024 * 1024;
    this.maxAgeMs = options.maxAgeMs ?? 7 * 24 * 60 * 60 * 1000;
    this.maxQueuedEvents = options.maxQueuedEvents ?? 4096;
    this.maxQueuedBytes = options.maxQueuedBytes ?? 4 * 1024 * 1024;
    if (
      this.maxBytes < 1 ||
      this.segmentBytes < 1 ||
      this.maxQueuedEvents < 1 ||
      this.maxQueuedBytes < 1
    )
      throw new Error("Spool limits must be positive");
    const clean = () => {
      this.pending = this.pending
        .then(async () => {
          await fs.mkdir(this.options.directory, {
            recursive: true,
            mode: 0o755,
          });
          await this.enforceLimit();
        })
        .catch(() => this.callbacks.onError());
    };
    clean();
    this.cleanupTimer = setInterval(
      clean,
      Math.max(60_000, Math.min(this.maxAgeMs, 3_600_000)),
    );
    this.cleanupTimer.unref();
  }
  append(line: string): void {
    const bytes = Buffer.byteLength(line);
    if (
      this.queued >= this.maxQueuedEvents ||
      this.queuedBytes + bytes > this.maxQueuedBytes ||
      bytes > this.segmentBytes
    ) {
      this.callbacks.onDrop(1);
      return;
    }
    this.queued += 1;
    this.queuedBytes += bytes;
    this.pending = this.pending
      .then(() => this.write(line))
      .catch(() => {
        this.callbacks.onError();
        this.callbacks.onDrop(1);
      })
      .finally(() => {
        this.queued -= 1;
        this.queuedBytes -= bytes;
      });
  }
  async flush(): Promise<void> {
    await this.pending;
  }
  async close(): Promise<void> {
    clearInterval(this.cleanupTimer);
    await this.flush();
  }
  private nextName(): string {
    this.sequence += 1;
    return `${Date.now().toString().padStart(13, "0")}-${process.pid}-${this.sequence.toString().padStart(8, "0")}.ndjson`;
  }
  private async write(line: string): Promise<void> {
    await fs.mkdir(this.options.directory, { recursive: true, mode: 0o755 });
    const bytes = Buffer.byteLength(line);
    if (!this.current || this.currentBytes + bytes > this.segmentBytes) {
      this.current = path.join(this.options.directory, this.nextName());
      this.currentBytes = 0;
    }
    await fs.appendFile(this.current, line, { encoding: "utf8", mode: 0o644 });
    this.currentBytes += bytes;
    await this.enforceLimit();
  }
  private async enforceLimit(): Promise<void> {
    const names = (await fs.readdir(this.options.directory))
      .filter((name) => /^\d{13}-\d+-\d{8}\.ndjson$/.test(name))
      .sort();
    const entries = await Promise.all(
      names.map(async (name) => {
        const file = path.join(this.options.directory, name);
        const stat = await fs.stat(file);
        return { file, bytes: stat.size, mtimeMs: stat.mtimeMs };
      }),
    );
    let total = entries.reduce((sum, entry) => sum + entry.bytes, 0);
    for (const entry of entries) {
      const reason = total > this.maxBytes ? "capacity" : "age";
      if (reason === "age" && Date.now() - entry.mtimeMs <= this.maxAgeMs)
        continue;
      // Never delete the active segment: it may be in use by Logstash's tail input.
      if (entry.file === this.current) {
        this.current = undefined;
        this.currentBytes = 0;
      }
      let events = 0;
      for await (const chunk of createReadStream(entry.file)) {
        for (const byte of chunk) if (byte === 10) events += 1;
      }
      await fs.unlink(entry.file);
      total -= entry.bytes;
      this.callbacks.onEvict(reason, events);
    }
  }
}
