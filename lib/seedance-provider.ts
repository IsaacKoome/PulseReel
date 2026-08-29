import { promises as fs } from "fs";
import path from "path";
import { experimental_generateVideo } from "ai";
import { createGateway } from "@ai-sdk/gateway";
import { put } from "@vercel/blob";
import { createMovieProjectDraft } from "@/lib/pipeline";
import { assetUrlToPath, getRuntimeAssetDir, runtimeAssetUrl } from "@/lib/runtime-storage";
import type { CameraMode, MovieProject } from "@/lib/types";

const DEFAULT_MODEL = "bytedance/seedance-2.0-fast";
const DEFAULT_DURATION_SECONDS = 5;

function seedancePrompt(project: MovieProject) {
  const cameraDirection = project.cameraMode === "selfie"
    ? "Use a front-facing handheld selfie viewpoint: the creator stays recognizable in the foreground while revealing the requested world behind them."
    : "Use a separate cinematic camera in a medium or wide composition. This is not a selfie, vlog, phone recording, or outstretched-arm shot.";
  return [
    `Scene requested by the user: ${project.premise}`,
    "Create one continuous vertical cinematic live-action shot, not a montage or trailer.",
    cameraDirection,
    "IDENTITY LOCK: the real person in the supplied image is the non-negotiable main character.",
    "Keep their exact facial structure, skin tone, hair, age, body proportions, and distinguishing features for the entire shot; never substitute a different actor.",
    "Keep the creator clearly visible and place that same person naturally inside the requested setting performing the requested action.",
    "Make the world feel real, with believable lighting, camera movement, foreground/background depth, and natural motion.",
    "No identity drift, face morphing, duplicate creator, text overlays, subtitles, logos, or watermarks.",
  ].join(" ");
}

async function readReferenceImage(project: MovieProject) {
  const imagePath = assetUrlToPath(project.sourceImageUrl);
  if (!imagePath) {
    return undefined;
  }

  try {
    return await fs.readFile(imagePath);
  } catch {
    return undefined;
  }
}

async function saveGeneratedVideo(bytes: Uint8Array, filename: string, contentType: string) {
  if (process.env.BLOB_READ_WRITE_TOKEN?.trim()) {
    const blob = await put(`pulsereel/${filename}`, new Blob([Buffer.from(bytes)], { type: contentType }), {
      access: "public",
      contentType,
    });
    return blob.url;
  }

  const generatedDir = getRuntimeAssetDir("generated");
  await fs.mkdir(generatedDir, { recursive: true });
  await fs.writeFile(path.join(generatedDir, filename), Buffer.from(bytes));
  return runtimeAssetUrl("generated", filename);
}

export async function createSeedanceProject(input: {
  creatorName: string;
  title: string;
  templateId: string;
  genre: string;
  premise: string;
  scenePrompt: string;
  persona: string;
  cameraMode: CameraMode;
  sourceVideoUrl: string;
  sourceImageUrl?: string;
}) {
  const apiKey = process.env.AI_GATEWAY_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("Seedance needs AI_GATEWAY_API_KEY in Vercel environment variables.");
  }

  const project = await createMovieProjectDraft({
    ...input,
    renderMode: "seedance-2-fast",
    status: "processing",
  });

  const gateway = createGateway({ apiKey });
  const referenceImage = await readReferenceImage(project);
  if (!referenceImage) {
    throw new Error(
      "Identity-first generation stopped before model billing because PulseReel could not prepare a creator frame from the uploaded clip.",
    );
  }
  const promptText = seedancePrompt(project);

  const result = await experimental_generateVideo({
    model: gateway.videoModel(process.env.PULSEREEL_SEEDANCE_MODEL || DEFAULT_MODEL),
    prompt: {
      image: referenceImage,
      text: promptText,
    },
    aspectRatio: "9:16",
    duration: Number(process.env.PULSEREEL_SEEDANCE_DURATION_SECONDS || DEFAULT_DURATION_SECONDS),
    maxRetries: 1,
  });

  const mediaType = result.video.mediaType || "video/mp4";
  const filename = `${project.id}-seedance.mp4`;
  const processedVideoUrl = await saveGeneratedVideo(result.video.uint8Array, filename, mediaType);

  return {
    ...project,
    status: "published" as const,
    processedVideoUrl,
    updatedAt: new Date().toISOString(),
  };
}
