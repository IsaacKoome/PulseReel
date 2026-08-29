import crypto from "node:crypto";
import { del, put } from "@vercel/blob";
import sharp from "sharp";
import { syncGenerationReservationForProject } from "@/lib/generation-access";
import { createMovieProjectDraft } from "@/lib/pipeline";
import { addProject, getProjectById, updateProject } from "@/lib/store";
import type { CameraMode, MovieProject, RenderMode } from "@/lib/types";
import {
  buildDirectSeedanceInput,
  findReplicateOutputUrl,
} from "@/lib/replicate-direct-input";

export const DIRECT_SEEDANCE_PROVIDER = "replicate-seedance-1.5-pro" as const;
export const DIRECT_SEEDANCE_MODEL = "bytedance/seedance-1.5-pro";

type ReplicatePredictionStatus =
  | "starting"
  | "processing"
  | "succeeded"
  | "failed"
  | "canceled";

export type ReplicatePrediction = {
  id: string;
  status: ReplicatePredictionStatus;
  output?: unknown;
  error?: unknown;
  urls?: {
    get?: string;
    web?: string;
  };
};

type DirectSeedanceProjectInput = {
  creatorName: string;
  title: string;
  templateId: string;
  genre: string;
  premise: string;
  scenePrompt: string;
  persona: string;
  cameraMode: CameraMode;
  renderMode: Exclude<RenderMode, "seedance-2-fast">;
  sourceVideoUrl: string;
  identityImage: File;
  ownerId?: string;
  visibility?: "public" | "unlisted";
  deleteTokenHash?: string;
  requestOrigin: string;
};

let cachedWebhookSecret: string | null = null;

function replicateToken() {
  const token = process.env.PULSEREEL_REPLICATE_API_TOKEN?.trim();
  if (!token) {
    throw new Error("Direct Seedance generation needs PULSEREEL_REPLICATE_API_TOKEN on Vercel.");
  }
  return token;
}

function requireBlobStorage() {
  if (!process.env.BLOB_READ_WRITE_TOKEN?.trim()) {
    throw new Error("Direct Seedance generation needs BLOB_READ_WRITE_TOKEN for durable identity and movie files.");
  }
}

function publicAppOrigin(requestOrigin: string) {
  const configured = process.env.PULSEREEL_PUBLIC_BASE_URL?.trim();
  return (configured || requestOrigin).replace(/\/$/, "");
}

async function portraitIdentityBuffer(file: File) {
  const input = Buffer.from(await file.arrayBuffer());
  const background = await sharp(input)
    .rotate()
    .resize(480, 832, { fit: "cover" })
    .blur(18)
    .jpeg({ quality: 84 })
    .toBuffer();
  const foreground = await sharp(input)
    .rotate()
    .resize(480, 832, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();

  const portrait = await sharp(background)
    .composite([{ input: foreground, gravity: "center" }])
    .jpeg({ quality: 84 })
    .toBuffer();
  if (portrait.byteLength <= 240_000) return portrait;
  return sharp(portrait).jpeg({ quality: 70 }).toBuffer();
}

async function createPrediction(project: MovieProject, identityImageUrl: string, requestOrigin: string) {
  const webhook = new URL("/api/webhooks/replicate", publicAppOrigin(requestOrigin));
  webhook.searchParams.set("projectId", project.id);

  const response = await fetch(
    `https://api.replicate.com/v1/models/${DIRECT_SEEDANCE_MODEL}/predictions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${replicateToken()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input: buildDirectSeedanceInput(project, identityImageUrl),
        webhook: webhook.toString(),
        webhook_events_filter: ["completed"],
      }),
    },
  );
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Replicate rejected the Seedance job (${response.status}): ${text.slice(0, 500)}`);
  }

  const prediction = JSON.parse(text) as ReplicatePrediction;
  if (!prediction.id) {
    throw new Error("Replicate accepted the request but returned no prediction ID.");
  }
  return prediction;
}

