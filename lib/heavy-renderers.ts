import { promises as fs } from "fs";
import path from "path";
import type { HeavyRenderProviderId, MovieProject, ShotSpec } from "@/lib/types";
import {
  executeHeavyRunnerCommand,
  readHeavyJobResult,
  updateHeavyJobStatus,
  type HeavyJobPayload,
} from "@/lib/heavy-job-runner";
import { renderMovieForProject } from "@/lib/pipeline";

function cameraDirection(project: MovieProject) {
  if (project.cameraMode === "selfie") {
    return [
      "Front-facing handheld selfie viewpoint from the main character's own camera.",
      "Keep the main character recognizable in the foreground while they naturally turn or move to reveal the requested environment and people behind them.",
      "Use believable arm-length framing and gentle human camera motion; do not show a phone or selfie stick.",
    ].join(" ");
  }

  return [
    "A separate cinematic camera films the main character in a medium or wide portrait composition inside the requested world.",
    "This is not a selfie, vlog, phone recording, first-person view, or outstretched-arm shot.",
    "Keep both the main character and the important environment clearly readable.",
  ].join(" ");
}

type ProgressReporter = {
  update: (
    progress: number,
    stage: string,
    status?: NonNullable<MovieProject["workerJob"]>["status"],
  ) => Promise<void>;
};

type ExternalProviderConfig = {
  provider: "replicate" | "minimax";
  id: HeavyRenderProviderId;
  label: string;
  description: string;
  preferredMotionBackend: HeavyJobPayload["modelHints"]["preferredMotionBackend"];
  tokenEnv: string;
  modelEnv: string;
  defaultModel?: string;
  configuredStage: string;
  missingStage: string;
  allowLocalFallback?: boolean;
  notes: string[];
};

export type HeavyRenderResult = {
  processedVideoUrl: string;
  shotPlan: ShotSpec[];
};

export type HeavyRenderProvider = {
  id: HeavyRenderProviderId;
  label: string;
  description: string;
  render: (
    project: MovieProject,
    progress: ProgressReporter,
    job: { payload: HeavyJobPayload; payloadPath: string; resultPath: string; statusPath: string },
  ) => Promise<HeavyRenderResult>;
};

const localHeavyProvider: HeavyRenderProvider = {
  id: "local-heavy-v1",
  label: "Local Heavy v1",
  description: "Stable local worker that reuses the in-app prompt movie renderer as a heavier queued job.",
  async render(project, progress, job) {
    await progress.update(18, `Preparing identity assets from ${job.payloadPath}`);
    await progress.update(32, `Building shot plan and template scenes for ${job.payload.shots.length} shots`);
    await progress.update(54, "Rendering local heavy motion movie");
    const result = await renderMovieForProject(project);
    await progress.update(88, "Finishing edit and packaging movie");
    return result;
  },
};

function envValue(key: string) {
  return process.env[key]?.trim() || "";
}

function externalProviderPrompt(project: MovieProject) {
  return [
    "Create one coherent continuous vertical live-action shot. Do not make a montage, trailer, title card, poster, or sequence of unrelated shots.",
    `Scene requested by the user: ${project.premise}`,
    `Main character: ${project.creatorName}, using the supplied identity reference. Preserve the same facial structure, skin tone, age, hairline, and recognizable identity for the entire shot.`,
    `Camera contract: ${cameraDirection(project)}`,
    "Use grounded cinematic lighting and color that follow the requested scene; do not impose a preset fantasy, romance, motivational, or graphic-design style.",
    "Show one clear, physically believable action. Background people should look real, have natural body motion, and behave consistently with the requested place.",
    "Use natural skin texture, stable anatomy, realistic hands, cinematic depth, and readable faces. No interface graphics, invented writing, captions, logos, duplicate people, face morphing, or distorted bodies.",
  ].join("\n\n");
}

