"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { getTemplateById } from "@/data/templates";
import type { MovieProject } from "@/lib/types";

function readLocalProjects() {
  const projects: MovieProject[] = [];

  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (!key?.startsWith("pulsereel:project:")) {
      continue;
    }

    const raw = window.localStorage.getItem(key);
    if (!raw) {
      continue;
    }

    try {
      projects.push(JSON.parse(raw) as MovieProject);
    } catch {
      window.localStorage.removeItem(key);
    }
  }

  return projects;
}

function readOwnedMovieSlugs() {
  const slugs = new Set<string>();

  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (!key?.startsWith("pulsereel:delete-token:")) {
      continue;
    }

    const token = window.localStorage.getItem(key);
    if (token) {
      slugs.add(key.slice("pulsereel:delete-token:".length));
    }
  }

  return slugs;
}

export function RecentMovies({ initialProjects }: { initialProjects: MovieProject[] }) {
  const [localProjects, setLocalProjects] = useState<MovieProject[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [deletingSlug, setDeletingSlug] = useState<string | null>(null);
  const [deletedSlugs, setDeletedSlugs] = useState<Set<string>>(() => new Set());
  const [ownedMovieSlugs, setOwnedMovieSlugs] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    setLocalProjects(readLocalProjects());
    setOwnedMovieSlugs(readOwnedMovieSlugs());
    setLoaded(true);
  }, []);

  const projects = useMemo(() => {
    const bySlug = new Map<string, MovieProject>();
    [...localProjects, ...initialProjects].forEach((project) => {
      bySlug.set(project.slug, project);
    });

    return [...bySlug.values()]
      .filter((project) => project.status === "published" && !deletedSlugs.has(project.slug))
      .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
      .slice(0, 6);
  }, [deletedSlugs, initialProjects, localProjects]);

  if (!loaded && initialProjects.length === 0) {
    return null;
  }

  if (projects.length === 0) {
    return (
      <article className="feed-card glass" style={{ padding: 24 }}>
        <h3>No movies yet</h3>
        <p className="body-copy">Create the first PulseReel movie.</p>
        <Link className="button" href="/create">
          Start
        </Link>
      </article>
    );
  }

  async function deleteMovie(project: MovieProject) {
    const deleteToken = window.localStorage.getItem(`pulsereel:delete-token:${project.slug}`);
    if (!deleteToken) {
      return;
    }

    const confirmed = window.confirm(`Delete "${project.title}" from PulseReel?`);
    if (!confirmed) {
      return;
    }

    setDeletingSlug(project.slug);
    try {
      const response = await fetch(`/api/projects/${project.slug}`, {
        method: "DELETE",
        headers: { "X-PulseReel-Delete-Token": deleteToken },
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error || "Could not delete movie.");
      }

      window.localStorage.removeItem(`pulsereel:project:${project.slug}`);
      window.localStorage.removeItem(`pulsereel:delete-token:${project.slug}`);
      setLocalProjects((items) => items.filter((item) => item.slug !== project.slug));
      setDeletedSlugs((slugs) => new Set(slugs).add(project.slug));
      setOwnedMovieSlugs((slugs) => {
        const next = new Set(slugs);
        next.delete(project.slug);
        return next;
      });
    } catch (error) {
      alert(error instanceof Error ? error.message : "Could not delete movie.");
    } finally {
      setDeletingSlug(null);
    }
  }

  return (
    <>
      {projects.map((project) => {
        const template = getTemplateById(project.templateId);
        return (
          <article className="feed-card glass movie-card" key={project.id}>
            <Link className="movie-card-link" href={`/watch/${project.slug}`}>
              <div className="feed-art" style={{ background: `linear-gradient(140deg, ${template.palette[0]}, ${template.palette[1]} 52%, ${template.palette[2]})` }}>
                <div
                  style={{
                    position: "absolute",
                    inset: "auto 18px 18px",
                    zIndex: 2,
                  }}
                >
                  <strong style={{ fontSize: "1.2rem" }}>{project.title}</strong>
                  <p className="muted" style={{ margin: "6px 0 0" }}>
                    {project.creatorName}
                  </p>
                </div>
              </div>
              <div className="feed-copy">
                <h3>{project.title}</h3>
                <p>{project.creatorName}</p>
              </div>
            </Link>
            {ownedMovieSlugs.has(project.slug) ? (
              <button
                className="delete-movie-button"
                disabled={deletingSlug === project.slug}
                onClick={() => deleteMovie(project)}
                type="button"
              >
                {deletingSlug === project.slug ? "Deleting..." : "Delete"}
              </button>
            ) : null}
          </article>
        );
      })}
    </>
  );
}
