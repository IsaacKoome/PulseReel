import { randomUUID } from "expo-crypto";
import type { BillingStatus, GenerationAccess, MovieComment, MovieProject } from "@/types";
import { fetch } from "expo/fetch";
import { File } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";

export const API_URL = (process.env.EXPO_PUBLIC_API_URL || "https://pulse-reel.vercel.app").replace(/\/$/, "");

export class PulseReelApiError extends Error {
  constructor(message: string, readonly code?: string, readonly status?: number) {
    super(message);
    this.name = "PulseReelApiError";
  }
}

async function readJson<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => ({}))) as T & { error?: string; code?: string };
  if (!response.ok) {
    throw new PulseReelApiError(
      body.error || (response.status === 413
        ? "This photo or clip is too large to upload. Choose a smaller file."
        : response.status === 504
          ? "The movie service took too long to respond. Check My movies before trying again."
          : `MimiReel could not complete that request (HTTP ${response.status}). Please try again later.`),
      body.code,
      response.status,
    );
  }
  return body;
}

function authHeaders(token?: string | null) {
  return token ? { Authorization: `Bearer ${token}` } : undefined;
}

export async function getMovies(scope: "feed" | "mine" | "following", token?: string | null) {
  const response = await fetch(`${API_URL}/api/projects?scope=${scope}&limit=30`, {
    headers: authHeaders(token),
  });
  return readJson<{ projects: MovieProject[] }>(response);
}

export async function setMovieLike(slug: string, liked: boolean, token: string) {
  const response = await fetch(`${API_URL}/api/projects/${encodeURIComponent(slug)}/like`, {
    method: liked ? "POST" : "DELETE",
    headers: authHeaders(token),
  });
  return readJson<{ liked: boolean; likes: number }>(response);
}

export async function setCreatorFollow(slug: string, following: boolean, token: string) {
  const response = await fetch(`${API_URL}/api/projects/${encodeURIComponent(slug)}/follow`, {
    method: following ? "POST" : "DELETE",
    headers: authHeaders(token),
  });
  return readJson<{ following: boolean }>(response);
}

export async function getMovieComments(slug: string) {
  const response = await fetch(`${API_URL}/api/projects/${encodeURIComponent(slug)}/comments`);
  return readJson<{ comments: MovieComment[]; count: number }>(response);
}

export async function postMovieComment(slug: string, body: string, token: string) {
  const response = await fetch(`${API_URL}/api/projects/${encodeURIComponent(slug)}/comments`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ body }),
  });
  return readJson<{ comment: MovieComment }>(response);
}

export type SafetyReportReason =
  | "inappropriate"
  | "harassment"
  | "sexual_content"
  | "violence"
  | "misleading"
  | "other";

export async function reportMovie(
  slug: string,
  token: string,
  reason: SafetyReportReason = "inappropriate",
) {
  const response = await fetch(`${API_URL}/api/projects/${encodeURIComponent(slug)}/report`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ reason }),
  });
  return readJson<{ reported: boolean }>(response);
}

export async function setCreatorBlocked(slug: string, blocked: boolean, token: string) {
  const response = await fetch(`${API_URL}/api/projects/${encodeURIComponent(slug)}/block`, {
    method: blocked ? "POST" : "DELETE",
    headers: authHeaders(token),
  });
  return readJson<{ blocked: boolean }>(response);
}

export async function reportMovieComment(
  slug: string,
  commentId: string,
  token: string,
  reason: SafetyReportReason = "inappropriate",
) {
  const response = await fetch(
    `${API_URL}/api/projects/${encodeURIComponent(slug)}/comments/${encodeURIComponent(commentId)}/report`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ reason }),
    },
  );
  return readJson<{ reported: boolean }>(response);
}

export async function requestAccountDeletion(token: string) {
  const response = await fetch(`${API_URL}/api/account/deletion`, {
    method: "POST",
    headers: authHeaders(token),
  });
  return readJson<{ status: string }>(response);
}

export async function recordMovieShare(slug: string, token?: string | null) {
  const response = await fetch(`${API_URL}/api/projects/${encodeURIComponent(slug)}/share`, {
    method: "POST",
    headers: authHeaders(token),
  });
  return readJson<{ tracked: boolean; shares?: number }>(response);
}