export async function createDirectSeedanceProject(input: DirectSeedanceProjectInput) {
  requireBlobStorage();
  replicateToken();

  const project = await createMovieProjectDraft({
    creatorName: input.creatorName,
    title: input.title,
    templateId: input.templateId,
    genre: input.genre,
    premise: input.premise,
    scenePrompt: input.scenePrompt,
    persona: input.persona,
    cameraMode: input.cameraMode,
    renderMode: input.renderMode,
    sourceVideoUrl: input.sourceVideoUrl,
    status: "processing",
  });
  const identityBuffer = await portraitIdentityBuffer(input.identityImage);
  const identityDataUrl = `data:image/jpeg;base64,${identityBuffer.toString("base64")}`;

  project.ownerId = input.ownerId;
  project.visibility = input.visibility;
  project.deleteTokenHash = input.deleteTokenHash;
  project.workerJob = {
    id: `replicate-${project.id}`,
    provider: DIRECT_SEEDANCE_PROVIDER,
    model: DIRECT_SEEDANCE_MODEL,
    status: "queued",
    progress: 8,
    stage: "Submitting directly to Replicate Seedance",
    executionMode: "direct-replicate",
  };
  await addProject(project);

  try {
    const prediction = await createPrediction(project, identityDataUrl, input.requestOrigin);
    const updated = await updateProject(project.id, (item) => {
      if (item.status === "published" || item.status === "failed") return item;
      return {
        ...item,
        status: "processing",
        updatedAt: new Date().toISOString(),
        workerJob: {
          id: item.workerJob?.id ?? `replicate-${item.id}`,
          provider: DIRECT_SEEDANCE_PROVIDER,
          model: DIRECT_SEEDANCE_MODEL,
          status: prediction.status === "processing" ? "running" : "queued",
          progress: prediction.status === "processing" ? 25 : 12,
          stage: prediction.status === "processing" ? "Seedance is generating the movie" : "Seedance job queued at Replicate",
          remoteJobId: prediction.id,
          remoteStatusUrl: prediction.urls?.get,
          executionMode: "direct-replicate",
          startedAt: new Date().toISOString(),
        },
      };
    });
    return updated ?? project;
  } catch (error) {
    await updateProject(project.id, (item) => ({
      ...item,
      status: "failed",
      updatedAt: new Date().toISOString(),
      workerJob: {
        ...item.workerJob!,
        status: "failed",
        progress: item.workerJob?.progress ?? 8,
        stage: "Direct Seedance submission failed",
        executionMode: "direct-replicate",
        completedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : "Direct Seedance submission failed.",
      },
    }));
    await cleanupSourceAssets(project);
    throw error;
  }
}

async function cleanupSourceAssets(project: MovieProject) {
  const candidates = [project.sourceVideoUrl].filter(
    (url): url is string => Boolean(url && url.includes(".blob.vercel-storage.com")),
  );
  await Promise.all(candidates.map((url) => del(url).catch(() => undefined)));
}

async function persistReplicateVideo(project: MovieProject, outputUrl: string) {
  requireBlobStorage();
  const response = await fetch(outputUrl);
  if (!response.ok) {
    throw new Error(`Replicate movie download failed (${response.status}).`);
  }
  const movie = await response.blob();
  const ownerPath = project.ownerId ?? "public";
  return put(`pulsereel/generated/${ownerPath}/${project.id}.mp4`, movie, {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "video/mp4",
    cacheControlMaxAge: 31_536_000,
  });
}

