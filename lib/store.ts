import { promises as fs } from "fs";
import path from "path";
import { get, put } from "@vercel/blob";
import type { MovieProject } from "@/lib/types";
import { getRuntimeDataDir, isVercelRuntime } from "@/lib/runtime-storage";

const dataDir = getRuntimeDataDir();
const dataFile = path.join(dataDir, "projects.json");
const blobStoreKey = "pulsereel/projects.json";
const blobAccessCandidates = ["private", "public"] as const;

function canUseBlobStore() {
  return isVercelRuntime() && Boolean(process.env.BLOB_READ_WRITE_TOKEN);
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
  const projects = await getProjects();
  const remaining = projects.filter((project) => project.slug !== slug);
  if (remaining.length === projects.length) {
    return false;
  }

  await saveProjects(remaining);
  return true;
}
