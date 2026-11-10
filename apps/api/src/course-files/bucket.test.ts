import {
  CreateBucketCommand,
  HeadBucketCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import { describe, expect, it, vi } from "vitest";
import { ensureStorageBucket } from "./bucket.js";

const missing = Object.assign(new Error("missing"), {
  $metadata: { httpStatusCode: 404 },
});

describe("object storage bucket startup", () => {
  it("creates a missing bucket only for local SeaweedFS", async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(missing)
      .mockResolvedValueOnce({});
    await ensureStorageBucket(
      { send } as unknown as S3Client,
      "course-files",
      true,
    );
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(HeadBucketCommand);
    expect(send.mock.calls[1]?.[0]).toBeInstanceOf(CreateBucketCommand);
  });

  it("refuses to create a missing managed bucket", async () => {
    const send = vi.fn().mockRejectedValue(missing);
    await expect(
      ensureStorageBucket(
        { send } as unknown as S3Client,
        "course-files",
        false,
      ),
    ).rejects.toThrow(
      "SUPABASE_STORAGE_BUCKET course-files must exist before startup",
    );
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(HeadBucketCommand);
  });

  it("propagates other bucket access failures", async () => {
    const denied = Object.assign(new Error("denied"), {
      $metadata: { httpStatusCode: 403 },
    });
    const send = vi.fn().mockRejectedValue(denied);
    await expect(
      ensureStorageBucket(
        { send } as unknown as S3Client,
        "course-files",
        false,
      ),
    ).rejects.toBe(denied);
    expect(send).toHaveBeenCalledTimes(1);
  });
});
