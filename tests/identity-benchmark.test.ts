import assert from "node:assert/strict";
import test from "node:test";
import { buildIdentityBenchmark } from "../lib/identity-benchmark.ts";
import type { MovieFeedback } from "../lib/movie-feedback.ts";
import type { IdentityQualityReport, MovieProject } from "../lib/types.ts";

function report(model: string, status: "pass" | "review", score: number): IdentityQualityReport {
  return {
    version: "identity-quality-v2",
    provider: "replicate-video-adapter",
    model,
    elapsedSeconds: 12,
    normalization: {
      requestedAspectRatio: "9:16",
      strategy: "blurred-background",
      source: { width: 960, height: 960, durationSeconds: 5, hasAudio: true },
      final: { width: 720, height: 1280, durationSeconds: 5, hasAudio: true },
    },
    identity: {
      status,
      score,
      sampledFrames: 8,
      faceDetectionRate: 0.875,
      anchorSimilarity: 0.8,
      temporalConsistency: 0.82,
      landmarkStability: 0.78,
      eyeReadabilityRate: 0.75,
      flags: status === "pass" ? [] : ["Review this movie."],
    },
  };
}

function project(id: string, model: string, status: "pass" | "review", score: number) {
  return {
    id,
    workerJob: { qualityReport: report(model, status, score), model },
  } as MovieProject;
}

function feedback(projectId: string, identityRating: number) {
  return { projectId, identityRating } as MovieFeedback;
}

test("benchmark keeps recommendation gated until five checked and rated samples", () => {
  const projects = [
    project("a", "seedance", "pass", 0.9),
    project("b", "seedance", "pass", 0.8),
    project("c", "seedance", "review", 0.7),
    project("d", "seedance", "pass", 0.9),
    project("e", "seedance", "pass", 0.85),
  ];

  const fourRatings = [feedback("a", 5), feedback("b", 4), feedback("c", 3), feedback("d", 5)];
  assert.equal(buildIdentityBenchmark(projects, fourRatings)[0].readyForRecommendationDecision, false);

  const fiveRatings = [...fourRatings, feedback("e", 4)];
  const row = buildIdentityBenchmark(projects, fiveRatings)[0];
  assert.equal(row.readyForRecommendationDecision, true);
  assert.equal(row.samples, 5);
  assert.equal(row.passingSamples, 4);
  assert.equal(row.reviewSamples, 1);
  assert.equal(row.averageUserIdentityRating, 4.2);
});
