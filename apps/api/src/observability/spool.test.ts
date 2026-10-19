import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LogSpool } from "./spool.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((dir) => rm(dir, { recursive: true, force: true })),
  );
});
async function fixture(maxBytes = 100, segmentBytes = 40) {
  const directory = await mkdtemp(path.join(tmpdir(), "chalktalk-spool-"));
  directories.push(directory);
  const counts = { dropped: 0, evicted: 0, capacityEvicted: 0, errors: 0 };
  const spool = new LogSpool(
    { directory, maxBytes, segmentBytes },
    {
      onDrop: (count) => {
        counts.dropped += count;
      },
      onEvict: (reason, count) => {
        counts.evicted += 1;
        if (reason === "capacity") counts.capacityEvicted += count;
      },
      onError: () => {
        counts.errors += 1;
      },
    },
  );
  return { directory, counts, spool };
}

describe("bounded log spool", () => {
  it("rotates, evicts oldest records, and keeps a surviving backlog on disk", async () => {
    const { directory, counts, spool } = await fixture(90, 35);
    for (let index = 0; index < 8; index += 1)
      spool.append(JSON.stringify({ index }) + "\n");
    await spool.flush();
    const names = (await readdir(directory)).sort();
    const contents = (
      await Promise.all(
        names.map((name) => readFile(path.join(directory, name), "utf8")),
      )
    ).join("");
    expect(names.length).toBeGreaterThan(1);
    expect(Buffer.byteLength(contents)).toBeLessThanOrEqual(90);
    expect(contents).toContain('"index":7');
    expect(contents).not.toContain('"index":0');
    expect(counts.evicted).toBeGreaterThan(0);
    expect(counts.dropped).toBe(0);
    expect(counts.capacityEvicted).toBe(2);
  });

  it("expires old segments even when no new request arrives", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "chalktalk-spool-"));
    directories.push(directory);
    const { writeFile, utimes } = await import("node:fs/promises");
    const old = path.join(directory, "0000000000001-111-00000001.ndjson");
    await writeFile(old, '{"old":true}\n');
    const past = new Date(Date.now() - 10_000);
    await utimes(old, past, past);
    let evicted = 0;
    let capacityEvicted = 0;
    const spool = new LogSpool(
      { directory, maxAgeMs: 1000 },
      {
        onDrop: () => {},
        onEvict: (reason, count) => {
          evicted += 1;
          if (reason === "capacity") capacityEvicted += count;
        },
        onError: () => {},
      },
    );
    await spool.flush();
    expect(await readdir(directory)).toEqual([]);
    expect(evicted).toBe(1);
    expect(capacityEvicted).toBe(0);
  });

  it("expires a slowly growing segment by creation age", async () => {
    const { directory, counts, spool } = await fixture(
      256 * 1024 * 1024,
      16 * 1024 * 1024,
    );
    const day = 24 * 60 * 60 * 1000;
    let now = Date.now() - 8 * day;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
    try {
      for (let index = 0; index <= 8; index += 1) {
        spool.append(JSON.stringify({ day: index }) + "\n");
        await spool.flush();
        now += day;
      }
      const names = await readdir(directory);
      expect(names).toHaveLength(1);
      expect(await readFile(path.join(directory, names[0]!), "utf8")).toBe(
        '{"day":8}\n',
      );
      expect(counts.evicted).toBe(1);
      expect(counts.capacityEvicted).toBe(0);
      expect(counts.dropped).toBe(0);
    } finally {
      clock.mockRestore();
      await spool.close();
    }
  });

  it("bounds the in-memory queue by bytes before disk writes complete", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "chalktalk-spool-"));
    directories.push(directory);
    let dropped = 0;
    const spool = new LogSpool(
      { directory, maxBytes: 1000, segmentBytes: 100, maxQueuedBytes: 18 },
      {
        onDrop: (count) => {
          dropped += count;
        },
        onEvict: () => {},
        onError: () => {},
      },
    );
    spool.append('{"first":1}\n');
    spool.append('{"second":2}\n');
    await spool.flush();
    expect(dropped).toBe(1);
    const names = await readdir(directory);
    expect(await readFile(path.join(directory, names[0]!), "utf8")).toContain(
      "first",
    );
  });

  it("keeps caller progress when storage fails and accounts for the loss", async () => {
    const { directory, counts, spool } = await fixture();
    await spool.flush();
    await rm(directory, { recursive: true });
    // Make the configured path a file, so mkdir fails.
    const { writeFile } = await import("node:fs/promises");
    await writeFile(directory, "not a directory");
    spool.append('{"safe":true}\n');
    await spool.flush();
    expect(counts.errors).toBe(1);
    expect(counts.dropped).toBe(1);
  });

  it("reports cleanup errors without counting persisted events as drops", async () => {
    const { directory, counts, spool } = await fixture();
    await spool.flush();
    const readDirectory = vi
      .spyOn(fs, "readdir")
      .mockRejectedValueOnce(new Error("cleanup failed"));
    try {
      spool.append('{"safe":true}\n');
      await spool.flush();
    } finally {
      readDirectory.mockRestore();
    }
    const names = await readdir(directory);
    expect(await readFile(path.join(directory, names[0]!), "utf8")).toBe(
      '{"safe":true}\n',
    );
    expect(counts.errors).toBe(1);
    expect(counts.dropped).toBe(0);
  });
});