async function writeExternalProviderRequest(
  project: MovieProject,
  job: Parameters<HeavyRenderProvider["render"]>[2],
  config: ExternalProviderConfig,
) {
  const providerDir = path.join(job.payload.jobRoot, "provider-requests");
  await fs.mkdir(providerDir, { recursive: true });

  const model = envValue(config.modelEnv) || config.defaultModel;
  const configured = Boolean(envValue(config.tokenEnv) && model);
  const prompt = externalProviderPrompt(project);
  const requestPath = path.join(providerDir, `${config.provider}.json`);
  const request = {
    provider: config.provider,
    model,
    configured,
    prompt,
    output: job.payload.outputSpec,
    identity: {
      sourceVideoUrl: job.payload.assets.sourceVideoUrl,
      sourceImageUrl: job.payload.assets.sourceImageUrl,
      sourceVideoPath: job.payload.assets.sourceVideoPath,
      sourceImagePath: job.payload.assets.sourceImagePath,
    },
    shots: job.payload.shotReferences.map((shot) => ({
      id: shot.shotId,
      title: shot.title,
      prompt: shot.prompt,
      durationSeconds: shot.durationSeconds,
      cameraGoal: shot.cameraGoal,
      heroAction: shot.heroAction,
      backgroundAction: shot.backgroundAction,
      referencePngPath: shot.referencePngPath,
      subjectFraming: shot.subjectFraming,
      worldActivity: shot.worldActivity,
    })),
    notes: config.notes,
  };

  await fs.writeFile(requestPath, JSON.stringify(request, null, 2), "utf8");

  job.payload.provider = config.id;
  job.payload.modelHints.preferredMotionBackend = config.preferredMotionBackend;
  job.payload.modelHints.fallbackBehavior =
    config.allowLocalFallback === false
      ? "fail-provider-job"
      : "use-local-motion-runner";
  job.payload.modelHints.externalProvider = {
    provider: config.provider,
    configured,
    model,
    tokenEnv: config.tokenEnv,
    requestPath,
    prompt,
    notes: config.notes,
  };
  await fs.writeFile(job.payloadPath, JSON.stringify(job.payload, null, 2), "utf8");

  return { configured, model, requestPath };
}

const openModelAdapterProvider: HeavyRenderProvider = {
  id: "open-model-adapter",
  label: "Open Model Adapter",
  description:
    "Adapter slot for future open-source motion/video models. It currently falls back to the local heavy renderer while keeping a compatible contract.",
  async render(project, progress, job) {
    const hasRemoteBackend = Boolean(process.env.PULSEREEL_REMOTE_MODEL_BACKEND_URL?.trim());
    await progress.update(14, "Preparing open-model adapter payload");
    await progress.update(22, `Writing shot-level bundle for ${job.payload.shots.length} shots`);
    await progress.update(
      30,
      hasRemoteBackend ? "Sending shot package to remote GPU model worker" : "Launching external open-model runner",
    );

    const runner = await executeHeavyRunnerCommand({
      payloadPath: job.payloadPath,
      resultPath: job.resultPath,
      statusPath: job.statusPath,
    });
    const runnerResult = await readHeavyJobResult(job.resultPath);

    if (
      runner.exitCode === 0 &&
      runnerResult?.status === "completed" &&
      runnerResult.processedVideoUrl &&
      runnerResult.shotPlan
    ) {
      await progress.update(
        82,
        hasRemoteBackend ? "Remote GPU model worker produced a movie" : "External open-model runner produced a movie",
      );
      return {
        processedVideoUrl: runnerResult.processedVideoUrl,
        shotPlan: runnerResult.shotPlan,
      };
    }

    const failureMessage =
      runner.stderr.trim() ||
      runnerResult?.error ||
      (runner.exitCode === 0
        ? "Remote model backend finished without a usable video."
        : `Runner exited with code ${runner.exitCode}`);

    await updateHeavyJobStatus(job.statusPath, {
      provider: "open-model-adapter",
      status: "running",
      stage: hasRemoteBackend
        ? "Remote model path failed before returning a playable video"
        : runner.exitCode === 0
          ? "External model path finished without a usable video, falling back to local heavy renderer"
          : "External model path failed, falling back to local heavy renderer",
      progress: 36,
      error: failureMessage,
    });

    if (hasRemoteBackend) {
      throw new Error(
        `Remote movie worker failed before returning a playable video. ${failureMessage}`,
      );
    }

    await progress.update(38, "Using local heavy fallback after external model path");
    return localHeavyProvider.render(project, progress, job);
  },
};

