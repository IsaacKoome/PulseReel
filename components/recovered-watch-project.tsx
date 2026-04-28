"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getTemplateById } from "@/data/templates";
import type { MovieProject } from "@/lib/types";

export function RecoveredWatchProject({ slug }: { slug: string }) {
  const [project, setProject] = useState<MovieProject | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(`pulsereel:project:${slug}`);
      if (raw) {
        setProject(JSON.parse(raw) as MovieProject);
      }
    } finally {
      setLoaded(true);
    }
  }, [slug]);

  if (!loaded) {
    return (
      <main className="watch-shell shell">
        <div className="watch-card glass" style={{ maxWidth: 760, margin: "12vh auto", textAlign: "center" }}>
          <p className="eyebrow-copy">Loading</p>
          <h1 className="heading">Finding your movie...</h1>
        </div>
      </main>
    );
  }

  if (!project) {
    return (
      <main className="watch-shell shell">
        <div className="watch-card glass" style={{ maxWidth: 760, margin: "12vh auto", textAlign: "center" }}>
          <p className="eyebrow-copy">Missing page</p>
          <h1 className="heading">That movie link does not exist yet.</h1>
          <p className="subtle">The browser could not recover a local movie snapshot for this link.</p>
          <div className="toolbar" style={{ justifyContent: "center", marginTop: 24 }}>
            <Link className="button" href="/create">Open Studio</Link>
            <Link className="button-secondary" href="/">Return Home</Link>
          </div>
        </div>
      </main>
    );
  }

  const template = getTemplateById(project.templateId);
  const isProcessing = project.status === "processing" || project.status === "draft";

  return (
    <main className="watch-shell shell">
      <div className="topbar">
        <Link className="button-secondary" href="/">Home</Link>
        <strong>{project.title}</strong>
      </div>

      <div className="watch-grid">
        <section className="watch-card glass">
          <p className="eyebrow-copy">{template.name}</p>
          <h1 className="heading" style={{ marginBottom: 10 }}>{project.title}</h1>
          <p className="subtle">By {project.creatorName}. {project.caption}</p>

          <div className="watch-video" style={{ marginTop: 18 }}>
            {isProcessing ? (
              <img alt={`${project.title} poster`} src={project.posterUrl} />
            ) : (
              <video controls playsInline poster={project.posterUrl} src={project.processedVideoUrl} />
            )}
          </div>

          <div className="panel" style={{ marginTop: 18 }}>
            <div className="pill-row" style={{ marginBottom: 12 }}>
              <span className="pill">{project.genre}</span>
              <span className="pill">{project.status === "published" ? "Published" : "Processing"}</span>
              <span className="pill">{project.renderMode}</span>
            </div>
            <p className="body-copy" style={{ marginTop: 0 }}>{project.premise}</p>
          </div>
        </section>

        <section className="watch-card glass">
          <div className="poster-card">
            <img alt={`${project.title} poster`} src={project.posterUrl} />
          </div>

          <div className="panel" style={{ marginTop: 18 }}>
            <h3>Scene Prompts</h3>
            <div className="pill-row" style={{ marginTop: 12 }}>
              {project.scenePrompts.map((prompt) => (
                <span className="pill" key={prompt}>{prompt}</span>
              ))}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
