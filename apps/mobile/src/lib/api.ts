import type { GenerationAccess, MovieProject } from "@/types";

export const API_URL = (process.env.EXPO_PUBLIC_API_URL || "https://pulse-reel.vercel.app").replace(/\/$/, "");

async function readJson<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) {
    throw new Error(body.error || "PulseReel could not complete that request.");
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

type LocalAsset = { uri: string; mimeType?: string | null; fileName?: string | null };

function nativeUpload(asset: LocalAsset, fallbackName: string, fallbackType: string) {
  return {
    uri: asset.uri,
    name: asset.fileName || fallbackName,
    type: asset.mimeType || fallbackType,
  } as unknown as Blob;
}

export async function createMovie(input: {
  clip: LocalAsset;
  identity: LocalAsset;
  prompt: string;
  token: string;
}) {
  const form = new FormData();
  form.append("video", nativeUpload(input.clip, "pulsereel-clip.mp4", "video/mp4"));
  form.append("selfie", nativeUpload(input.identity, "pulsereel-identity.jpg", "image/jpeg"));
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
