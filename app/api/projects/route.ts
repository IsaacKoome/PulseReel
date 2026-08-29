import { NextResponse } from "next/server";
import { del, head } from "@vercel/blob";
import { z } from "zod";
import { createHeavyProject, enqueueHeavyGeneration } from "@/lib/heavy-worker";
import { createMovieProject, saveSourceAssets, saveSourceFile } from "@/lib/pipeline";
import { isVercelRuntime } from "@/lib/runtime-storage";
import { createSeedanceProject } from "@/lib/seedance-provider";
import { addProject, getProjectById } from "@/lib/store";
import { createProjectDeleteCredential } from "@/lib/project-ownership";
import {
  GenerationAccessError,
  isManagedGeneration,
  reserveManagedGeneration,
  syncGenerationReservationForProject,
  updateGenerationReservation,
} from "@/lib/generation-access";
import { isAuthEnabled } from "@/lib/auth/config";
import { getCurrentUser } from "@/lib/auth/user";
import { FREE_BETA_MANAGED_PROVIDER } from "@/lib/beta-config";
import { createDirectSeedanceProject, DIRECT_SEEDANCE_PROVIDER } from "@/lib/replicate-direct";
import type { HeavyRenderProviderId } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_DIRECT_VIDEO_BYTES = 50_000_000;

const schema = z.object({
  creatorName: z.string().min(1),
  title: z.string().min(1),
  templateId: z.string().min(1),
  genre: z.string().min(1),
  premise: z.string().min(10),
  scenePrompt: z.string().min(10),
  persona: z.string().min(2),
  cameraMode: z.enum(["cinematic", "selfie"]).default("cinematic"),
  renderMode: z
    .enum(["fast-trailer", "prompt-movie-beta", "heavy-worker-beta", "seedance-2-fast"])
    .default("prompt-movie-beta"),
  heavyProvider: z
    .enum([
      "local-heavy-v1",
      "open-model-adapter",
      "replicate-video-adapter",
      "replicate-seedance-1.5-pro",
      "replicate-kling-v3-omni",
      "minimax-subject-adapter",
    ])
    .optional(),
});

function titleFromPrompt(prompt: string) {
  const cleaned = prompt
    .replace(/[^\w\s]/g, " ")
    .trim()
    .split(/\s+/)
    .slice(0, 4)
    .join(" ");
  return cleaned ? cleaned.replace(/\b\w/g, (char) => char.toUpperCase()) : "Untitled Pulse";
}

function autoFillFromPrompt(prompt: string) {
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
  const scenePrompt = `Turn this into one coherent vertical live-action movie scene: ${normalized}. Keep the requested people, setting, action, and camera perspective grounded and visually consistent.`;

  return { creatorName, title, genre, persona, premise, scenePrompt };
}

function projectForClient<T extends { deleteTokenHash?: string; ownerId?: string }>(project: T) {
  const {
    deleteTokenHash: _deleteTokenHash,
    ownerId: _ownerId,
    ...publicProject
  } = project;
  return publicProject;
}

