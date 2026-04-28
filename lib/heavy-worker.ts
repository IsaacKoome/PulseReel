import type { MovieProject } from "@/lib/types";
import {
  createHeavyJobFiles,
  readHeavyJobResult,
  readHeavyJobPayload,
  updateHeavyJobStatus,
  writeHeavyJobResult,
} from "@/lib/heavy-job-runner";
import { getHeavyRenderProvider } from "@/lib/heavy-renderers";
import { createMovieProjectDraft } from "@/lib/pipeline";
import { addProject, getProjectById, getProjectBySlug, updateProject } from "@/lib/store";

const activeJobs = new Set<string>();

type WorkerStatus = NonNullable<MovieProject["workerJob"]>["status"];

export async function createHeavyProject(input: {
  creatorName: string;
  title: string;
  templateId: string;
  genre: string;
  premise: string;
  scenePrompt: string;
  persona: string;
  renderMode: "fast-trailer" | "prompt-movie-beta" | "heavy-worker-beta";
  sourceVideoUrl: string;
  sourceImageUrl?: string;
}, options: { autoStart?: boolean } = {}) {
  const provider = getHeavyRenderProvider();
  const project = await createMovieProjectDraft({
    ...input,
    status: "processing",
  });

  project.workerJob = {
    id: `job-${project.id}`,
    provider: provider.id,
    status: "queued",
    progress: 5,
    stage: `Queued for ${provider.label}`,
  };

  const jobFiles = await createHeavyJobFiles(project, provider.id);
  project.workerJob.payloadPath = jobFiles.payloadPath;
  project.workerJob.resultPath = jobFiles.resultPath;

  await addProject(project);
  if (options.autoStart ?? true) {
    void startHeavyGeneration(project.id);
  }
  return project;
}

export async function startHeavyGeneration(projectId: string) {
  if (activeJobs.has(projectId)) {
    return;
  }

  activeJobs.add(projectId);

  const resolveProviderId = async () => {
    const project = await getProjectById(projectId);
    return project?.workerJob?.provider;
  };

  const setProgress = async (
    progress: number,
    stage: string,
    status: WorkerStatus = "running",
  ) => {
    const currentProject = await getProjectById(projectId);
    const providerId = currentProject?.workerJob?.provider ?? (await resolveProviderId()) ?? "local-heavy-v1";
    if (currentProject?.workerJob?.payloadPath) {
      const statusPath = currentProject.workerJob.payloadPath.replace(/payload\.json$/, "status.json");
      await updateHeavyJobStatus(statusPath, { provider: providerId, status, stage, progress });
    }
    await updateProject(projectId, (project) => ({
      ...project,
      status: status === "failed" ? "failed" : status === "completed" ? "published" : "processing",
      updatedAt: new Date().toISOString(),
      workerJob: {
        id: project.workerJob?.id ?? `job-${project.id}`,
        provider: providerId ?? "local-heavy-v1",
        status,
        progress,
        stage,
        payloadPath: project.workerJob?.payloadPath,
        resultPath: project.workerJob?.resultPath,
        startedAt: project.workerJob?.startedAt ?? new Date().toISOString(),
        completedAt: status === "completed" ? new Date().toISOString() : project.workerJob?.completedAt,
        error: status === "failed" ? project.workerJob?.error : undefined,
      },
    }));
  };

  try {
    const current = await getProjectById(projectId);
    if (!current) {
      return;
    }
    const provider = getHeavyRenderProvider(current.workerJob?.provider);
    await setProgress(10, `Starting ${provider.label}`);
    const payloadPath = current.workerJob?.payloadPath;
    const resultPath = current.workerJob?.resultPath;
    if (!payloadPath || !resultPath) {
      throw new Error("Heavy job files were not prepared.");
    }
    const statusPath = payloadPath.replace(/payload\.json$/, "status.json");
    const payload = await readHeavyJobPayload(payloadPath);
    const { processedVideoUrl, shotPlan } = await provider.render(
      current,
      { update: setProgress },
      { payload, payloadPath, resultPath, statusPath },
    );
    await writeHeavyJobResult(resultPath, {
      jobId: payload.jobId,
      provider: provider.id,
      status: "completed",
      completedAt: new Date().toISOString(),
      processedVideoUrl,
      shotPlan,
    });
    await updateHeavyJobStatus(statusPath, {
      provider: provider.id,
      status: "completed",
      stage: `${provider.label} movie ready`,
      progress: 100,
    });

    await updateProject(projectId, (item) => ({
      ...item,
      status: "published",
      processedVideoUrl,
      shotPlan,
      updatedAt: new Date().toISOString(),
      workerJob: {
        id: item.workerJob?.id ?? `job-${item.id}`,
        provider: item.workerJob?.provider ?? provider.id,
        status: "completed",
        progress: 100,
        stage: `${provider.label} movie ready`,
        payloadPath: item.workerJob?.payloadPath,
        resultPath: item.workerJob?.resultPath,
        startedAt: item.workerJob?.startedAt ?? new Date().toISOString(),
        completedAt: new Date().toISOString(),
      },
    }));
  } catch (error) {
    const project = await getProjectById(projectId);
    if (project?.workerJob?.payloadPath) {
      const statusPath = project.workerJob.payloadPath.replace(/payload\.json$/, "status.json");
      await updateHeavyJobStatus(statusPath, {
        provider: project.workerJob.provider,
        status: "failed",
        stage: "Heavy generation failed",
        progress: project.workerJob.progress ?? 0,
        error: error instanceof Error ? error.message : "Heavy generation failed.",
      });
      if (project.workerJob.resultPath) {
        await writeHeavyJobResult(project.workerJob.resultPath, {
          jobId: project.workerJob.id,
          provider: project.workerJob.provider,
          status: "failed",
          completedAt: new Date().toISOString(),
          error: error instanceof Error ? error.message : "Heavy generation failed.",
        });
      }
    }
    await updateProject(projectId, (item) => ({
      ...item,
      status: "failed",
      updatedAt: new Date().toISOString(),
      workerJob: {
        id: item.workerJob?.id ?? `job-${item.id}`,
        provider: item.workerJob?.provider ?? "local-heavy-v1",
        status: "failed",
        progress: item.workerJob?.progress ?? 0,
        stage: "Heavy generation failed",
        payloadPath: item.workerJob?.payloadPath,
        resultPath: item.workerJob?.resultPath,
        startedAt: item.workerJob?.startedAt ?? new Date().toISOString(),
        completedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : "Heavy generation failed.",
      },
    }));
  } finally {
    activeJobs.delete(projectId);
  }
}

