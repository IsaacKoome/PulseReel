import { put } from "@vercel/blob";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

// Explicit opt-in: missing credentials must never silently switch providers.
export async function storeGeneratedMedia(key: string, bytes: Uint8Array, contentType: string) {
  if (process.env.MIMIREEL_MEDIA_STORAGE !== "r2") {
    return put(key, Buffer.from(bytes), {
      access: "public", addRandomSuffix: false, allowOverwrite: true,
      contentType, cacheControlMaxAge: 31_536_000,
    });
  }
  const accountId = process.env.R2_ACCOUNT_ID?.trim();
  const bucket = process.env.R2_BUCKET?.trim();
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();
  const publicBase = process.env.R2_PUBLIC_BASE_URL?.trim().replace(/\/$/, "");
  if (!accountId || !bucket || !accessKeyId || !secretAccessKey || !publicBase) {
    throw new Error("R2 media storage is enabled but its configuration is incomplete.");
  }
  const base = new URL(publicBase);
  if (base.protocol !== "https:") throw new Error("R2 public media URL must use HTTPS.");
  const client = new S3Client({
    region: "auto", endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
  try {
    await client.send(new PutObjectCommand({
      Bucket: bucket, Key: key, Body: Buffer.from(bytes), ContentType: contentType,
      CacheControl: "public, max-age=31536000, immutable",
    }));
  } finally { client.destroy(); }
  return { url: `${publicBase}/${key.split("/").map(encodeURIComponent).join("/")}` };
}
