import { randomUUID } from "expo-crypto";
import type { BillingStatus, GenerationAccess, MovieProject } from "@/types";
import { fetch } from "expo/fetch";
import { File } from "expo-file-system";

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
      body.error || "PulseReel could not complete that request.",
      body.code,
      response.status,
    );
  }
  return body;
}

function authHeaders(token?: string | null) {
  return token ? { Authorization: `Bearer ${token}` } : undefined;
}

export async function getMovies(scope: "feed" | "mine", token?: string | null) {
  const response = await fetch(`${API_URL}/api/projects?scope=${scope}&limit=30`, {
    headers: authHeaders(token),
  });
  return readJson<{ projects: MovieProject[] }>(response);
}

export async function getMovie(slug: string) {
  const response = await fetch(`${API_URL}/api/projects/${encodeURIComponent(slug)}/status`);
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
  clip: LocalAsset;
  identity: LocalAsset;
  prompt: string;
  token: string;
  ownerId: string;
}) {
  const form = new FormData();
  if (input.clip.uploadDirectly) {
    form.append("videoBlobUrl", await uploadSourceVideo(input.clip, input.ownerId, input.token));
  } else {
    form.append("video", nativeUpload(input.clip));
  }
  form.append("selfie", nativeUpload(input.identity));
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
