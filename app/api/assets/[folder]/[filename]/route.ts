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

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ folder: string; filename: string }> },
) {
  const { folder, filename } = await params;
  if (!allowedFolders.has(folder) || filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
    return NextResponse.json({ error: "Asset not found." }, { status: 404 });
  }

  const filePath = assetUrlToPath(`/api/assets/${folder}/${filename}`);
  if (!filePath) {
    return NextResponse.json({ error: "Asset not found." }, { status: 404 });
  }

  try {
    const file = await fs.readFile(filePath);
    return new NextResponse(file, {
      headers: {
        "Content-Type": contentTypeFor(filename),
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return NextResponse.json({ error: "Asset not found." }, { status: 404 });
  }
}
