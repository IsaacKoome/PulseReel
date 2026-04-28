"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { getTemplateById } from "@/data/templates";
import type { MovieProject } from "@/lib/types";
import { formatCompactNumber } from "@/lib/utils";

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

export function RecentMovies({ initialProjects }: { initialProjects: MovieProject[] }) {
  const [localProjects, setLocalProjects] = useState<MovieProject[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setLocalProjects(readLocalProjects());
    setLoaded(true);
  }, []);

  const projects = useMemo(() => {
    const bySlug = new Map<string, MovieProject>();
    [...localProjects, ...initialProjects].forEach((project) => {
      bySlug.set(project.slug, project);
    });

    return [...bySlug.values()]
      .filter((project) => project.status === "published")
      .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
      .slice(0, 6);
  }, [initialProjects, localProjects]);

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

  return (
    <>
      {projects.map((project) => {
        const template = getTemplateById(project.templateId);
        return (
          <Link className="feed-card glass" href={`/watch/${project.slug}`} key={project.id}>
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
              <p>{project.caption}</p>
              <div className="pill-row">
                <span className="pill">{project.genre}</span>
                <span className="pill">{formatCompactNumber(project.metrics.plays)} plays</span>
                <span className="pill">{formatCompactNumber(project.metrics.shares)} shares</span>
              </div>
            </div>
          </Link>
        );
      })}
    </>
  );
}