function createExternalProvider(config: ExternalProviderConfig): HeavyRenderProvider {
  return {
    id: config.id,
    label: config.label,
    description: config.description,
    async render(project, progress, job) {
      await progress.update(12, `Preparing ${config.label} request bundle`);
      const providerRequest = await writeExternalProviderRequest(project, job, config);
      const strictProvider = config.allowLocalFallback === false;
      const hasRemoteBackend = Boolean(process.env.PULSEREEL_REMOTE_MODEL_BACKEND_URL?.trim());

      if (strictProvider && !providerRequest.configured) {
        const message = `${config.label} was selected, but ${config.tokenEnv} and ${config.modelEnv} are not both configured. Local fallback is disabled for this provider.`;
        await updateHeavyJobStatus(job.statusPath, {
          provider: config.id,
          status: "failed",
          stage: message,
          progress: 18,
          error: message,
        });
        throw new Error(message);
      }

      if (strictProvider && !hasRemoteBackend) {
        const message = `${config.label} was selected, but PULSEREEL_REMOTE_MODEL_BACKEND_URL is not configured. Local fallback is disabled for this provider.`;
        await updateHeavyJobStatus(job.statusPath, {
          provider: config.id,
          status: "failed",
          stage: message,
          progress: 20,
          error: message,
        });
        throw new Error(message);
      }

      await updateHeavyJobStatus(job.statusPath, {
        provider: config.id,
        status: "running",
        stage: providerRequest.configured ? config.configuredStage : config.missingStage,
        progress: providerRequest.configured ? 24 : 18,
      });

      await progress.update(
        providerRequest.configured ? 28 : 22,
        providerRequest.configured
          ? `${config.label} payload ready for ${providerRequest.model}`
          : strictProvider
            ? `${config.label} is not fully configured. Add ${config.tokenEnv} and ${config.modelEnv}.`
            : `${config.label} is not fully configured, using the stable worker fallback`,
      );

      return openModelAdapterProvider.render(project, progress, job);
    },
  };
}

const replicateVideoProvider = createExternalProvider({
  provider: "replicate",
  id: "replicate-video-adapter",
  label: "Replicate Video Adapter",
  description:
    "Low-cost hosted-video lane. When selected, PulseReel sends the job to Replicate only and surfaces Replicate errors instead of silently falling back.",
  preferredMotionBackend: "replicate-hosted-video",
  tokenEnv: "PULSEREEL_REPLICATE_API_TOKEN",
  modelEnv: "PULSEREEL_REPLICATE_MODEL",
  configuredStage: "Replicate video provider configured; dispatching through the model-worker contract",
  missingStage: "Replicate provider selected but token/model are missing; local fallback is disabled",
  allowLocalFallback: false,
  notes: [
    "Best first paid/low-cost experiment path because it avoids managing a GPU server.",
    "Use a model that accepts image/video reference inputs for identity preservation.",
    "The remote worker should translate this request into the exact Replicate model input schema.",
  ],
});

