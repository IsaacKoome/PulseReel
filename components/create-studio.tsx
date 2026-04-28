"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { movieTemplates } from "@/data/templates";
import type { MovieProject } from "@/lib/types";

type RenderMode = "fast-trailer" | "prompt-movie-beta" | "heavy-worker-beta";

type StatusState = {
  tone: "idle" | "success" | "error";
  message: string;
};

type BackendCapabilities = {
  heavyProvider: string;
  pythonExecutableConfigured: boolean;
  pythonBridgeReady: boolean;
  pythonExecutablePath?: string;
  customBackendCommandConfigured: boolean;
  remoteModelBackendConfigured: boolean;
  remoteModelBackendReachable: boolean;
  remoteModelBackendMode?: string;
  remoteModelBackendComfyUiConfigured: boolean;
  remoteModelBackendDurableStorageConfigured: boolean;
  comfyUiInstallDetected: boolean;
  comfyUiVenvReady: boolean;
  comfyUiConfigured: boolean;
  comfyUiWorkflowExists: boolean;
  comfyUiServerReachable: boolean;
  comfyUiCheckpointReady: boolean;
  comfyUiCheckpointDir?: string;
  comfyUiAvailableCheckpoints: string[];
  comfyUiCanAutoStart: boolean;
  realModelBackendReady: boolean;
  activeHeavyPath: "fast-local" | "python-bridge" | "custom-backend-command" | "remote-model-backend" | "comfyui-backend";
  summary: string;
};

