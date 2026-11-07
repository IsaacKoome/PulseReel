import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";
import { storeGeneratedMedia } from "./media-storage.ts";

function run(args: string[], tolerateFailure = false): Promise<string> {
  const binary = ffmpegPath;
  if (!binary) return Promise.reject(new Error("Thumbnail decoder is unavailable."));
  return new Promise((resolve, reject) => {
    execFile(binary, args, { timeout: 8_000, maxBuffer: 1_000_000, windowsHide: true }, (error, _stdout, stderr) => {
      if (error && !tolerateFailure) reject(error);
      else resolve(String(stderr));
    });
  });
}

export function thumbnailTime(duration: number) {
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("Invalid movie duration.");
  return Math.min(Math.max(duration * 0.25, 0.35), Math.max(duration - 0.1, 0));
}

// Work on downloaded bytes, never a URL passed directly to the decoder.
export async function extractMovieThumbnail(bytes: Uint8Array): Promise<Buffer> {
  if (!bytes.length || bytes.length > 200_000_000) throw new Error("Movie exceeds thumbnail processing bounds.");
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "mimireel-thumbnail-"));
  try {
    const input = path.join(directory, "movie.mp4");
    const output = path.join(directory, "thumbnail.jpg");
    await fs.writeFile(input, bytes);
    const metadata = await run(["-nostdin", "-hide_banner", "-protocol_whitelist", "file,pipe", "-i", input], true);
    const match = metadata.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/);
    if (!match) throw new Error("Movie duration could not be read.");
    const duration = +match[1] * 3600 + +match[2] * 60 + +match[3];
    await run(["-nostdin", "-hide_banner", "-loglevel", "error", "-protocol_whitelist", "file,pipe", "-ss", String(thumbnailTime(duration)), "-i", input,
      "-frames:v", "1", "-vf", "scale=480:480:force_original_aspect_ratio=decrease", "-q:v", "4", "-y", output]);
    const jpeg = await fs.readFile(output);
    if (jpeg.length > 500_000 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw new Error("Invalid thumbnail output.");
    return jpeg;
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
}

export async function storeMovieThumbnail(id: string, videoUrl: string, bytes: Uint8Array) {
  const jpeg = await extractMovieThumbnail(bytes);
  return storeThumbnailImage(id, videoUrl, jpeg);
}

export async function storeThumbnailImage(id: string, videoUrl: string, jpeg: Buffer) {
  if (!jpeg.length || jpeg.length > 500_000 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw new Error("Invalid thumbnail JPEG.");
  const digest = createHash("sha256").update(jpeg).digest("hex").slice(0, 20);
  const safeId = id.replace(/[^a-zA-Z0-9_-]/g, "_");
  const stored = await storeGeneratedMedia(`pulsereel/thumbnails/${safeId}/v1-${digest}.jpg`, jpeg, "image/jpeg");
  return { thumbnailUrl: stored.url, thumbnailVideoUrl: videoUrl };
}
