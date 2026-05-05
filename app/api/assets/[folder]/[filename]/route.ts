import { promises as fs } from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { assetUrlToPath } from "@/lib/runtime-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const allowedFolders = new Set(["uploads", "generated"]);

function contentTypeFor(filename: string) {
  const ext = path.extname(filename).toLowerCase();
  if (ext === ".mp4") return "video/mp4";
  if (ext === ".webm") return "video/webm";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".wav") return "audio/wav";
  if (ext === ".m4a") return "audio/mp4";
  return "application/octet-stream";
}

function parseRange(rangeHeader: string | null, fileSize: number) {
  if (!rangeHeader) {
    return null;
  }

  const match = rangeHeader.match(/^bytes=(\d*)-(\d*)$/);
  if (!match) {
    return null;
  }

  const startText = match[1];
  const endText = match[2];
  const start = startText ? Number(startText) : 0;
  const end = endText ? Number(endText) : fileSize - 1;

  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start < 0 || end >= fileSize) {
    return null;
  }

  return { start, end };
}

async function resolveAsset(
  folder: string,
  filename: string,
) {
  if (!allowedFolders.has(folder) || filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
    return null;
  }

  const filePath = assetUrlToPath(`/api/assets/${folder}/${filename}`);
  if (!filePath) {
    return null;
  }

  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile() || stat.size === 0) {
      return null;
    }
    return { filePath, stat };
  } catch {
    return null;
  }
}

export async function HEAD(
  _request: Request,
  { params }: { params: Promise<{ folder: string; filename: string }> },
) {
  const { folder, filename } = await params;
  const asset = await resolveAsset(folder, filename);
  if (!asset) {
    return NextResponse.json({ error: "Asset not found." }, { status: 404 });
  }

  return new NextResponse(null, {
    headers: {
      "Accept-Ranges": "bytes",
      "Content-Length": String(asset.stat.size),
      "Content-Type": contentTypeFor(filename),
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ folder: string; filename: string }> },
) {
  const { folder, filename } = await params;
  const asset = await resolveAsset(folder, filename);
  if (!asset) {
    return NextResponse.json({ error: "Asset not found." }, { status: 404 });
  }

  try {
    const range = parseRange(request.headers.get("range"), asset.stat.size);
    if (range) {
      const handle = await fs.open(asset.filePath, "r");
      try {
        const length = range.end - range.start + 1;
        const buffer = Buffer.alloc(length);
        await handle.read(buffer, 0, length, range.start);
        return new NextResponse(buffer, {
          status: 206,
          headers: {
            "Accept-Ranges": "bytes",
            "Content-Length": String(length),
            "Content-Range": `bytes ${range.start}-${range.end}/${asset.stat.size}`,
            "Content-Type": contentTypeFor(filename),
            "Cache-Control": "public, max-age=31536000, immutable",
          },
        });
      } finally {
        await handle.close();
      }
    }

    const file = await fs.readFile(asset.filePath);
    return new NextResponse(file, {
      headers: {
        "Accept-Ranges": "bytes",
        "Content-Length": String(asset.stat.size),
        "Content-Type": contentTypeFor(filename),
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return NextResponse.json({ error: "Asset not found." }, { status: 404 });
  }
}
