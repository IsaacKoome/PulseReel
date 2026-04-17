import { promises as fs } from "fs";
import path from "path";
import type { MovieProject } from "@/lib/types";

const dataDir = path.join(process.cwd(), "data");
const dataFile = path.join(dataDir, "projects.json");

async function ensureStore() {
  await fs.mkdir(dataDir, { recursive: true });
  try {
    await fs.access(dataFile);
  } catch {
    await fs.writeFile(dataFile, "[]", "utf8");
  }
}

export async function getProjects(): Promise<MovieProject[]> {
  await ensureStore();
  const raw = await fs.readFile(dataFile, "utf8");
  const items = JSON.parse(raw) as MovieProject[];
  return items.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
}

export async function saveProjects(projects: MovieProject[]) {
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
