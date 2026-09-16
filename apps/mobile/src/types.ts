export type MovieProject = {
  id: string;
  slug: string;
  creatorName: string;
  title: string;
  genre: string;
  premise: string;
  caption: string;
  status: "draft" | "processing" | "published" | "failed";
  visibility?: "public" | "unlisted";
  posterUrl?: string;
  processedVideoUrl?: string;
  sourceVideoUrl?: string;
  creatorId?: string | null;
  createdAt: string;
  metrics: {
    plays: number;
    likes: number;
    shares: number;
    comments?: number;
  };
  viewer?: {
    liked: boolean;
    following: boolean;
    owns: boolean;
  };
  workerJob?: {
    progress: number;
    stage: string;
    error?: string;
  };
};

export type MovieComment = {
  id: string;
  body: string;
  authorName: string;
  createdAt: string;
};

export type GenerationAccess = {
  reason?: string;
  message?: string;
  eligible?: boolean;
  paidAttemptsRemaining?: number | null;
  remainingAttempts?: number | null;
};

export type BillingStatus = {
  attempts: number;
  ready: boolean;
  offer: {
    attempts: number;
    amount: number;
    currency: string;
    approximateUsd: number;
  };
};
