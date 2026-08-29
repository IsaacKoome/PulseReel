import type { CameraMode, HeavyRenderProviderId, MovieProject, RenderMode } from "@/lib/types";
import {
  createHeavyJobFiles,
  enqueueRemoteModelBackendJob,
  pollRemoteModelBackendJob,
  readHeavyJobResult,
  readHeavyJobPayload,
  remoteStatusUrlForJob,
  updateHeavyJobStatus,
  writeHeavyJobResult,
} from "@/lib/heavy-job-runner";
import { getHeavyRenderProvider } from "@/lib/heavy-renderers";
import { createMovieProjectDraft } from "@/lib/pipeline";
import { addProject, getProjectById, getProjectBySlug, updateProject } from "@/lib/store";
import { syncGenerationReservationForProject } from "@/lib/generation-access";

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
  cameraMode: CameraMode;
  renderMode: Exclude<RenderMode, "seedance-2-fast">;
  heavyProvider?: HeavyRenderProviderId;
  sourceVideoUrl: string;
  sourceImageUrl?: string;
  ownerId?: string;
  visibility?: "public" | "unlisted";
  deleteTokenHash?: string;
}, options: { autoStart?: boolean } = {}) {
  const { heavyProvider, ownerId, visibility, deleteTokenHash, ...projectInput } = input;
  const provider = getHeavyRenderProvider(heavyProvider);
  const project = await createMovieProjectDraft({
    ...projectInput,
    status: "processing",
  });
  project.ownerId = ownerId;
  project.visibility = visibility;
  project.deleteTokenHash = deleteTokenHash;

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

export async function enqueueHeavyGeneration(projectOrId: MovieProject | string) {
  const project = typeof projectOrId === "string" ? await getProjectById(projectOrId) : projectOrId;
  if (!project?.workerJob?.payloadPath || !project.workerJob.resultPath) {
    throw new Error("Heavy job files were not prepared.");
  }

  const statusPath = project.workerJob.payloadPath.replace(/payload\.json$/, "status.json");
  const queued = await enqueueRemoteModelBackendJob({
    payloadPath: project.workerJob.payloadPath,
    resultPath: project.workerJob.resultPath,
    statusPath,
  });

  if (!queued) {
    void startHeavyGeneration(project.id);
    return project;
  }

  await updateHeavyJobStatus(statusPath, {
    provider: project.workerJob.provider,
    status: queued.status,
    stage: queued.stage ?? "Remote worker accepted the movie job",
    progress: queued.progress ?? 12,
  });

  const updated = await updateProject(project.id, (item) => ({
    ...item,
    status: "processing",
    updatedAt: new Date().toISOString(),
    workerJob: {
      id: item.workerJob?.id ?? `job-${item.id}`,
      provider: item.workerJob?.provider ?? project.workerJob!.provider,
      status: queued.status,
      progress: queued.progress ?? 12,
      stage: queued.stage ?? "Remote worker accepted the movie job",
      payloadPath: item.workerJob?.payloadPath,
      resultPath: item.workerJob?.resultPath,
      remoteJobId: queued.jobId,
      remoteStatusUrl: queued.statusUrl,
      startedAt: item.workerJob?.startedAt ?? new Date().toISOString(),
    },
  }));

  return updated ?? project;
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
    const { processedVideoUrl, shotPlan, model, qualityReport } = await provider.render(
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
      model,
      qualityReport,
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
        model: model ?? item.workerJob?.model,
        qualityReport: qualityReport ?? item.workerJob?.qualityReport,
        status: "completed",
        progress: 100,
        stage: `${provider.label} movie ready`,
        payloadPath: item.workerJob?.payloadPath,
        resultPath: item.workerJob?.resultPath,
        startedAt: item.workerJob?.startedAt ?? new Date().toISOString(),
        completedAt: new Date().toISOString(),
      },
    }));
    await syncGenerationReservationForProject(projectId, "completed");
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
    await syncGenerationReservationForProject(projectId, "failed");
  } finally {
    activeJobs.delete(projectId);
  }
}

