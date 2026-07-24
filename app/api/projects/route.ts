import { NextResponse } from "next/server";
import { z } from "zod";
import { createHeavyProject, enqueueHeavyGeneration } from "@/lib/heavy-worker";
import { createMovieProject, saveSourceAssets } from "@/lib/pipeline";
import { isVercelRuntime } from "@/lib/runtime-storage";
import { createSeedanceProject } from "@/lib/seedance-provider";
import { addProject, getProjectById, getProjects } from "@/lib/store";
import type { HeavyRenderProviderId } from "@/lib/types";
import {
  estimatedGenerationCostUsd,
  getEffectiveCreatorBetaConfig,
  isManagedProject,
  isValidCreatorAccessCode,
} from "@/lib/creator-beta";

export const runtime = "nodejs";
export const maxDuration = 60;

const schema = z.object({
  creatorName: z.string().min(1),
  title: z.string().min(1),
  templateId: z.string().min(1),
  genre: z.string().min(1),
  premise: z.string().min(10),
  scenePrompt: z.string().min(10),
  persona: z.string().min(2),
  renderMode: z
    .enum(["fast-trailer", "prompt-movie-beta", "heavy-worker-beta", "seedance-2-fast"])
    .default("prompt-movie-beta"),
  heavyProvider: z
    .enum([
      "local-heavy-v1",
      "open-model-adapter",
      "replicate-video-adapter",
      "replicate-kling-v3-omni",
      "minimax-subject-adapter",
    ])
    .optional(),
  fundingMode: z.enum(["managed", "creator-byok"]).default("managed"),
});