export async function getProjectStatus(slug: string) {
  const project = await getProjectBySlug(slug);
  if (!project) {
    return null;
  }

  if (
    project.workerJob &&
    project.status === "processing" &&
    project.workerJob.resultPath
  ) {
    const result = await readHeavyJobResult(project.workerJob.resultPath);

    if (result?.status === "completed" && result.processedVideoUrl) {
      const updated = await updateProject(project.id, (item) => ({
        ...item,
        status: "published",
        processedVideoUrl: result.processedVideoUrl ?? item.processedVideoUrl,
        shotPlan: result.shotPlan ?? item.shotPlan,
        updatedAt: new Date().toISOString(),
        workerJob: {
          id: item.workerJob?.id ?? `job-${item.id}`,
          provider: item.workerJob?.provider ?? result.provider,
          status: "completed",
          progress: 100,
          stage: "Recovered completed heavy movie from worker result",
          payloadPath: item.workerJob?.payloadPath,
          resultPath: item.workerJob?.resultPath,
          startedAt: item.workerJob?.startedAt,
          completedAt: result.completedAt,
        },
      }));
      if (!updated) {
        return null;
      }
      return {
        slug: updated.slug,
        status: updated.status,
        renderMode: updated.renderMode,
        processedVideoUrl: updated.processedVideoUrl,
        workerJob: updated.workerJob,
      };
    }

    if (result?.status === "failed") {
      const updated = await updateProject(project.id, (item) => ({
        ...item,
        status: "failed",
        updatedAt: new Date().toISOString(),
        workerJob: {
          id: item.workerJob?.id ?? `job-${item.id}`,
          provider: item.workerJob?.provider ?? result.provider,
          status: "failed",
          progress: item.workerJob?.progress ?? 0,
          stage: "Recovered failed heavy worker result",
          payloadPath: item.workerJob?.payloadPath,
          resultPath: item.workerJob?.resultPath,
          startedAt: item.workerJob?.startedAt,
          completedAt: result.completedAt,
          error: result.error,
        },
      }));
      if (!updated) {
        return null;
      }
      return {
        slug: updated.slug,
        status: updated.status,
        renderMode: updated.renderMode,
        processedVideoUrl: updated.processedVideoUrl,
        workerJob: updated.workerJob,
      };
    }

    if (!activeJobs.has(project.id) && project.workerJob.payloadPath) {
      void startHeavyGeneration(project.id);
    }
  }

  return {
    slug: project.slug,
    status: project.status,
    renderMode: project.renderMode,
    processedVideoUrl: project.processedVideoUrl,
    workerJob: project.workerJob,
  };
}