export function CreateStudio() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasPreviewRef = useRef<HTMLCanvasElement | null>(null);
  const cameraRetryRef = useRef<number | null>(null);
  const trackFramePendingRef = useRef(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState(movieTemplates[0].id);
  const [recordedVideo, setRecordedVideo] = useState<File | null>(null);
  const [selfieFile, setSelfieFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [selfieUrl, setSelfieUrl] = useState<string | null>(null);
  const [genre, setGenre] = useState(movieTemplates[0].genres[0]);
  const [renderMode, setRenderMode] = useState<RenderMode>("prompt-movie-beta");
  const [creationMode, setCreationMode] = useState<"quick" | "guided">("quick");
  const [quickPrompt, setQuickPrompt] = useState("");
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isPreviewReady, setIsPreviewReady] = useState(false);
  const [useCanvasPreview, setUseCanvasPreview] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [status, setStatus] = useState<StatusState>({ tone: "idle", message: "" });
  const [backendCapabilities, setBackendCapabilities] = useState<BackendCapabilities | null>(null);
  const [isEnsuringBackend, setIsEnsuringBackend] = useState(false);
  const selected = useMemo(
    () => movieTemplates.find((template) => template.id === selectedTemplate) ?? movieTemplates[0],
    [selectedTemplate],
  );

  function drawCanvasPreviewFrame() {
    const video = videoRef.current;
    const canvas = canvasPreviewRef.current;
    if (!video || !canvas || video.videoWidth <= 0 || video.videoHeight <= 0) {
      return false;
    }

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) {
      return false;
    }

    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    return true;
  }

  async function drawTrackFrameToCanvas(stream: MediaStream) {
    if (trackFramePendingRef.current) {
      return false;
    }

    const canvas = canvasPreviewRef.current;
    const track = stream.getVideoTracks()[0];
    const ImageCaptureCtor = (window as unknown as {
      ImageCapture?: new (track: MediaStreamTrack) => { grabFrame: () => Promise<ImageBitmap> };
    }).ImageCapture;

    if (!canvas || !track || !ImageCaptureCtor) {
      return false;
    }

    trackFramePendingRef.current = true;
    try {
      const frame = await new ImageCaptureCtor(track).grabFrame();
      canvas.width = frame.width;
      canvas.height = frame.height;
      const context = canvas.getContext("2d");
      if (!context) {
        frame.close();
        return false;
      }
      context.drawImage(frame, 0, 0, canvas.width, canvas.height);
      frame.close();
      return true;
    } catch {
      return false;
    } finally {
      trackFramePendingRef.current = false;
    }
  }

  function startCanvasPreviewLoop() {
    if (cameraRetryRef.current) {
      window.cancelAnimationFrame(cameraRetryRef.current);
    }

    const draw = () => {
      if (!streamRef.current || previewUrl || selfieUrl) {
        return;
      }

      if (drawCanvasPreviewFrame()) {
        setUseCanvasPreview(true);
        setIsPreviewReady(true);
      } else if (streamRef.current) {
        void drawTrackFrameToCanvas(streamRef.current).then((didDraw) => {
          if (didDraw) {
            setUseCanvasPreview(true);
            setIsPreviewReady(true);
          }
        });
      }

      cameraRetryRef.current = window.requestAnimationFrame(draw);
    };

    cameraRetryRef.current = window.requestAnimationFrame(draw);
  }

  async function attachStreamToPreview(stream: MediaStream, target?: HTMLVideoElement | null) {
    const element = target ?? videoRef.current;
    if (!element) {
      return;
    }

    element.muted = true;
    element.defaultMuted = true;
    element.autoplay = true;
    element.playsInline = true;
    setIsPreviewReady(false);

    if (element.srcObject !== stream) {
      element.srcObject = stream;
    }

    element.controls = false;
    element.onloadeddata = () => {
      setIsPreviewReady(true);
      void drawCanvasPreviewFrame();
    };
    element.oncanplay = () => {
      setIsPreviewReady(true);
      void drawCanvasPreviewFrame();
    };
    element.onplaying = () => {
      setIsPreviewReady(true);
      void drawCanvasPreviewFrame();
    };

    const playPreview = async () => {
      try {
        await element.play();
        setIsPreviewReady(true);
        startCanvasPreviewLoop();
      } catch {
        startCanvasPreviewLoop();
        return;
      }
    };

    if (element.readyState >= 2) {
      await playPreview();
      return;
    }

    await new Promise<void>((resolve) => {
      const onLoadedMetadata = () => {
        element.removeEventListener("loadedmetadata", onLoadedMetadata);
        void playPreview().finally(resolve);
      };
      element.addEventListener("loadedmetadata", onLoadedMetadata);
      window.setTimeout(() => {
        element.removeEventListener("loadedmetadata", onLoadedMetadata);
        void playPreview().finally(resolve);
      }, 400);
    });
  }

  function setVideoElement(element: HTMLVideoElement | null) {
    videoRef.current = element;
    if (element && streamRef.current && isCameraActive && !previewUrl && !selfieUrl) {
      void attachStreamToPreview(streamRef.current, element);
    }
  }

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/backend/capabilities", { cache: "no-store" });
        if (!response.ok) {
          return;
        }
        const payload = (await response.json()) as BackendCapabilities;
        setBackendCapabilities(payload);
      } catch {
        return;
      }
    })();
  }, []);

  useEffect(() => {
    if (
      !backendCapabilities ||
      isEnsuringBackend ||
      !backendCapabilities.comfyUiCanAutoStart ||
      backendCapabilities.comfyUiServerReachable
    ) {
      return;
    }

    setIsEnsuringBackend(true);
    void (async () => {
      try {
        const response = await fetch("/api/backend/ensure-comfyui", {
          method: "POST",
        });
        if (!response.ok) {
          return;
        }
        const payload = (await response.json()) as {
          capabilities?: BackendCapabilities;
          started?: boolean;
        };
        if (payload.capabilities) {
          setBackendCapabilities(payload.capabilities);
        }
        if (payload.started) {
          setStatus((current) =>
            current.tone === "error"
              ? current
              : { tone: "success", message: "Local ComfyUI server started in the background for heavier backend work." },
          );
        }
      } catch {
        return;
      } finally {
        setIsEnsuringBackend(false);
      }
    })();
  }, [backendCapabilities, isEnsuringBackend]);

  useEffect(() => {
    let isMounted = true;

    async function startCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "user",
            width: { ideal: 480 },
            height: { ideal: 640 },
            frameRate: { ideal: 15, max: 24 },
          },
          audio: false,
        });
        if (!isMounted) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        setIsCameraActive(true);
        setIsPreviewReady(false);
        setUseCanvasPreview(false);
        await attachStreamToPreview(stream);
      } catch {
        setIsCameraActive(false);
        setStatus({
          tone: "error",
          message: "Camera access was blocked. You can still upload a video manually below.",
        });
      }
    }

    void startCamera();

    return () => {
      isMounted = false;
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  async function startCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 480 },
          height: { ideal: 640 },
          frameRate: { ideal: 15, max: 24 },
        },
        audio: false,
      });
      streamRef.current = stream;
      setIsCameraActive(true);
      setIsPreviewReady(false);
      setUseCanvasPreview(false);
      await attachStreamToPreview(stream);
      setStatus({ tone: "success", message: "Camera is live. Recording only happens when you press record." });
    } catch {
      setIsCameraActive(false);
      setStatus({
        tone: "error",
        message: "Camera access was blocked. You can still upload a video manually below.",
      });
    }
  }

  useEffect(() => {
    if (!isCameraActive || previewUrl || selfieUrl || !streamRef.current) {
      return;
    }

    void attachStreamToPreview(streamRef.current);
  }, [isCameraActive, previewUrl, selfieUrl]);

  function stopCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setIsCameraActive(false);
    setIsPreviewReady(false);
    setUseCanvasPreview(false);
    if (cameraRetryRef.current) {
      window.cancelAnimationFrame(cameraRetryRef.current);
      cameraRetryRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
      if (selfieUrl) {
        URL.revokeObjectURL(selfieUrl);
      }
      if (cameraRetryRef.current) {
        window.cancelAnimationFrame(cameraRetryRef.current);
      }
    };
  }, [previewUrl, selfieUrl]);

  function startRecording() {
    if (!streamRef.current) {
      setStatus({ tone: "error", message: "No camera stream found. Upload a video instead." });
      return;
    }

    void attachStreamToPreview(streamRef.current);

    const recorder = new MediaRecorder(streamRef.current, {
      mimeType: MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
        ? "video/webm;codecs=vp9"
        : "video/webm",
      videoBitsPerSecond: 700_000,
    });

    chunksRef.current = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunksRef.current.push(event.data);
      }
    };
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "video/webm" });
      const file = new File([blob], "pulsereel-recording.webm", { type: blob.type });
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
      recorderRef.current = null;
      setRecordedVideo(file);
      setPreviewUrl(URL.createObjectURL(file));
      stopCamera();
      setStatus({
        tone: "success",
        message: "Clip captured. Recording has stopped and the camera was turned off so nothing continues in the background.",
      });
    };

    recorderRef.current = recorder;
    recorder.start();
    setIsRecording(true);
    setStatus({ tone: "idle", message: "Recording live. Hold your frame and give the story some energy." });

    window.setTimeout(() => {
      if (recorderRef.current?.state === "recording") {
        stopRecording();
      }
    }, 10000);
  }

  function stopRecording() {
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop();
    }
    setIsRecording(false);
  }

  function captureSelfie() {
    if (!videoRef.current || !isCameraActive) {
      setStatus({ tone: "error", message: "Turn the camera on first if you want to capture a selfie." });
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = videoRef.current.videoWidth || 720;
    canvas.height = videoRef.current.videoHeight || 1280;
    const context = canvas.getContext("2d");
    if (!context) return;

    context.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const file = new File([blob], "pulsereel-selfie.png", { type: "image/png" });
      if (selfieUrl) {
        URL.revokeObjectURL(selfieUrl);
      }
      setSelfieFile(file);
      setSelfieUrl(URL.createObjectURL(file));
      setStatus({ tone: "success", message: "Selfie locked in. It will be used for the movie package." });
    }, "image/png");
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const uploadInput = form.elements.namedItem("videoUpload") as HTMLInputElement | null;
    const uploaded = uploadInput?.files?.[0];
    const finalVideo = recordedVideo ?? uploaded ?? null;

    if (!finalVideo) {
      setStatus({
        tone: "error",
        message: "Record or upload a short video first so the app has footage to turn into a movie.",
      });
      return;
    }

    if (finalVideo.size > 4_000_000) {
      setStatus({
        tone: "error",
        message:
          "That video is too large for the current Vercel upload path. Record with the built-in 10s button or upload a clip under 4 MB.",
      });
      return;
    }

    formData.set("video", finalVideo);
    formData.set("templateId", selectedTemplate);
    formData.set("genre", genre);
    formData.set("renderMode", renderMode);
    formData.set("quickPrompt", creationMode === "quick" ? quickPrompt : "");
    if (selfieFile) {
      formData.set("selfie", selfieFile);
    }

    setIsSubmitting(true);
    setStatus({
      tone: "idle",
      message:
        renderMode === "heavy-worker-beta"
          ? "Queuing your heavy movie worker. You will land on a live status page while the motion render runs."
          : creationMode === "quick"
            ? "Processing your movie from the single prompt. This can take under a couple of minutes."
            : "Processing your movie package. This can take under a couple of minutes.",
    });

    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        body: formData,
      });
      const responseText = await response.text();
      let payload: { slug?: string; error?: string; project?: MovieProject } = {};
      try {
        payload = responseText ? JSON.parse(responseText) : {};
      } catch {
        payload = {
          error: response.ok
            ? "The server returned an empty response."
            : `The server returned ${response.status}. Check the Vercel function logs for the full backend error.`,
        };
      }

      if (!response.ok || !payload.slug) {
        throw new Error(payload.error || "The studio could not process that clip.");
      }

      if (payload.project) {
        window.localStorage.setItem(`pulsereel:project:${payload.slug}`, JSON.stringify(payload.project));
      }

      window.location.href = `/watch/${payload.slug}`;
    } catch (error) {
      setStatus({
        tone: "error",
        message: error instanceof Error ? error.message : "Something went wrong while creating your movie.",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="studio-layout" onSubmit={onSubmit}>
      <section className="studio-card glass">
        <p className="eyebrow-copy">Creator Studio</p>
        <h1 className="heading">Shoot yourself into the story</h1>
        <p className="subtle">
          Capture a vertical clip, grab a selfie still, then pair it with a cinematic template and a short
          idea. The current build now turns that into a composed trailer: generated scene cards, your cut-out
          hero image, a stylized action insert from your source clip, a poster, story beats, and a public watch page.
        </p>

        <div className="camera-shell">
          <div className="camera-stage">
            {previewUrl ? (
              <video className="camera-video camera-playback" src={previewUrl} controls playsInline />
            ) : selfieUrl ? (
              <img alt="Captured selfie preview" src={selfieUrl} />
            ) : (
              <>
                <video
                  className="camera-video camera-live"
                  ref={setVideoElement}
                  autoPlay
                  playsInline
                  muted
                  style={{ opacity: useCanvasPreview ? 0 : 1 }}
                />
                <canvas
                  className="camera-video camera-live"
                  ref={canvasPreviewRef}
                  style={{
                    display: useCanvasPreview ? "block" : "none",
                    position: "absolute",
                    inset: 0,
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                  }}
                />
              </>
            )}
            {isCameraActive && !previewUrl && !selfieUrl && !isPreviewReady ? (
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "grid",
                  placeItems: "center",
                  background: "rgba(2, 6, 23, 0.16)",
                  color: "rgba(244, 239, 230, 0.84)",
                  pointerEvents: "none",
                  fontSize: "0.95rem",
                }}
              >
                Starting camera preview...
              </div>
            ) : null}
            {isRecording ? (
              <div className="record-badge">
                <span className="dot" />
                Recording
              </div>
            ) : isCameraActive && !previewUrl ? (
              <div className="record-badge">
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 999,
                    background: "#67e8f9",
                    boxShadow: "0 0 18px rgba(103, 232, 249, 0.7)",
                  }}
                />
                Camera live, not recording
              </div>
            ) : null}
          </div>

          <div className="toolbar">
            {!isRecording ? (
              <button className="button" type="button" onClick={startRecording}>
                Record 10s Clip
              </button>
            ) : (
              <button className="button-secondary" type="button" onClick={stopRecording}>
                Stop Recording
              </button>
            )}
            {isCameraActive ? (
              <button className="button-secondary" type="button" onClick={stopCamera}>
                Turn Camera Off
              </button>
            ) : (
              <button className="button-secondary" type="button" onClick={() => void startCamera()}>
                Turn Camera On
              </button>
            )}
            <button className="button-secondary" type="button" onClick={captureSelfie}>
              Capture Selfie
            </button>
          </div>

          <label className="label">
            <span>Or upload a vertical clip. Selfie capture is strongly recommended for scene compositing.</span>
            <input className="input" name="videoUpload" type="file" accept="video/*" />
          </label>
        </div>
      </section>

      <section className="studio-card glass">
        <p className="eyebrow-copy">Story Design</p>
        <h2 className="heading" style={{ fontSize: "2.2rem" }}>
          Guided templates, not blank-page paralysis
        </h2>

        <div className="toolbar" style={{ marginTop: 12 }}>
          <button
            className={creationMode === "quick" ? "button" : "button-secondary"}
            type="button"
            onClick={() => setCreationMode("quick")}
          >
            Quick Prompt
          </button>
          <button
            className={creationMode === "guided" ? "button" : "button-secondary"}
            type="button"
            onClick={() => setCreationMode("guided")}
          >
            Guided Form
          </button>
        </div>

        <div className="template-grid" style={{ marginTop: 16 }}>
          {movieTemplates.map((template) => (
            <label
              className={`template-option ${template.id === selected.id ? "active" : ""}`}
              key={template.id}
            >
              <input
                checked={template.id === selected.id}
                name="templateChoice"
                onChange={() => {
                  setSelectedTemplate(template.id);
                  setGenre(template.genres[0]);
                }}
                type="radio"
                value={template.id}
              />
              <strong>{template.name}</strong>
              <p className="muted">{template.tagline}</p>
              <div className="pill-row">
                {template.genres.map((genre) => (
                  <span className="pill" key={genre}>
                    {genre}
                  </span>
                ))}
              </div>
            </label>
          ))}
        </div>

        {creationMode === "quick" ? (
          <div className="form-grid">
            <label className="label wide">
              <span>One simple prompt</span>
              <textarea
                className="textarea"
                name="quickPrompt"
                onChange={(event) => setQuickPrompt(event.target.value)}
                placeholder="Example: Mecon150 fights 5 gang members with kung fu in a forest and wins like a legend."
                required={creationMode === "quick"}
                value={quickPrompt}
              />
            </label>
            <label className="label">
              <span>Generation mode</span>
              <select
                className="select"
                name="renderMode"
                onChange={(event) => setRenderMode(event.target.value as RenderMode)}
                value={renderMode}
              >
                <option value="heavy-worker-beta">Heavy Worker Beta</option>
                <option value="prompt-movie-beta">Prompt Movie Beta</option>
                <option value="fast-trailer">Fast Trailer</option>
              </select>
            </label>
            <div className="panel" style={{ padding: 18 }}>
              <strong style={{ display: "block", marginBottom: 10 }}>What happens next</strong>
              <p className="muted" style={{ margin: 0 }}>
                The backend will infer the title, persona, genre, premise, and shot plan from your one prompt, then build the movie automatically.
                {renderMode === "heavy-worker-beta"
                  ? " Heavy mode queues a separate worker and updates the watch page live."
                  : ""}
              </p>
            </div>
          </div>
        ) : (
          <div className="form-grid">
          <label className="label">
            <span>Your creator name</span>
            <input className="input" name="creatorName" placeholder="Isaac K" required />
          </label>
          <label className="label">
            <span>Movie title</span>
            <input className="input" name="title" placeholder="I Refused To Stay Small" required />
          </label>
          <label className="label">
            <span>Genre</span>
            <input
              className="input"
              name="genre"
              onChange={(event) => setGenre(event.target.value)}
              placeholder="Motivation"
              value={genre}
            />
          </label>
          <label className="label">
            <span>Generation mode</span>
            <select
              className="select"
              name="renderMode"
              onChange={(event) => setRenderMode(event.target.value as RenderMode)}
              value={renderMode}
            >
              <option value="heavy-worker-beta">Heavy Worker Beta</option>
              <option value="prompt-movie-beta">Prompt Movie Beta</option>
              <option value="fast-trailer">Fast Trailer</option>
            </select>
          </label>
          <label className="label">
            <span>Main persona</span>
            <input className="input" name="persona" placeholder="Underdog hero with quiet confidence" required />
          </label>
          <label className="label wide">
            <span>Premise</span>
            <textarea
              className="textarea"
              name="premise"
              placeholder="I want this to feel like the moment an ordinary person decides they are done being underestimated."
              required
            />
          </label>
          <label className="label wide">
            <span>Scene direction</span>
            <textarea
              className="textarea"
              name="scenePrompt"
              placeholder="Slow build, dramatic energy, close-up intensity, city-at-night visuals, ending like a teaser trailer."
              required
            />
          </label>
          </div>
        )}

        {backendCapabilities ? (
          <div className="panel" style={{ marginTop: 16 }}>
            <strong style={{ display: "block", marginBottom: 10 }}>Backend Readiness</strong>
            <p className="muted" style={{ margin: "0 0 12px" }}>
              {backendCapabilities.summary}
            </p>
            <div className="pill-row">
              <span className="pill">Heavy provider: {backendCapabilities.heavyProvider}</span>
              <span className="pill">Active path: {backendCapabilities.activeHeavyPath}</span>
              <span className="pill">
                Real model backend: {backendCapabilities.realModelBackendReady ? "ready" : "not ready"}
              </span>
              {backendCapabilities.remoteModelBackendConfigured ? (
                <span className="pill">
                  Remote GPU worker: {backendCapabilities.remoteModelBackendReachable ? "reachable" : "offline"}
                </span>
              ) : null}
              {backendCapabilities.remoteModelBackendMode ? (
                <span className="pill">Remote mode: {backendCapabilities.remoteModelBackendMode}</span>
              ) : null}
              {backendCapabilities.remoteModelBackendComfyUiConfigured ? (
                <span className="pill">Remote ComfyUI: ready</span>
              ) : null}
              {backendCapabilities.remoteModelBackendConfigured ? (
                <span className="pill">
                  Durable storage: {backendCapabilities.remoteModelBackendDurableStorageConfigured ? "ready" : "missing"}
                </span>
              ) : null}
              <span className="pill">
                Python: {backendCapabilities.pythonExecutableConfigured ? "configured" : "not configured"}
              </span>
              <span className="pill">
                ComfyUI:
                {" "}
                {backendCapabilities.comfyUiConfigured
                  ? backendCapabilities.comfyUiWorkflowExists
                    ? backendCapabilities.comfyUiCheckpointReady
                      ? "ready"
                      : "checkpoint missing"
                    : "workflow missing"
                  : backendCapabilities.comfyUiInstallDetected
                    ? backendCapabilities.comfyUiVenvReady
                      ? "installed, url missing"
                      : "installed, venv incomplete"
                    : "not configured"}
              </span>
              {backendCapabilities.comfyUiInstallDetected ? (
                <span className="pill">ComfyUI app: installed</span>
              ) : null}
              {backendCapabilities.comfyUiVenvReady ? <span className="pill">ComfyUI env: ready</span> : null}
              {backendCapabilities.comfyUiConfigured ? (
                <span className="pill">
                  ComfyUI server: {backendCapabilities.comfyUiServerReachable ? "reachable" : "offline"}
                </span>
              ) : null}
              {isEnsuringBackend ? <span className="pill">Starting local ComfyUI...</span> : null}
            </div>
            {backendCapabilities.pythonExecutablePath ? (
              <p className="muted" style={{ margin: "12px 0 0" }}>
                Python path: {backendCapabilities.pythonExecutablePath}
              </p>
            ) : null}
            {backendCapabilities.comfyUiCheckpointDir ? (
              <p className="muted" style={{ margin: "8px 0 0" }}>
                Checkpoint folder: {backendCapabilities.comfyUiCheckpointDir}
              </p>
            ) : null}
            <p className="muted" style={{ margin: "8px 0 0" }}>
              {backendCapabilities.comfyUiAvailableCheckpoints.length > 0
                ? `Detected checkpoints: ${backendCapabilities.comfyUiAvailableCheckpoints.join(", ")}`
                : "No real ComfyUI checkpoint model detected yet. Drop a .safetensors, .ckpt, or .pt model into the checkpoint folder to activate real image generation."}
            </p>
          </div>
        ) : null}

        <div className={`status ${status.tone === "error" ? "error" : ""}`}>{status.message}</div>

        <div className="toolbar" style={{ marginTop: 16 }}>
          <button className="button" disabled={isSubmitting} type="submit">
            {isSubmitting ? "Generating..." : "Generate Movie"}
          </button>
          <span className="pill">Template runtime: {selected.runtimeLabel}</span>
          <span className="pill">
            {renderMode === "heavy-worker-beta"
              ? "Heavy worker beta"
              : renderMode === "prompt-movie-beta"
                ? "Prompt-to-movie beta"
                : "Fast trailer"}
          </span>
        </div>
      </section>
    </form>
  );
}
