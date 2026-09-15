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
  createdAt: string;
  metrics: {
    plays: number;
    likes: number;
    shares: number;
  };
  workerJob?: {
    progress: number;
    stage: string;
    error?: string;
  };
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
