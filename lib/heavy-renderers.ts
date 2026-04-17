import type { HeavyRenderProviderId, MovieProject, ShotSpec } from "@/lib/types";
import {
  executeHeavyRunnerCommand,
  readHeavyJobResult,
  updateHeavyJobStatus,
  type HeavyJobPayload,
} from "@/lib/heavy-job-runner";
import { renderMovieForProject } from "@/lib/pipeline";

type ProgressReporter = {
  update: (
    progress: number,
    stage: string,
    status?: NonNullable<MovieProject["workerJob"]>["status"],
  ) => Promise<void>;
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

const openModelAdapterProvider: HeavyRenderProvider = {
  id: "open-model-adapter",
  label: "Open Model Adapter",
  description:
    "Adapter slot for future open-source motion/video models. It currently falls back to the local heavy renderer while keeping a compatible contract.",
  async render(project, progress, job) {
    await progress.update(14, "Preparing open-model adapter payload");
    await progress.update(22, `Writing shot-level bundle for ${job.payload.shots.length} shots`);
    await progress.update(30, "Launching external open-model runner");

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
      await progress.update(82, "External open-model runner produced a movie");
      return {
        processedVideoUrl: runnerResult.processedVideoUrl,
        shotPlan: runnerResult.shotPlan,
      };
    }

    await updateHeavyJobStatus(job.statusPath, {
      provider: "open-model-adapter",
      status: "running",
      stage: runner.exitCode === 0
        ? "External runner finished without a usable video, falling back to local heavy renderer"
        : "External runner failed, falling back to local heavy renderer",
      progress: 36,
      error:
        runner.stderr.trim() ||
        runnerResult?.error ||
        (runner.exitCode === 0 ? undefined : `Runner exited with code ${runner.exitCode}`),
    });
    await progress.update(38, "Using local heavy fallback after external adapter pass");
    return localHeavyProvider.render(project, progress, job);
  },
};

const providers: Record<HeavyRenderProviderId, HeavyRenderProvider> = {
  "local-heavy-v1": localHeavyProvider,
  "open-model-adapter": openModelAdapterProvider,
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