function json(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function titleFromPrompt(prompt: string) {
  const cleaned = prompt
    .replace(/[^\w\s]/g, " ")
    .trim()
    .split(/\s+/)
    .slice(0, 4)
    .join(" ");
  return cleaned ? cleaned.replace(/\b\w/g, (char) => char.toUpperCase()) : "Untitled Pulse";
}

function autoFillFromPrompt(prompt: string, templateId: string) {
  const normalized = prompt.trim();
  const title = titleFromPrompt(normalized);
  const creatorNameMatch = normalized.match(/\b(?:i am|i'm|my name is|starring)\s+([a-z0-9_-]+)/i);
  const creatorName = creatorNameMatch?.[1]
    ? creatorNameMatch[1].replace(/\b\w/g, (char) => char.toUpperCase())
    : "Creator";
  const lower = normalized.toLowerCase();
  const genre =
    /(love|romance|girlfriend|boyfriend|kiss)/.test(lower)
      ? "Romance"
      : /(fight|kung fu|battle|war|gang)/.test(lower)
        ? "Action"
        : /(adventure|journey|quest|travel)/.test(lower)
          ? "Adventure"
          : /(sad|tears|breakup|pain)/.test(lower)
            ? "Drama"
            : "Cinematic";
  const persona =
    /(fight|kung fu|battle)/.test(lower)
      ? "fearless fighter"
      : /(love|romance)/.test(lower)
        ? "romantic lead"
        : /(adventure|quest)/.test(lower)
          ? "restless adventurer"
          : "cinematic main character";
  const premise = normalized;
  const scenePrompt = `Turn this into a short movie scene: ${normalized}. Use the ${templateId} template mood with vertical framing and cinematic pacing.`;

  return { creatorName, title, genre, persona, premise, scenePrompt };
}

export async function POST(request: Request) {
  try {
    const beta = await getEffectiveCreatorBetaConfig();
    const formData = await request.formData();
    const video = formData.get("video");
    const selfie = formData.get("selfie");
    const quickPrompt = String(formData.get("quickPrompt") ?? "").trim();
    const templateIdValue = String(formData.get("templateId") ?? "");
    const requestedFundingMode = String(formData.get("fundingMode") ?? "managed");
    const replicateApiToken = String(formData.get("replicateApiToken") ?? "").trim();
    const accessCode = String(formData.get("accessCode") ?? "").trim();
    const identityConsent = formData.get("identityConsent") === "true";
    const shareToGallery = formData.get("shareToGallery") === "true";

    if (!(video instanceof File) || video.size === 0) {
      return json({ error: "A video clip is required." }, { status: 400 });
    }

    const rawValues = quickPrompt
      ? {
          ...autoFillFromPrompt(quickPrompt, templateIdValue),
          templateId: templateIdValue,
          renderMode: formData.get("renderMode"),
          heavyProvider: formData.get("heavyProvider") || undefined,
          fundingMode: requestedFundingMode,
        }
      : {
          creatorName: formData.get("creatorName"),
          title: formData.get("title"),
          templateId: formData.get("templateId"),
          genre: formData.get("genre"),
          premise: formData.get("premise"),
          scenePrompt: formData.get("scenePrompt"),
          persona: formData.get("persona"),
          renderMode: formData.get("renderMode"),
          heavyProvider: formData.get("heavyProvider") || undefined,
          fundingMode: requestedFundingMode,
        };

    const parsed = schema.safeParse(rawValues);

    if (!parsed.success) {
      return json(
        { error: parsed.error.issues[0]?.message || "The form data is incomplete." },
        { status: 400 },
      );
    }

    const isByok = parsed.data.fundingMode === "creator-byok";
    if (!beta.enabled && isByok) {
      return json({ error: "Creator-funded generation is not enabled." }, { status: 403 });
    }
    if (!beta.generationEnabled) {
      return json(
        { error: "Movie generation is temporarily paused. You can still create a free preview." },
        { status: 503 },
      );
    }
    if (beta.enabled && !identityConsent) {
      return json(
        { error: "Please confirm that you have permission to use the uploaded identity media." },
        { status: 400 },
      );
    }
    if (beta.enabled && beta.requireAccessCode && !isValidCreatorAccessCode(accessCode)) {
      return json({ error: "That Creator Beta access code is not valid." }, { status: 403 });
    }
    if (beta.enabled && !isByok && !beta.managedGenerationEnabled) {
      return json(
        { error: "PulseReel-funded generation is currently paused. Choose Bring your own Replicate key." },
        { status: 503 },
      );
    }
    if (isByok && replicateApiToken.length < 20) {
      return json(
        { error: "Enter a valid Replicate API token for creator-funded generation." },
        { status: 400 },
      );
    }

    const heavyProvider = parsed.data.heavyProvider as HeavyRenderProviderId | undefined;
    if (
      isByok &&
      heavyProvider !== "replicate-video-adapter" &&
      heavyProvider !== "replicate-kling-v3-omni"
    ) {
      return json(
        { error: "Bring-your-own-key generation currently supports Replicate AI and Replicate Pro." },
        { status: 400 },
      );
    }

    if (!isByok && beta.managedDailyLimit) {
      const today = new Date().toISOString().slice(0, 10);
      const managedToday = (await getProjects()).filter(
        (project) => project.createdAt.startsWith(today) && isManagedProject(project),
      ).length;
      if (managedToday >= beta.managedDailyLimit) {
        return json(
          {
            error:
              "Today’s PulseReel-funded generation limit has been reached. Try again tomorrow or use your own Replicate key.",
          },
          { status: 429 },
        );
      }
    }

    if (isByok && !process.env.PULSEREEL_REMOTE_MODEL_BACKEND_URL?.trim()) {
      return json(
        { error: "Creator-funded Replicate generation requires the PulseReel remote worker." },
        { status: 503 },
      );
    }
    if (isByok && isVercelRuntime()) {
      try {
        const remoteWorkerUrl = new URL(process.env.PULSEREEL_REMOTE_MODEL_BACKEND_URL!);
        if (remoteWorkerUrl.protocol !== "https:") {
          return json(
            { error: "Creator API keys can only be sent to an HTTPS remote worker." },
            { status: 503 },
          );
        }
      } catch {
        return json({ error: "The PulseReel remote worker URL is invalid." }, { status: 503 });
      }
    }

    if (
      isVercelRuntime() &&
      parsed.data.renderMode !== "seedance-2-fast" &&
      !process.env.PULSEREEL_REMOTE_MODEL_BACKEND_URL?.trim()
    ) {
      return json(
        {
          error:
            "The public Vercel app needs PULSEREEL_REMOTE_MODEL_BACKEND_URL before it can render movies. Local generation works on your PC, but Vercel cannot run the full local FFmpeg/Python/ComfyUI pipeline inside a web request.",
        },
        { status: 503 },
      );
    }

    if (parsed.data.renderMode === "seedance-2-fast") {
      const { sourceVideoUrl, sourceImageUrl } = await saveSourceAssets(
        video,
        selfie instanceof File && selfie.size > 0 ? selfie : undefined,
      );

      const project = await createSeedanceProject({
        creatorName: parsed.data.creatorName,
        title: parsed.data.title,
        templateId: parsed.data.templateId,
        genre: parsed.data.genre,
        premise: parsed.data.premise,
        scenePrompt: parsed.data.scenePrompt,
        persona: parsed.data.persona,
        sourceVideoUrl,
        sourceImageUrl,
      });

      if (beta.enabled) {
        project.visibility = shareToGallery ? "public" : "private";
        project.generationFunding = "managed";
        project.costBearer = "pulsereel";
        project.identityConsentAt = new Date().toISOString();
      }

      await addProject(project);

      return json({
        slug: project.slug,
        status: project.status,
        executionPath: "seedance-2-fast",
        project,
      });
    }

    const shouldUseHeavyWorker =
      isByok ||
      parsed.data.renderMode === "heavy-worker-beta" ||
      (isVercelRuntime() && Boolean(process.env.PULSEREEL_REMOTE_MODEL_BACKEND_URL?.trim()));

    if (shouldUseHeavyWorker) {
      const { sourceVideoUrl, sourceImageUrl } = await saveSourceAssets(
        video,
        selfie instanceof File && selfie.size > 0 ? selfie : undefined,
      );
      const project = await createHeavyProject(
        {
          creatorName: parsed.data.creatorName,
          title: parsed.data.title,
          templateId: parsed.data.templateId,
          genre: parsed.data.genre,
          premise: parsed.data.premise,
          scenePrompt: parsed.data.scenePrompt,
          persona: parsed.data.persona,
          renderMode: parsed.data.renderMode,
          heavyProvider,
          sourceVideoUrl,
          sourceImageUrl,
          ...(beta.enabled
            ? {
                visibility: shareToGallery ? ("public" as const) : ("private" as const),
                generationFunding: parsed.data.fundingMode,
                costBearer: isByok ? ("creator" as const) : ("pulsereel" as const),
                estimatedUnitCostUsd: heavyProvider
                  ? estimatedGenerationCostUsd(heavyProvider)
                  : undefined,
                identityConsentAt: new Date().toISOString(),
              }
            : {}),
        },
        { autoStart: !isVercelRuntime() && !isByok },
      );

      let finalProject = project;
      if (isVercelRuntime() || isByok) {
        finalProject = await enqueueHeavyGeneration(
          project,
          isByok
            ? {
                replicateToken: replicateApiToken,
                replicateModel:
                  heavyProvider === "replicate-kling-v3-omni"
                    ? process.env.PULSEREEL_KLING_REPLICATE_MODEL?.trim() ||
                      "kwaivgi/kling-v3-omni-video"
                    : process.env.PULSEREEL_REPLICATE_MODEL?.trim() || "minimax/video-01",
              }
            : undefined,
        );
      }

      finalProject = (await getProjectById(project.id)) ?? finalProject;

      return json({
        slug: finalProject.slug,
        status: finalProject.status,
        executionPath: isVercelRuntime() || isByok ? "remote-heavy-worker" : "local-heavy-worker",
        project: finalProject,
      });
    }

    const project = await createMovieProject({
      creatorName: parsed.data.creatorName,
      title: parsed.data.title,
      templateId: parsed.data.templateId,
      genre: parsed.data.genre,
      premise: parsed.data.premise,
      scenePrompt: parsed.data.scenePrompt,
      persona: parsed.data.persona,
      renderMode: parsed.data.renderMode,
      videoFile: video,
      imageFile: selfie instanceof File && selfie.size > 0 ? selfie : undefined,
      ...(beta.enabled
        ? {
            visibility: shareToGallery ? ("public" as const) : ("private" as const),
            generationFunding: parsed.data.fundingMode,
            costBearer: isByok ? ("creator" as const) : ("pulsereel" as const),
            identityConsentAt: new Date().toISOString(),
          }
        : {}),
    });

    await addProject(project);

    return json({ slug: project.slug, status: project.status });
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : "The movie pipeline failed." },
      { status: 500 },
    );
  }
}
