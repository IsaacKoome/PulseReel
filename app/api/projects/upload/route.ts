import { NextResponse } from "next/server";
import { head } from "@vercel/blob";
import { z } from "zod";
import { v5 as uuidv5 } from "uuid";
import { getRequestUser } from "@/lib/auth/request-user";
import { addProject, getProjectById, getProjects } from "@/lib/store";
import { storeGeneratedMedia } from "@/lib/media-storage";
import { extractMovieThumbnail, storeThumbnailImage } from "@/lib/movie-thumbnail";
import { hasMp4Video, makeMp4Streamable } from "@/lib/mp4-faststart";
import { MAX_PUBLISHED_UPLOAD_BYTES, uploadedMovie, validateUploadedMovieSource } from "@/lib/uploaded-movie";

export const runtime = "nodejs";
export const maxDuration = 60;
const schema = z.object({ videoBlobUrl: z.string().url().max(2048), title: z.string().trim().min(1).max(80), caption: z.string().trim().max(500).default(""), rightsConfirmed: z.literal(true) });
const pending = new Map<string, Promise<ReturnType<typeof uploadedMovie>>>();

export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Sign in before uploading a video." }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Add a title and confirm that you have permission to share this video." }, { status: 400 });
  try {
    // Blob HEAD is authoritative for this store/path, not client-supplied MIME/size.
    const metadata = await head(parsed.data.videoBlobUrl);
    const uploadId = validateUploadedMovieSource(metadata, user.id);
    const id = uuidv5(`mimireel-upload:${user.id}:${uploadId}`, uuidv5.URL);
    const existing = await getProjectById(id);
    if (existing && (existing.ownerId !== user.id || existing.origin !== "uploaded")) {
      return NextResponse.json({ error: "Upload identifier is already in use." }, { status: 409 });
    }
    let project = existing;
    if (!project) {
      const recent = (await getProjects()).filter((p) => p.ownerId === user.id && p.origin === "uploaded" && Date.now() - Date.parse(p.createdAt) < 86_400_000);
      if (recent.length >= 5) return NextResponse.json({ error: "You can add up to five uploaded videos per day. Please try again tomorrow." }, { status: 429 });
      let job = pending.get(id);
      if (!job) {
        job = (async () => {
          const response = await fetch(metadata.url, { redirect: "error", signal: AbortSignal.timeout(25_000) });
          if (!response.ok || !response.body) throw new Error("The uploaded video could not be read.");
          const chunks: Uint8Array[] = []; let size = 0;
          for await (const chunk of response.body) {
            size += chunk.byteLength;
            if (size > MAX_PUBLISHED_UPLOAD_BYTES) throw new Error("Video exceeds 100 MB.");
            chunks.push(chunk);
          }
          const bytes = Buffer.concat(chunks);
          if (!hasMp4Video(bytes)) throw new Error("Please choose an MP4 with a video track.");
          const movie = makeMp4Streamable(bytes);
          const stored = await storeGeneratedMedia(`pulsereel/uploads/${user.id}/${id}.mp4`, movie, "video/mp4");
          let thumbnailUrl = "";
          try {
            const jpeg = await extractMovieThumbnail(movie);
            thumbnailUrl = (await storeThumbnailImage(id, stored.url, jpeg)).thumbnailUrl;
          } catch (error) {
            console.warn("Upload saved without thumbnail.", error instanceof Error ? error.message : "Thumbnail error");
          }
          const next = uploadedMovie({ id, ownerId: user.id, creatorName: String(user.user_metadata?.full_name || "Creator").slice(0, 80),
            title: parsed.data.title, caption: parsed.data.caption, videoUrl: stored.url, thumbnailUrl });
          await addProject(next);
          return next;
        })();
        pending.set(id, job);
      }
      try { project = await job; } finally { pending.delete(id); }
    }
    const { ownerId: _ownerId, deleteTokenHash: _deleteTokenHash, ...safe } = project;
    return NextResponse.json({ project: { ...safe, viewer: { owns: true, liked: false, following: false } }, slug: project.slug });
  } catch (error) {
    console.warn("Uploaded movie could not be saved.", error instanceof Error ? error.message : "Upload error");
    return NextResponse.json({ error: "The video could not be saved. Use a valid MP4 up to 100 MB, then try again. No AI attempt was used." }, { status: 400 });
  }
}