export async function getProjectStatus(slug: string) {
  const project = await getProjectBySlug(slug);
  if (!project) {
    return null;
  }

  const derivedRemoteStatusUrl =
    project.workerJob?.remoteStatusUrl ??
    (project.workerJob?.id ? remoteStatusUrlForJob(project.workerJob.id) : null);

  if (
    derivedRemoteStatusUrl &&
    project.status === "processing"
  ) {
    try {
      const remote = await pollRemoteModelBackendJob(derivedRemoteStatusUrl);

      if (remote.status === "completed" && remote.processedVideoUrl) {
        const updated = await updateProject(project.id, (item) => ({
          ...item,
          status: "published",
          processedVideoUrl: remote.processedVideoUrl ?? item.processedVideoUrl,
          shotPlan: remote.shotPlan ?? item.shotPlan,
          updatedAt: new Date().toISOString(),
          workerJob: {
            id: item.workerJob?.id ?? `job-${item.id}`,
            provider: item.workerJob?.provider ?? project.workerJob!.provider,
            model: remote.model ?? item.workerJob?.model,
            qualityReport: remote.qualityReport ?? item.workerJob?.qualityReport,
            status: "completed",
            progress: 100,
            stage: "Remote worker movie ready",
            payloadPath: item.workerJob?.payloadPath,
            resultPath: item.workerJob?.resultPath,
            remoteJobId: item.workerJob?.remoteJobId ?? remote.jobId,
            remoteStatusUrl: item.workerJob?.remoteStatusUrl ?? derivedRemoteStatusUrl,
            startedAt: item.workerJob?.startedAt,
            completedAt: new Date().toISOString(),
          },
        }));
        if (!updated) {
          return null;
        }
        await syncGenerationReservationForProject(project.id, "completed");
        return {
          slug: updated.slug,
          status: updated.status,
          renderMode: updated.renderMode,
          processedVideoUrl: updated.processedVideoUrl,
          workerJob: updated.workerJob,
        };
      }

      if (remote.status === "failed") {
        const updated = await updateProject(project.id, (item) => ({
          ...item,
          status: "failed",
          updatedAt: new Date().toISOString(),
          workerJob: {
            id: item.workerJob?.id ?? `job-${item.id}`,
            provider: item.workerJob?.provider ?? project.workerJob!.provider,
            status: "failed",
            progress: item.workerJob?.progress ?? 0,
            stage: "Remote worker failed",
            payloadPath: item.workerJob?.payloadPath,
            resultPath: item.workerJob?.resultPath,
            remoteJobId: item.workerJob?.remoteJobId ?? remote.jobId,
            remoteStatusUrl: item.workerJob?.remoteStatusUrl ?? derivedRemoteStatusUrl,
            startedAt: item.workerJob?.startedAt,
            completedAt: new Date().toISOString(),
            error: remote.error || "Remote worker failed before returning a playable video.",
          },
        }));
        if (!updated) {
          return null;
        }
        await syncGenerationReservationForProject(project.id, "failed");
        return {
          slug: updated.slug,
          status: updated.status,
          renderMode: updated.renderMode,
          processedVideoUrl: updated.processedVideoUrl,
          workerJob: updated.workerJob,
        };
      }

      const updated = await updateProject(project.id, (item) => ({
        ...item,
        status: "processing",
        updatedAt: new Date().toISOString(),
        workerJob: {
          id: item.workerJob?.id ?? `job-${item.id}`,
          provider: item.workerJob?.provider ?? project.workerJob!.provider,
          status: remote.status === "running" ? "running" : "queued",
          progress: remote.progress ?? item.workerJob?.progress ?? 12,
          stage: remote.stage ?? item.workerJob?.stage ?? "Remote worker is rendering",
          payloadPath: item.workerJob?.payloadPath,
          resultPath: item.workerJob?.resultPath,
          remoteJobId: item.workerJob?.remoteJobId ?? remote.jobId,
          remoteStatusUrl: item.workerJob?.remoteStatusUrl ?? derivedRemoteStatusUrl,
          startedAt: item.workerJob?.startedAt,
        },
      }));
      if (updated) {
        return {
          slug: updated.slug,
          status: updated.status,
          renderMode: updated.renderMode,
          processedVideoUrl: updated.processedVideoUrl,
          workerJob: updated.workerJob,
        };
      }
    } catch (error) {
      const updated = await updateProject(project.id, (item) => ({
        ...item,
        workerJob: {
          id: item.workerJob?.id ?? `job-${item.id}`,
          provider: item.workerJob?.provider ?? project.workerJob!.provider,
          status: item.workerJob?.status ?? "running",
          progress: item.workerJob?.progress ?? 12,
          stage: "Waiting for remote worker status",
          payloadPath: item.workerJob?.payloadPath,
          resultPath: item.workerJob?.resultPath,
          remoteJobId: item.workerJob?.remoteJobId,
          remoteStatusUrl: item.workerJob?.remoteStatusUrl ?? derivedRemoteStatusUrl ?? undefined,
          startedAt: item.workerJob?.startedAt,
          error: error instanceof Error ? error.message : "Could not reach remote worker status.",
        },
      }));
      if (updated) {
        return {
          slug: updated.slug,
          status: updated.status,
          renderMode: updated.renderMode,
          processedVideoUrl: updated.processedVideoUrl,
          workerJob: updated.workerJob,
        };
      }
    }
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
          model: result.model ?? item.workerJob?.model,
          qualityReport: result.qualityReport ?? item.workerJob?.qualityReport,
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
      await syncGenerationReservationForProject(project.id, "completed");
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
      await syncGenerationReservationForProject(project.id, "failed");
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
