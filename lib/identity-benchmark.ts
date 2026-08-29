import type { MovieFeedback } from "@/lib/movie-feedback";
import type { MovieProject } from "@/lib/types";

export type IdentityBenchmarkRow = {
  model: string;
  samples: number;
  passingSamples: number;
  reviewSamples: number;
  averageAutomatedScore: number | null;
  averageFaceDetectionRate: number | null;
  averageUserIdentityRating: number | null;
  userRatings: number;
  readyForRecommendationDecision: boolean;
};

function average(values: number[]) {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : null;
}

export function buildIdentityBenchmark(
  projects: MovieProject[],
  feedback: MovieFeedback[],
  minimumSamples = 5,
): IdentityBenchmarkRow[] {
  const feedbackByProject = new Map(feedback.map((item) => [item.projectId, item]));
  const groups = new Map<
    string,
    {
      scores: number[];
      detectionRates: number[];
      identityRatings: number[];
      passingSamples: number;
      reviewSamples: number;
    }
  >();

  for (const project of projects) {
    const report = project.workerJob?.qualityReport;
    if (!report) continue;
    const model = report.model || project.workerJob?.model || project.workerJob?.provider || "unknown";
    const group = groups.get(model) ?? {
      scores: [],
      detectionRates: [],
      identityRatings: [],
      passingSamples: 0,
      reviewSamples: 0,
    };
    if (typeof report.identity.score === "number") group.scores.push(report.identity.score);
    if (typeof report.identity.faceDetectionRate === "number") {
      group.detectionRates.push(report.identity.faceDetectionRate);
    }
    if (report.identity.status === "pass") group.passingSamples += 1;
    else group.reviewSamples += 1;

    const projectFeedback = feedbackByProject.get(project.id);
    if (projectFeedback) group.identityRatings.push(projectFeedback.identityRating);
    groups.set(model, group);
  }

  return [...groups.entries()]
    .map(([model, group]) => {
      const samples = group.passingSamples + group.reviewSamples;
      return {
        model,
        samples,
        passingSamples: group.passingSamples,
        reviewSamples: group.reviewSamples,
        averageAutomatedScore: average(group.scores),
        averageFaceDetectionRate: average(group.detectionRates),
        averageUserIdentityRating: average(group.identityRatings),
        userRatings: group.identityRatings.length,
        readyForRecommendationDecision: samples >= minimumSamples && group.identityRatings.length >= minimumSamples,
      };
    })
    .sort((left, right) => right.samples - left.samples || left.model.localeCompare(right.model));
}
