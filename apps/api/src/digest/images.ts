import { GetObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import sharp, { type Sharp } from "sharp";
import type { Readable } from "node:stream";

export type DigestImage = {
  id?: string;
  filename: string;
  url: string;
  sizeBytes: number;
  read(signal: AbortSignal): Promise<Buffer | undefined>;
};
export type DigestImageReader = (
  objectKey: string,
  signal: AbortSignal,
) => Promise<Buffer | undefined>;
const SOURCE_LIMIT = 5 * 1024 * 1024;

/** No public URLs and no transformToByteArray on potentially oversized input. */
export function s3DigestImageReader(
  client: S3Client,
  bucket: string,
): DigestImageReader {
  return async (objectKey, signal) => {
    const result = await client.send(
      new GetObjectCommand({ Bucket: bucket, Key: objectKey }),
      { abortSignal: signal },
    );
    if (
      !result.Body ||
      !result.ContentLength ||
      result.ContentLength > SOURCE_LIMIT
    ) {
      (result.Body as Readable | undefined)?.destroy();
      return undefined;
    }
    const body = result.Body as Readable;
    const abort = () => body.destroy(new Error("Digest image read aborted"));
    signal.addEventListener("abort", abort, { once: true });
    const chunks: Buffer[] = [];
    let size = 0;
    try {
      for await (const chunk of result.Body as AsyncIterable<Uint8Array>) {
        size += chunk.length;
        if (signal.aborted || size > SOURCE_LIMIT) return undefined;
        chunks.push(Buffer.from(chunk));
      }
      return Buffer.concat(chunks, size);
    } finally {
      signal.removeEventListener("abort", abort);
      body.destroy();
    }
  };
}

export async function renderAttachedImage(
  image: DigestImage,
): Promise<Buffer | undefined> {
  if (image.sizeBytes <= 0 || image.sizeBytes > SOURCE_LIMIT) return undefined;
  const controller = new AbortController();
  let transform: Sharp | undefined;
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      transform?.destroy();
      resolve(undefined);
    }, 3000);
  });
  const convert = async (): Promise<Buffer | undefined> => {
    try {
      const source = await image.read(controller.signal);
      if (!source || source.length > SOURCE_LIMIT || controller.signal.aborted)
        return undefined;
      transform = sharp(source, {
        limitInputPixels: 12_000_000,
        animated: false,
        failOn: "warning",
      })
        .autoOrient()
        .resize({ width: 1200, withoutEnlargement: true })
        .png()
        .timeout({ seconds: 3 });
      const content = await transform.toBuffer();
      return !controller.signal.aborted && content.length <= 1024 * 1024
        ? content
        : undefined;
    } catch {
      return undefined;
    } finally {
      transform?.destroy();
    }
  };
  try {
    return await Promise.race([convert(), deadline]);
  } finally {
    clearTimeout(timer!);
  }
}