export async function applyReplicatePrediction(projectId: string, prediction: ReplicatePrediction) {
  const project = await getProjectById(projectId);
  if (!project || project.workerJob?.executionMode !== "direct-replicate") {
    return project;
  }
  if (project.workerJob.remoteJobId && project.workerJob.remoteJobId !== prediction.id) {
    throw new Error("Replicate prediction does not belong to this PulseReel project.");
  }
  if (project.status === "published" || project.status === "failed") {
    return project;
  }

  if (prediction.status === "succeeded") {
    const outputUrl = findReplicateOutputUrl(prediction.output);
    if (!outputUrl) {
      throw new Error("Replicate completed the Seedance job without a movie URL.");
    }
    const stored = await persistReplicateVideo(project, outputUrl);
    const updated = await updateProject(project.id, (item) => ({
      ...item,
      status: "published",
      processedVideoUrl: stored.url,
      updatedAt: new Date().toISOString(),
      workerJob: {
        ...item.workerJob!,
        provider: DIRECT_SEEDANCE_PROVIDER,
        providerUsed: DIRECT_SEEDANCE_PROVIDER,
        model: DIRECT_SEEDANCE_MODEL,
        status: "completed",
        progress: 100,
        stage: "Seedance movie ready",
        executionMode: "direct-replicate",
        completedAt: new Date().toISOString(),
        error: undefined,
      },
    }));
    await cleanupSourceAssets(project);
    await syncGenerationReservationForProject(project.id, "completed");
    return updated;
  }

  if (prediction.status === "failed" || prediction.status === "canceled") {
    const message = typeof prediction.error === "string"
      ? prediction.error
      : prediction.status === "canceled"
        ? "Replicate canceled the Seedance generation."
        : "Replicate failed to generate the Seedance movie.";
    const updated = await updateProject(project.id, (item) => ({
      ...item,
      status: "failed",
      updatedAt: new Date().toISOString(),
      workerJob: {
        ...item.workerJob!,
        status: "failed",
        progress: item.workerJob?.progress ?? 25,
        stage: "Seedance generation failed",
        executionMode: "direct-replicate",
        completedAt: new Date().toISOString(),
        error: message,
      },
    }));
    await cleanupSourceAssets(project);
    await syncGenerationReservationForProject(project.id, "failed");
    return updated;
  }

  return updateProject(project.id, (item) => ({
    ...item,
    status: "processing",
    updatedAt: new Date().toISOString(),
    workerJob: {
      ...item.workerJob!,
      status: prediction.status === "processing" ? "running" : "queued",
      progress: prediction.status === "processing" ? 45 : 18,
      stage: prediction.status === "processing" ? "Seedance is generating the movie" : "Waiting for Replicate",
      executionMode: "direct-replicate",
    },
  }));
}

export async function getReplicatePrediction(predictionId: string) {
  const response = await fetch(`https://api.replicate.com/v1/predictions/${encodeURIComponent(predictionId)}`, {
    headers: { Authorization: `Bearer ${replicateToken()}` },
    cache: "no-store",
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Could not read Replicate prediction ${predictionId} (${response.status}): ${text.slice(0, 300)}`);
  }
  return JSON.parse(text) as ReplicatePrediction;
}

export async function reconcileDirectReplicateProject(project: MovieProject) {
  const predictionId = project.workerJob?.remoteJobId;
  if (!predictionId || project.workerJob?.executionMode !== "direct-replicate") return project;
  return (await applyReplicatePrediction(project.id, await getReplicatePrediction(predictionId))) ?? project;
}

async function webhookSecret() {
  const configured = process.env.PULSEREEL_REPLICATE_WEBHOOK_SECRET?.trim();
  if (configured) return configured;
  if (cachedWebhookSecret) return cachedWebhookSecret;

  const response = await fetch("https://api.replicate.com/v1/webhooks/default/secret", {
    headers: { Authorization: `Bearer ${replicateToken()}` },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Could not retrieve the Replicate webhook signing secret (${response.status}).`);
  }
  const payload = (await response.json()) as { key?: string };
  if (!payload.key) throw new Error("Replicate returned no webhook signing secret.");
  cachedWebhookSecret = payload.key;
  return payload.key;
}

export async function verifyReplicateWebhook(headers: Headers, rawBody: string) {
  const id = headers.get("webhook-id");
  const timestamp = headers.get("webhook-timestamp");
  const signatures = headers.get("webhook-signature");
  if (!id || !timestamp || !signatures) return false;

  const timestampSeconds = Number(timestamp);
  if (!Number.isFinite(timestampSeconds) || Math.abs(Date.now() / 1000 - timestampSeconds) > 300) {
    return false;
  }

  const secret = await webhookSecret();
  const encodedKey = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  const expected = crypto
    .createHmac("sha256", Buffer.from(encodedKey, "base64"))
    .update(`${id}.${timestamp}.${rawBody}`)
    .digest();

  return signatures.split(" ").some((signature) => {
    const encoded = signature.startsWith("v1,") ? signature.slice(3) : "";
    if (!encoded) return false;
    const received = Buffer.from(encoded, "base64");
    return received.length === expected.length && crypto.timingSafeEqual(received, expected);
  });
}
