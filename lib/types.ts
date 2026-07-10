export type StoryBeat = {
  heading: string;
  text: string;
};

export type ShotSpec = {
  id: string;
  label: string;
  title: string;
  prompt: string;
  durationSeconds: number;
  motionHint: string;
  composition: string;
  shotKind?: "establishing" | "observer" | "reaction" | "interaction" | "landmark" | "action" | "aftermath";
  subjectFraming?: "hero" | "hero-in-world" | "world-first" | "shared-frame";
  worldActivity?: "low" | "medium" | "high";
};

export type HeavyRenderProviderId =
  | "local-heavy-v1"
  | "open-model-adapter"
  | "replicate-video-adapter"
  | "minimax-subject-adapter";

export type RenderMode = "fast-trailer" | "prompt-movie-beta" | "heavy-worker-beta" | "seedance-2-fast";

export type MovieProject = {
  id: string;
  slug: string;
  creatorName: string;
  title: string;
  templateId: string;
  genre: string;
  premise: string;
  scenePrompt: string;
  persona: string;
  renderMode: RenderMode;
  status: "draft" | "processing" | "published" | "failed";
  createdAt: string;
  updatedAt: string;
  hook: string;
  openingShot: string;
  caption: string;
  beats: StoryBeat[];
  shotPlan: ShotSpec[];
  scenePrompts: string[];
  posterUrl: string;
  processedVideoUrl: string;
  sourceVideoUrl: string;
  sourceImageUrl?: string;
  workerJob?: {
    id: string;
    provider: HeavyRenderProviderId;
    providerUsed?: HeavyRenderProviderId | string;
    model?: string;
    fallbackReason?: string;
    status: "queued" | "running" | "completed" | "failed";
    progress: number;
    stage: string;
    payloadPath?: string;
    resultPath?: string;
    remoteJobId?: string;
    remoteStatusUrl?: string;
    startedAt?: string;
    completedAt?: string;
    error?: string;
  };
  metrics: {
    plays: number;
    likes: number;
    shares: number;
  };
};