const replicateSeedance15Provider = createExternalProvider({
  provider: "replicate",
  id: "replicate-seedance-1.5-pro",
  label: "Seedance 1.5 Pro · Owner test",
  description:
    "Admin-only five-second 720p image-to-video comparison with native audio through Replicate-hosted Seedance 1.5 Pro.",
  preferredMotionBackend: "replicate-hosted-video",
  tokenEnv: "PULSEREEL_REPLICATE_API_TOKEN",
  modelEnv: "PULSEREEL_SEEDANCE_15_REPLICATE_MODEL",
  defaultModel: "bytedance/seedance-1.5-pro",
  configuredStage: "Seedance 1.5 Pro configured; dispatching a five-second 720p native-audio identity test",
  missingStage: "Seedance 1.5 Pro selected but the Replicate token is missing; local fallback is disabled",
  allowLocalFallback: false,
  notes: [
    "Owner-only quality and cost comparison; do not expose this lane to the public free beta.",
    "Use exactly one identity image as the image-to-video starting frame.",
    "Request portrait 9:16, 720p, five seconds, 24 fps, and native audio.",
  ],
});

const replicateKlingProvider = createExternalProvider({
  provider: "replicate",
  id: "replicate-kling-v3-omni",
  label: "Replicate Pro · Kling V3 Omni",
  description:
    "Experimental 15-second identity-reference lane with native audio through Replicate-hosted Kling V3 Omni.",
  preferredMotionBackend: "replicate-hosted-video",
  tokenEnv: "PULSEREEL_REPLICATE_API_TOKEN",
  modelEnv: "PULSEREEL_KLING_REPLICATE_MODEL",
  defaultModel: "kwaivgi/kling-v3-omni-video",
  configuredStage: "Kling V3 Omni configured; dispatching a 15-second native-audio identity movie",
  missingStage: "Kling V3 Omni selected but the Replicate token is missing; local fallback is disabled",
  allowLocalFallback: false,
  notes: [
    "Experimental higher-cost lane; keep MiniMax Video-01 as the default until identity consistency is verified.",
    "Send the creator identity as reference_images and name it as <<<image_1>>> in every shot prompt.",
    "Request portrait 9:16, native audio, and a 15-second multi-shot movie.",
  ],
});

const minimaxSubjectProvider = createExternalProvider({
  provider: "minimax",
  id: "minimax-subject-adapter",
  label: "MiniMax Subject Adapter",
  description:
    "Identity-first subject-reference lane. This is the target path for keeping Isaac/the creator inside generated scenes once MiniMax access is available.",
  preferredMotionBackend: "minimax-subject-reference",
  tokenEnv: "PULSEREEL_MINIMAX_API_KEY",
  modelEnv: "PULSEREEL_MINIMAX_MODEL",
  configuredStage: "MiniMax subject-reference provider configured; dispatching through the model-worker contract",
  missingStage: "MiniMax provider selected but API key/model are missing; falling back to the stable worker",
  notes: [
    "Best fit for PulseReel's identity-first dream because subject-reference is designed to preserve a person across generated shots.",
    "Keep prompts short, visual, and continuity-focused for stronger subject consistency.",
    "The remote worker should translate this request into the exact MiniMax API payload once credentials are available.",
  ],
});

const providers: Record<HeavyRenderProviderId, HeavyRenderProvider> = {
  "local-heavy-v1": localHeavyProvider,
  "open-model-adapter": openModelAdapterProvider,
  "replicate-video-adapter": replicateVideoProvider,
  "replicate-seedance-1.5-pro": replicateSeedance15Provider,
  "replicate-kling-v3-omni": replicateKlingProvider,
  "minimax-subject-adapter": minimaxSubjectProvider,
};

export function getHeavyRenderProvider(providerId?: HeavyRenderProviderId) {
  if (!providerId) {
    return providers[(process.env.PULSEREEL_HEAVY_PROVIDER as HeavyRenderProviderId) || "open-model-adapter"] ??
      localHeavyProvider;
  }

  return providers[providerId] ?? localHeavyProvider;
}

export function listHeavyRenderProviders() {
  return Object.values(providers);
}
