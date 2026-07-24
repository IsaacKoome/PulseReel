import { NextResponse } from "next/server";
import { isManagedProject, isValidCreatorAdminToken } from "@/lib/creator-beta";
import { getProjects } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!process.env.PULSEREEL_CREATOR_BETA_ADMIN_TOKEN?.trim()) {
    return NextResponse.json(
      { error: "Creator Beta usage reporting is not configured." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (!isValidCreatorAdminToken(request.headers.get("x-pulsereel-admin-key"))) {
    return NextResponse.json(
      { error: "Invalid admin key." },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  const projects = await getProjects();
  const providerCounts: Record<string, number> = {};
  let managedEstimatedUsd = 0;
  let creatorEstimatedUsd = 0;

  for (const project of projects) {
    const provider = project.workerJob?.provider ?? "non-heavy";
    providerCounts[provider] = (providerCounts[provider] ?? 0) + 1;
    const estimate = project.estimatedUnitCostUsd ?? 0;
    if (isManagedProject(project)) managedEstimatedUsd += estimate;
    else creatorEstimatedUsd += estimate;
  }

  const startOfUtcDay = new Date().toISOString().slice(0, 10);
  const payload = {
    generatedAt: new Date().toISOString(),
    totals: {
      all: projects.length,
      completed: projects.filter((project) => project.status === "published").length,
      processing: projects.filter((project) => project.status === "processing").length,
      failed: projects.filter((project) => project.status === "failed").length,
      private: projects.filter((project) => project.visibility === "private").length,
      public: projects.filter((project) => project.visibility !== "private").length,
      managed: projects.filter(isManagedProject).length,
      creatorFunded: projects.filter((project) => !isManagedProject(project)).length,
      managedToday: projects.filter(
        (project) => project.createdAt.startsWith(startOfUtcDay) && isManagedProject(project),
      ).length,
    },
    estimatedCostUsd: {
      managed: Number(managedEstimatedUsd.toFixed(2)),
      creatorFunded: Number(creatorEstimatedUsd.toFixed(2)),
    },
    providerCounts,
  };

  return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
}
