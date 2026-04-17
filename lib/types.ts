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

export type HeavyRenderProviderId = "local-heavy-v1" | "open-model-adapter";

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
  renderMode: "fast-trailer" | "prompt-movie-beta" | "heavy-worker-beta";
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
    status: "queued" | "running" | "completed" | "failed";
    progress: number;
    stage: string;
    payloadPath?: string;
    resultPath?: string;
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
