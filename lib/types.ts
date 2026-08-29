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
  | "replicate-seedance-1.5-pro"
  | "replicate-kling-v3-omni"
  | "minimax-subject-adapter";

export type RenderMode = "fast-trailer" | "prompt-movie-beta" | "heavy-worker-beta" | "seedance-2-fast";

export type CameraMode = "cinematic" | "selfie";

export type IdentityQualityReport = {
  version: "identity-quality-v2" | string;
  provider: HeavyRenderProviderId | string;
  model: string;
  elapsedSeconds: number;
  anchor?: {
    version?: string;
    sampledFrames?: number;
    selectedOffsetSeconds?: number | null;
    selected?: {
      faceAware?: boolean;
      faceDetected?: boolean;
      faceCount?: number;
      eyeCount?: number;
      faceCoverage?: number;
      centeredness?: number;
      rank?: number;
    };
  } | null;
  normalization: {
    requestedAspectRatio: "9:16" | string;
    strategy: "native-portrait" | "blurred-background" | "unavailable" | string;
    source: {
      width: number;
      height: number;
      durationSeconds: number;
      hasAudio: boolean;
      [key: string]: unknown;
    };
    final: {
      width: number;
      height: number;
      durationSeconds: number;
      hasAudio: boolean;
      [key: string]: unknown;
    };
  };
  identity: {
    status: "pass" | "review" | string;
    score: number | null;
    sampledFrames: number;
    faceDetectionRate: number | null;
    anchorSimilarity: number | null;
    temporalConsistency: number | null;
    landmarkStability: number | null;
    eyeReadabilityRate: number | null;
    flags: string[];
  };
};

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
  cameraMode?: CameraMode;
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
  ownerId?: string;
  visibility?: "public" | "unlisted";
  deleteTokenHash?: string;
  workerJob?: {
    id: string;
    provider: HeavyRenderProviderId;
    providerUsed?: HeavyRenderProviderId | string;
    model?: string;
    qualityReport?: IdentityQualityReport;
    fallbackReason?: string;
    status: "queued" | "running" | "completed" | "failed";
    progress: number;
    stage: string;
    payloadPath?: string;
    resultPath?: string;
    remoteJobId?: string;
    remoteStatusUrl?: string;
    executionMode?: "local-worker" | "remote-worker" | "direct-replicate";
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
