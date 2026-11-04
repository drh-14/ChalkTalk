import { GetObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { createWriteStream } from "node:fs";
import { addAbortSignal, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { ExtractionFailure } from "./tools.js";

const unavailable = () =>
  new ExtractionFailure("object_store_unavailable", false);

/** Only read errors mean the store stopped answering; a failed write stays a scratch-disk error. */
async function* objectBytes(body: Readable) {
  try {
    for await (const chunk of body) yield chunk as Buffer;
  } catch {
    throw unavailable();
  }
}

/**
 * Streams a stored object to `path`. Failing with no HTTP response or a 5xx
 * says nothing about the object, so it is reported as `object_store_unavailable`.
 */
export async function downloadObject(
  store: { client: Pick<S3Client, "send">; bucket: string },
  key: string,
  path: string,
  signal: AbortSignal,
): Promise<void> {
  let body: unknown;
  try {
    ({ Body: body } = await store.client.send(
      new GetObjectCommand({ Bucket: store.bucket, Key: key }),
      { abortSignal: signal },
    ));
  } catch (error) {
    const status = (error as { $metadata?: { httpStatusCode?: number } })
      .$metadata?.httpStatusCode;
    throw status === undefined || status >= 500 ? unavailable() : error;
  }
  if (!body) throw new Error("Stored file has no body");
  try {
    await pipeline(
      objectBytes(addAbortSignal(signal, body as Readable)),
      createWriteStream(path),
      { signal },
    );
  } catch (error) {
    if (signal.aborted && (error as NodeJS.ErrnoException).code === "ABORT_ERR")
      throw unavailable();
    throw error;
  }
}
