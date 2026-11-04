import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** An extraction outcome that is either retryable or a permanent property of the file. */
export class ExtractionFailure extends Error {
  constructor(
    readonly code: string,
    readonly permanent: boolean,
    message?: string,
  ) {
    super(message || code);
  }
}

export type ToolResult = {
  code: number | null;
  stdout: Buffer;
  stderr: string;
  /** True when stdout reached the cap and the process was killed. */
  truncated: boolean;
};

const STDERR_LIMIT = 64 * 1024;

/** Runs one tool without a shell, killing it on timeout, output overflow or abort. */
export function runTool(
  command: string,
  args: string[],
  options: {
    timeoutMs?: number;
    maxOutputBytes?: number;
    signal?: AbortSignal;
  } = {},
): Promise<ToolResult> {
  const timeoutMs = options.timeoutMs ?? 60_000,
    maxOutputBytes = options.maxOutputBytes ?? 8 * 1024 * 1024;
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted)
      return reject(new ExtractionFailure("aborted", false));
    const child = spawn(command, args, {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const chunks: Buffer[] = [];
    let size = 0,
      stderr = "",
      truncated = false,
      failure: ExtractionFailure | undefined;
    const kill = (reason?: ExtractionFailure) => {
      failure ??= reason;
      child.kill("SIGKILL");
    };
    const timer = setTimeout(
      () =>
        kill(new ExtractionFailure("timeout", false, `${command} timed out`)),
      timeoutMs,
    );
    const abort = () => kill(new ExtractionFailure("aborted", false));
    options.signal?.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (chunk: Buffer) => {
      if (truncated) return;
      const room = maxOutputBytes - size;
      if (chunk.length >= room) {
        chunks.push(chunk.subarray(0, room));
        size = maxOutputBytes;
        truncated = true;
        kill();
      } else {
        chunks.push(chunk);
        size += chunk.length;
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < STDERR_LIMIT)
        stderr += chunk.toString("utf8").slice(0, STDERR_LIMIT - stderr.length);
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      reject(new ExtractionFailure("tool_unavailable", false, error.message));
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      if (failure) return reject(failure);
      resolve({ code, stdout: Buffer.concat(chunks), stderr, truncated });
    });
  });
}

/** Gives `work` a private temporary directory that is always removed afterwards. */
export async function withTempDirectory<T>(
  work: (directory: string) => Promise<T>,
): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), "chalktalk-extract-"));
  try {
    return await work(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
