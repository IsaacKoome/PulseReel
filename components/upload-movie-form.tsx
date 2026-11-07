"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";

async function readResult<T>(response: Response, fallback: string): Promise<T> {
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) throw new Error(data?.error || fallback);
  return data;
}

function post(url: string, body: unknown, method = "POST") {
  return fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

export function UploadMovieForm({ ownerId }: { ownerId: string }) {
  const [file, setFile] = useState<File>();
  const [preview, setPreview] = useState("");
  const [slug, setSlug] = useState("");
  const [published, setPublished] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const savedBlob = useRef("");

  useEffect(() => {
    if (!file) { setPreview(""); return; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file || busy || slug) return;
    const fields = new FormData(event.currentTarget);
    const title = String(fields.get("title") || "").trim();
    if (!title || fields.get("rights") !== "on") {
      setError("Add a title and confirm you have permission to share the video.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      if (!savedBlob.current) {
        const contentType = "video/mp4";
        const { uploadUrl } = await readResult<{ uploadUrl: string }>(await post("/api/uploads/mobile", {
          pathname: `pulsereel/source/${ownerId}/${crypto.randomUUID()}.mp4`, contentType, size: file.size,
        }), "Could not authorize the upload.");
        const blob = await readResult<{ url: string }>(await fetch(uploadUrl, {
          method: "PUT", headers: { "Content-Type": contentType }, body: file,
        }), "Could not upload the video.");
        savedBlob.current = blob.url;
      }
      const result = await readResult<{ slug: string }>(await post("/api/projects/upload", {
        videoBlobUrl: savedBlob.current, title, caption: String(fields.get("caption") || "").trim(), rightsConfirmed: true,
      }), "Could not save the video.");
      setSlug(result.slug);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Upload failed.");
    } finally { setBusy(false); }
  }

  async function publish() {
    if (!slug || busy || published) return;
    setBusy(true);
    setError("");
    try {
      await readResult(await post(`/api/projects/${encodeURIComponent(slug)}`, { visibility: "public" }, "PATCH"), "Could not publish the video.");
      setPublished(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Publishing failed.");
    } finally { setBusy(false); }
  }

  return (
    <div className="web-video-upload">
      {preview && <video src={preview} controls playsInline preload="metadata" aria-label="Preview your selected video" />}
      {!slug ? <form onSubmit={save}>
        <fieldset disabled={busy}>
          <label>MP4 video<input required type="file" accept="video/mp4,.mp4" onChange={(event) => {
            const selected = event.currentTarget.files?.[0];
            savedBlob.current = "";
            setFile(undefined);
            setError("");
            if (!selected) return;
            if (!/\.mp4$/i.test(selected.name) || !selected.size || selected.size > 100_000_000) {
              event.currentTarget.value = "";
              setError("Choose a non-empty MP4 up to 100 MB.");
              return;
            }
            setFile(selected);
          }} /></label>
          <label>Title<input name="title" maxLength={80} required /></label>
          <label>Caption (optional)<textarea name="caption" maxLength={500} rows={3} /></label>
          <label className="web-upload-rights"><input type="checkbox" name="rights" required /> I own this video or have permission to share it, including its music and the people shown.</label>
          <p>Your video won’t appear in the public feed until you publish it.</p>
          <button className="button" disabled={!file || busy}>{busy ? "Uploading and preparing…" : "Save & review"}</button>
        </fieldset>
      </form> : <div className="web-video-upload">
        <p role="status">{published ? "Published to the MimiScene feed." : "Saved and unlisted. Preview it above before publishing."}</p>
        {!published && <button className="button" type="button" disabled={busy} onClick={() => void publish()}>{busy ? "Publishing…" : "Publish to feed"}</button>}
        <Link className="button-secondary" href={`/watch/${slug}`}>View video</Link>
      </div>}
      {error && <p className="auth-error" role="alert">{error}</p>}
    </div>
  );
}
