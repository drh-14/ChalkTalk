import { createWriteStream, promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import Busboy from "busboy";
import type { Request } from "express";
import { AuthError } from "../auth/errors.js";
import { MAX_UPLOAD_BYTES } from "./validate.js";
import type { NewUpload } from "./service.js";

export async function readMultipart(request: Request): Promise<NewUpload> {
  if (!request.headers["content-type"]?.startsWith("multipart/form-data"))
    throw new AuthError(
      415,
      "unsupported_media_type",
      "Multipart upload is required",
    );
  const directory = await fs.mkdtemp(join(tmpdir(), "chalktalk-upload-"));
  const filePath = join(directory, "file");
  let file: { fileName: string; declaredType: string } | undefined;
  let failed: Error | undefined;
  let handedOff = false;
  let parser: ReturnType<typeof Busboy> | undefined;
  const writes: Promise<void>[] = [];
  try {
    parser = Busboy({
      headers: request.headers,
      limits: { fileSize: MAX_UPLOAD_BYTES + 1, files: 2, fields: 1, parts: 2 },
    });
    const activeParser = parser;
    parser.on("field", () => {
      failed = new AuthError(
        422,
        "validation_failed",
        "Only one file part is permitted",
      );
    });
    parser.on("file", (name, stream, info) => {
      if (name !== "file" || file) {
        failed = new AuthError(
          422,
          "validation_failed",
          "Exactly one file is required",
        );
        stream.resume();
        return;
      }
      file = { fileName: info.filename ?? "", declaredType: info.mimeType };
      stream.on("limit", () => {
        failed = new AuthError(
          413,
          "payload_too_large",
          "Upload exceeds 100 MiB",
        );
      });
      writes.push(
        pipeline(stream, createWriteStream(filePath)).catch((error: Error) => {
          failed = error;
        }),
      );
    });
    for (const event of ["filesLimit", "fieldsLimit", "partsLimit"])
      parser.on(event, () => {
        failed = new AuthError(
          422,
          "validation_failed",
          "Exactly one file is required",
        );
      });
    const parsed = new Promise<void>((resolve, reject) => {
      activeParser.on("close", resolve);
      activeParser.on("error", reject);
      request.on("error", reject);
      request.on("aborted", () => reject(new Error("Upload aborted")));
    });
    request.pipe(parser);
    await parsed;
    await Promise.all(writes);
    if (failed) throw failed;
    if (!file)
      throw new AuthError(
        422,
        "validation_failed",
        "Exactly one file is required",
      );
    const { size } = await fs.stat(filePath);
    if (size > MAX_UPLOAD_BYTES)
      throw new AuthError(413, "payload_too_large", "Upload exceeds 100 MiB");
    handedOff = true;
    return {
      fileName: file.fileName,
      declaredType: file.declaredType,
      filePath,
      sizeBytes: size,
      cleanup: () => fs.rm(directory, { recursive: true, force: true }),
    };
  } catch (error) {
    if (parser) {
      request.unpipe(parser);
      parser.destroy();
    }
    await Promise.allSettled(writes);
    if (error instanceof AuthError) throw error;
    throw new AuthError(400, "invalid_request", "Multipart upload is invalid");
  } finally {
    if (!handedOff) await fs.rm(directory, { recursive: true, force: true });
  }
}