export async function POST(request: Request) {
  let generationReservationId: string | null = null;
  let directVideoBlobUrl: string | null = null;
  let retainDirectVideoBlob = false;

  try {
    const user = await getCurrentUser();
    if (isAuthEnabled() && !user) {
      return NextResponse.json(
        { error: "Sign in before creating a movie." },
        { status: 401 },
      );
    }

    const formData = await request.formData();
    const video = formData.get("video");
    const videoBlobUrl = String(formData.get("videoBlobUrl") ?? "").trim();
    const selfie = formData.get("selfie");
    const quickPrompt = String(formData.get("quickPrompt") ?? "").trim();
    const templateIdValue = String(formData.get("templateId") ?? "");

    const hasVideoFile = video instanceof File && video.size > 0;
    if (!hasVideoFile && !videoBlobUrl) {
      return NextResponse.json({ error: "A video clip is required." }, { status: 400 });
    }

    if (videoBlobUrl) {
      if (!user) {
        return NextResponse.json({ error: "Sign in before using a direct clip upload." }, { status: 401 });
      }

      const metadata = await head(videoBlobUrl);
      const expectedPrefix = `pulsereel/source/${user.id}/`;
      if (
        !metadata.pathname.startsWith(expectedPrefix) ||
        !metadata.contentType.startsWith("video/") ||
        metadata.size <= 0 ||
        metadata.size > MAX_DIRECT_VIDEO_BYTES
      ) {
        return NextResponse.json(
          { error: "The uploaded clip is invalid or belongs to another account." },
          { status: 400 },
        );
      }
      directVideoBlobUrl = metadata.url;
    }

    const saveRequestSourceAssets = async () => {
      if (directVideoBlobUrl) {
        return {
          sourceVideoUrl: directVideoBlobUrl,
          sourceImageUrl:
            selfie instanceof File && selfie.size > 0
              ? await saveSourceFile(selfie)
              : undefined,
        };
      }

      return saveSourceAssets(
        video as File,
        selfie instanceof File && selfie.size > 0 ? selfie : undefined,
      );
    };

    const rawValues = quickPrompt
      ? {
          ...autoFillFromPrompt(quickPrompt),
          templateId: templateIdValue,
          cameraMode: formData.get("cameraMode") || "cinematic",
          renderMode: formData.get("renderMode"),
          heavyProvider: formData.get("heavyProvider") || undefined,
        }
      : {
      creatorName: formData.get("creatorName"),
      title: formData.get("title"),
      templateId: formData.get("templateId"),
      genre: formData.get("genre"),
      premise: formData.get("premise"),
      scenePrompt: formData.get("scenePrompt"),
      persona: formData.get("persona"),
      cameraMode: formData.get("cameraMode") || "cinematic",
      renderMode: formData.get("renderMode"),
      heavyProvider: formData.get("heavyProvider") || undefined,
        };

    const parsed = schema.safeParse(rawValues);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "The form data is incomplete." },
        { status: 400 },
      );
    }

    const requestedHeavyProvider = parsed.data.heavyProvider ?? FREE_BETA_MANAGED_PROVIDER;
    const useDirectSeedance =
      isVercelRuntime() &&
      parsed.data.renderMode !== "seedance-2-fast" &&
      requestedHeavyProvider === DIRECT_SEEDANCE_PROVIDER;

    if (
      isVercelRuntime() &&
      parsed.data.renderMode !== "seedance-2-fast" &&
      !useDirectSeedance &&
      !process.env.PULSEREEL_REMOTE_MODEL_BACKEND_URL?.trim()
    ) {
      return NextResponse.json(
        {
          error:
            "The public Vercel app needs PULSEREEL_REMOTE_MODEL_BACKEND_URL before it can render movies. Local generation works on your PC, but Vercel cannot run the full local FFmpeg/Python/ComfyUI pipeline inside a web request.",
        },
        { status: 503 },
      );
    }

    if (
      isManagedGeneration({
        renderMode: parsed.data.renderMode,
        heavyProvider: parsed.data.heavyProvider,
      })
    ) {
      const provider =
        parsed.data.renderMode === "seedance-2-fast"
          ? "seedance-2-fast"
          : requestedHeavyProvider;
      generationReservationId = await reserveManagedGeneration(user, provider);
    }

    if (parsed.data.renderMode === "seedance-2-fast") {
      const deleteCredential = createProjectDeleteCredential();
      const { sourceVideoUrl, sourceImageUrl } = await saveRequestSourceAssets();

      const project = await createSeedanceProject({
        creatorName: parsed.data.creatorName,
        title: parsed.data.title,
        templateId: parsed.data.templateId,
        genre: parsed.data.genre,
        premise: parsed.data.premise,
        scenePrompt: parsed.data.scenePrompt,
        persona: parsed.data.persona,
        cameraMode: parsed.data.cameraMode,
        sourceVideoUrl,
        sourceImageUrl,
      });
      project.ownerId = user?.id;
      project.visibility = user ? "unlisted" : "public";
      project.deleteTokenHash = deleteCredential.tokenHash;

      await addProject(project);
      await updateGenerationReservation(generationReservationId, "submitted", project.id);
      if (project.status === "published" || project.status === "failed") {
        await syncGenerationReservationForProject(
          project.id,
          project.status === "published" ? "completed" : "failed",
        );
      }

      return NextResponse.json({
        slug: project.slug,
        status: project.status,
        executionPath: "seedance-2-fast",
        project: projectForClient(project),
        deleteToken: deleteCredential.token,
      });
    }

    if (useDirectSeedance) {
      if (!(selfie instanceof File) || selfie.size <= 0) {
        return NextResponse.json(
          { error: "A clear identity frame is required for direct Seedance generation." },
          { status: 400 },
        );
      }

      const deleteCredential = createProjectDeleteCredential();
      const sourceVideoUrl = directVideoBlobUrl
        ? directVideoBlobUrl
        : (await saveSourceAssets(video as File)).sourceVideoUrl;
      const project = await createDirectSeedanceProject({
        creatorName: parsed.data.creatorName,
        title: parsed.data.title,
        templateId: parsed.data.templateId,
        genre: parsed.data.genre,
        premise: parsed.data.premise,
        scenePrompt: parsed.data.scenePrompt,
        persona: parsed.data.persona,
        cameraMode: parsed.data.cameraMode,
        renderMode: parsed.data.renderMode,
        sourceVideoUrl,
        identityImage: selfie,
        ownerId: user?.id,
        visibility: user ? "unlisted" : "public",
        deleteTokenHash: deleteCredential.tokenHash,
        requestOrigin: new URL(request.url).origin,
      });
      retainDirectVideoBlob = Boolean(directVideoBlobUrl);
      await updateGenerationReservation(generationReservationId, "submitted", project.id);

      return NextResponse.json({
        slug: project.slug,
        status: project.status,
        executionPath: "direct-replicate",
        project: projectForClient(project),
        deleteToken: deleteCredential.token,
      });
    }

    const shouldUseHeavyWorker =
      parsed.data.renderMode === "heavy-worker-beta" ||
      (isVercelRuntime() && Boolean(process.env.PULSEREEL_REMOTE_MODEL_BACKEND_URL?.trim()));

    if (shouldUseHeavyWorker) {
      const deleteCredential = createProjectDeleteCredential();
      const { sourceVideoUrl, sourceImageUrl } = await saveRequestSourceAssets();
      const heavyProvider = requestedHeavyProvider as HeavyRenderProviderId;

      const project = await createHeavyProject({
        creatorName: parsed.data.creatorName,
        title: parsed.data.title,
        templateId: parsed.data.templateId,
        genre: parsed.data.genre,
        premise: parsed.data.premise,
        scenePrompt: parsed.data.scenePrompt,
        persona: parsed.data.persona,
        cameraMode: parsed.data.cameraMode,
        renderMode: parsed.data.renderMode,
        heavyProvider,
        sourceVideoUrl,
        sourceImageUrl,
        ownerId: user?.id,
        visibility: user ? "unlisted" : "public",
        deleteTokenHash: deleteCredential.tokenHash,
      }, { autoStart: !isVercelRuntime() });

      let finalProject = project;
      if (isVercelRuntime()) {
        finalProject = await enqueueHeavyGeneration(project);
      }

      finalProject = (await getProjectById(project.id)) ?? finalProject;
      await updateGenerationReservation(generationReservationId, "submitted", finalProject.id);
      if (finalProject.status === "published" || finalProject.status === "failed") {
        await syncGenerationReservationForProject(
          finalProject.id,
          finalProject.status === "published" ? "completed" : "failed",
        );
      }

      return NextResponse.json({
        slug: finalProject.slug,
        status: finalProject.status,
        executionPath: isVercelRuntime() ? "remote-heavy-worker" : "local-heavy-worker",
        project: projectForClient(finalProject),
        deleteToken: deleteCredential.token,
      });
    }

    const deleteCredential = createProjectDeleteCredential();
    const project = await createMovieProject({
      ...parsed.data,
      videoFile: video as File,
      imageFile: selfie instanceof File && selfie.size > 0 ? selfie : undefined,
    });
    project.ownerId = user?.id;
    project.visibility = user ? "unlisted" : "public";
    project.deleteTokenHash = deleteCredential.tokenHash;

    await addProject(project);
    await updateGenerationReservation(generationReservationId, "submitted", project.id);
    if (project.status === "published" || project.status === "failed") {
      await syncGenerationReservationForProject(
        project.id,
        project.status === "published" ? "completed" : "failed",
      );
    }

    return NextResponse.json({
      slug: project.slug,
      status: project.status,
      project: projectForClient(project),
      deleteToken: deleteCredential.token,
    });
  } catch (error) {
    await updateGenerationReservation(generationReservationId, "failed");

    if (error instanceof GenerationAccessError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "The movie pipeline failed." },
      { status: 500 },
    );
  } finally {
    if (directVideoBlobUrl && !retainDirectVideoBlob) {
      try {
        await del(directVideoBlobUrl);
      } catch (error) {
        console.warn("PulseReel could not remove a temporary direct upload.", error);
      }
    }
  }
}
