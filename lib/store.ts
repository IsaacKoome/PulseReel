import { promises as fs } from "fs";
import path from "path";
import { get, put } from "@vercel/blob";
import { createSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/admin";
import type { MovieProject } from "@/lib/types";
import { getRuntimeDataDir, isVercelRuntime } from "@/lib/runtime-storage";

const dataDir = getRuntimeDataDir();
const dataFile = path.join(dataDir, "projects.json");
const blobStoreKey = "pulsereel/projects.json";
const blobAccessCandidates = ["private", "public"] as const;

function canUseBlobStore() {
  return isVercelRuntime() && Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

function canUseSupabaseStore() {
  if (process.env.PULSEREEL_SUPABASE_STORE_ENABLED !== "true") {
    return false;
  }
  if (!isSupabaseAdminConfigured()) {
    throw new Error(
      "PULSEREEL_SUPABASE_STORE_ENABLED requires SUPABASE_SERVICE_ROLE_KEY.",
    );
  }
  return true;
}

function projectRow(project: MovieProject) {
  return {
    id: project.id,
    slug: project.slug,
    owner_id: project.ownerId ?? null,
    visibility: project.visibility ?? (project.ownerId ? "unlisted" : "public"),
    status: project.status,
    project,
    created_at: project.createdAt,
    updated_at: project.updatedAt,
  };
}

async function upsertSupabaseProject(project: MovieProject) {
  const supabase = createSupabaseAdminClient();
  const { error } = await supabase
    .from("pulse_reel_projects")
    .upsert(projectRow(project), { onConflict: "id" });

  if (error) {
    throw new Error(`PulseReel database write failed: ${error.message}`);
  }
}

async function ensureStore() {
  await fs.mkdir(dataDir, { recursive: true });
  try {
    await fs.access(dataFile);
  } catch {
    await fs.writeFile(dataFile, "[]", "utf8");
  }
}

export async function getProjects(): Promise<MovieProject[]> {
  if (canUseSupabaseStore()) {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("pulse_reel_projects")
      .select("project")
      .order("created_at", { ascending: false });

    if (error) {
      throw new Error(`PulseReel database read failed: ${error.message}`);
    }

    return (data ?? []).map((row) => row.project as MovieProject);
  }

  if (canUseBlobStore()) {
    for (const access of blobAccessCandidates) {
      try {
        const result = await get(blobStoreKey, {
          access,
          ...(access === "private" ? { useCache: false } : {}),
        });
        if (!result?.stream) {
          continue;
        }

        const raw = await new Response(result.stream).text();
        const items = JSON.parse(raw) as MovieProject[];
        return items.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
      } catch (error) {
        if (access === "public") {
          console.warn("Falling back to local project store after Blob read failed.", error);
        }
      }
    }
  }

  await ensureStore();
  const raw = await fs.readFile(dataFile, "utf8");
  const items = JSON.parse(raw) as MovieProject[];
  return items.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
}

export async function saveProjects(projects: MovieProject[]) {
  if (canUseBlobStore()) {
    for (const access of blobAccessCandidates) {
      try {
        await put(blobStoreKey, JSON.stringify(projects, null, 2), {
          access,
          addRandomSuffix: false,
          allowOverwrite: true,
          cacheControlMaxAge: 60,
          contentType: "application/json",
        });
        return;
      } catch (error) {
        if (access === "public") {
          console.warn("Falling back to local project store after Blob write failed.", error);
        }
      }
    }
  }

  await ensureStore();
  await fs.writeFile(dataFile, JSON.stringify(projects, null, 2), "utf8");
}

export async function addProject(project: MovieProject) {
  if (canUseSupabaseStore()) {
    await upsertSupabaseProject(project);
    return project;
  }

  const projects = await getProjects();
  projects.unshift(project);
  await saveProjects(projects);
  return project;
}

export async function getProjectBySlug(slug: string) {
  const projects = await getProjects();
  return projects.find((project) => project.slug === slug) ?? null;
}

export async function getProjectById(projectId: string) {
  const projects = await getProjects();
  return projects.find((project) => project.id === projectId) ?? null;
}

export async function updateProject(projectId: string, updater: (project: MovieProject) => MovieProject) {
  if (canUseSupabaseStore()) {
    const project = await getProjectById(projectId);
    if (!project) {
      return null;
    }
    const updated = updater(project);
    await upsertSupabaseProject(updated);
    return updated;
  }

  const projects = await getProjects();
  const index = projects.findIndex((project) => project.id === projectId);
  if (index === -1) {
    return null;
  }

  const updated = updater(projects[index]);
  projects[index] = updated;
  await saveProjects(projects);
  return updated;
}

export async function deleteProjectBySlug(slug: string) {
  if (canUseSupabaseStore()) {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("pulse_reel_projects")
      .delete()
      .eq("slug", slug)
      .select("id")
      .maybeSingle();

    if (error) {
      throw new Error(`PulseReel database deletion failed: ${error.message}`);
    }
    return Boolean(data);
  }

  const projects = await getProjects();
  const remaining = projects.filter((project) => project.slug !== slug);
  if (remaining.length === projects.length) {
    return false;
  }

  await saveProjects(remaining);
  return true;
}
