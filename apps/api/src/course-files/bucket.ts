import {
  CreateBucketCommand,
  HeadBucketCommand,
  type S3Client,
} from "@aws-sdk/client-s3";

export async function ensureStorageBucket(
  client: S3Client,
  bucket: string,
  localFileStore: boolean,
): Promise<void> {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch (error) {
    if (
      typeof error !== "object" ||
      error === null ||
      !("$metadata" in error) ||
      (error.$metadata as { httpStatusCode?: number }).httpStatusCode !== 404
    )
      throw new Error(
        "Object storage bucket is inaccessible; check endpoint, credentials and permissions",
      );
    if (!localFileStore)
      throw new Error(
        `SUPABASE_STORAGE_BUCKET ${bucket} must exist before startup`,
      );
    try {
      await client.send(new CreateBucketCommand({ Bucket: bucket }));
    } catch {
      throw new Error("Bundled object storage bucket preparation failed");
    }
  }
}