export async function getMovie(slug: string, token?: string) {
  const response = await fetch(`${API_URL}/api/projects/${encodeURIComponent(slug)}/status`, { headers: authHeaders(token) });
  return readJson<MovieProject>(response);
}

export async function getGenerationAccess(token: string) {
  const response = await fetch(`${API_URL}/api/beta/status`, {
    headers: authHeaders(token),
  });
  return readJson<GenerationAccess>(response);
}

export async function setMovieVisibility(
  slug: string,
  visibility: "public" | "unlisted",
  token: string,
) {
  const response = await fetch(`${API_URL}/api/projects/${encodeURIComponent(slug)}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ visibility }),
  });
  return readJson<{ project: MovieProject }>(response);
}

type LocalAsset = {
  uri: string;
  mimeType?: string | null;
  fileName?: string | null;
  fileSize?: number;
  uploadDirectly?: boolean;
};

function nativeUpload(asset: LocalAsset) {
  return new File(asset.uri);
}

async function prepareIdentityPhoto(asset: LocalAsset) {
  // Keep the image plus a recorded 2.8 MB clip below the API request limit.
  // Re-encoding also gives gallery PNG/HEIC files a reliable JPEG MIME type.
  for (const width of [1600, 1200, 800]) {
    const context = ImageManipulator.manipulate(asset.uri);
    try {
      context.resize({ width, height: null });
      const image = await context.renderAsync();
      try {
        const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.75 });
        const file = new File(saved.uri);
        if (file.size > 0 && file.size <= 1_000_000) return file;
        file.delete();
      } finally {
        image.release();
      }
    } finally {
      context.release();
    }
  }
  throw new PulseReelApiError("This photo could not be prepared for upload. Please choose a different photo.");
}

async function uploadSourceVideo(asset: LocalAsset, ownerId: string, token: string) {
  const file = nativeUpload(asset);
  const extension = asset.fileName?.match(/\.[a-z0-9]{1,8}$/i)?.[0]?.toLowerCase()
    ?? (asset.mimeType?.includes("mp4") ? ".mp4" : ".mov");
  const pathname = `pulsereel/source/${ownerId}/${randomUUID()}${extension}`;
  const contentType = asset.mimeType || file.type || "video/mp4";
  const authorization = await fetch(`${API_URL}/api/uploads/mobile`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ pathname, contentType, size: file.size }),
  });
  const { uploadUrl } = await readJson<{ uploadUrl: string }>(authorization);
  const uploadResponse = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: file,
  });
  const blob = await readJson<{ url: string }>(uploadResponse);
  return blob.url;
}

export async function getBillingStatus(token: string) {
  const response = await fetch(`${API_URL}/api/billing`, { headers: authHeaders(token) });
  return readJson<BillingStatus>(response);
}

export async function startBillingCheckout(token: string) {
  const response = await fetch(`${API_URL}/api/billing`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ action: "initialize", client: "mobile" }),
  });
  return readJson<{ url: string }>(response);
}

export async function createMovie(input: {
  clip: LocalAsset & { kind: "image" | "video" };
  identity: LocalAsset;
  prompt: string;
  token: string;
  ownerId: string;
}) {
  const form = new FormData();
  let preparedIdentity: File;
  try { preparedIdentity = await prepareIdentityPhoto(input.identity); }
  catch { throw new PulseReelApiError("This photo could not be decoded. Choose a different gallery photo, a screenshot, or another video frame. No generation has started."); }
  if (input.clip.kind === "image") {
    form.append("sourceType", "image");
  } else if (input.clip.uploadDirectly) {
    form.append("videoBlobUrl", await uploadSourceVideo(input.clip, input.ownerId, input.token));
  } else {
    form.append("video", nativeUpload(input.clip));
  }
  form.append("selfie", preparedIdentity);
  form.append("quickPrompt", input.prompt);
  form.append("templateId", "identity-cinematic");
  form.append("cameraMode", "cinematic");
  form.append("renderMode", "heavy-worker-beta");
  form.append(
    "heavyProvider",
    process.env.EXPO_PUBLIC_HEAVY_PROVIDER || "replicate-seedance-1.5-pro",
  );

  const response = await fetch(`${API_URL}/api/projects`, {
    method: "POST",
    headers: { Authorization: `Bearer ${input.token}` },
    body: form,
  });
  return readJson<{ slug: string; status: MovieProject["status"]; project: MovieProject }>(response);
}
