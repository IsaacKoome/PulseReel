"use client";

import { upload } from "@vercel/blob/client";
import { useEffect, useRef, useState } from "react";
import { FREE_BETA_MANAGED_PROVIDER } from "@/lib/beta-config";
import type { BetaAccessStatus } from "@/lib/generation-access";
import { setProjectVideo } from "@/lib/project-submission";
import type { CameraMode, MovieProject, RenderMode } from "@/lib/types";

type ModelChoice =
  | "seedance-2-fast"
  | "local-heavy-v1"
  | "replicate-video-adapter"
  | "replicate-seedance-1.5-pro"
  | "replicate-kling-v3-omni";

type StatusState = {
  tone: "idle" | "success" | "error";
  message: string;
};

const COMPATIBILITY_TEMPLATE_ID = "identity-cinematic";
const COMPATIBILITY_GENRE = "Cinematic";

const cameraVideoConstraints: MediaTrackConstraints = {
  facingMode: "user",
  width: { ideal: 720 },
  height: { ideal: 1280 },
  frameRate: { ideal: 24, max: 30 },
};

function cleanStudioError(message: string) {
  if (/<!doctype html|<html|cloudflare|bad gateway|5xx-error-landing/i.test(message)) {
    return "Remote worker is offline or unreachable. Start the PulseReel worker on your PC, confirm the worker health URL opens, then try again.";
  }

  return message;
}

export function CreateStudio({
  initialBetaAccess,
  seedance15ExperimentEnabled = false,
  directVideoUploadEnabled = false,
  uploadOwnerId,
}: {
  initialBetaAccess: BetaAccessStatus;
  seedance15ExperimentEnabled?: boolean;
  directVideoUploadEnabled?: boolean;
  uploadOwnerId?: string;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasPreviewRef = useRef<HTMLCanvasElement | null>(null);
  const cameraRetryRef = useRef<number | null>(null);
  const trackFramePendingRef = useRef(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const [recordedVideo, setRecordedVideo] = useState<File | null>(null);
  const [selfieFile, setSelfieFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [selfieUrl, setSelfieUrl] = useState<string | null>(null);
  const [modelChoice, setModelChoice] = useState<ModelChoice>("replicate-video-adapter");
  const [cameraMode, setCameraMode] = useState<CameraMode>("cinematic");
  const [quickPrompt, setQuickPrompt] = useState("");
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isPreviewReady, setIsPreviewReady] = useState(false);
  const [useCanvasPreview, setUseCanvasPreview] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [status, setStatus] = useState<StatusState>({ tone: "idle", message: "" });
  const [betaAccess, setBetaAccess] = useState(initialBetaAccess);

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
    let isMounted = true;

    async function startCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: cameraVideoConstraints,
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
        video: cameraVideoConstraints,
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
      videoBitsPerSecond: 2_200_000,
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
        message: "Clip captured.",
      });
    };

    recorderRef.current = recorder;
    recorder.start();
    setIsRecording(true);
    setStatus({ tone: "idle", message: "Recording..." });

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
      const file = new File([blob], "pulsereel-identity.jpg", { type: "image/jpeg" });
      if (selfieUrl) {
        URL.revokeObjectURL(selfieUrl);
      }
      setSelfieFile(file);
      setSelfieUrl(URL.createObjectURL(file));
      setStatus({
        tone: "success",
        message: "Identity selfie captured. PulseReel will use this clear frame to preserve your face.",
      });
    }, "image/jpeg", 0.9);
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

    const canUploadDirectly = directVideoUploadEnabled && Boolean(uploadOwnerId);
    if (finalVideo.size > 50_000_000) {
      setStatus({
        tone: "error",
        message: "That clip is larger than the current 50 MB PulseReel upload limit.",
      });
      return;
    }
    if (!canUploadDirectly && finalVideo.size > 3_500_000) {
      setStatus({
        tone: "error",
        message:
          "That video is too large for this local upload path. Record with the built-in 10s button or upload a clip under 3.5 MB.",
      });
      return;
    }

    const usesManagedProvider = modelChoice !== "local-heavy-v1";
    const isSeedance15Experiment = modelChoice === "replicate-seedance-1.5-pro";
    if (
      usesManagedProvider &&
      betaAccess.controlsEnabled &&
      modelChoice !== FREE_BETA_MANAGED_PROVIDER &&
      !(isSeedance15Experiment && seedance15ExperimentEnabled)
    ) {
      setStatus({
        tone: "error",
        message: "The free beta currently supports Replicate AI · Recommended only.",
      });
      return;
    }
    if (usesManagedProvider && betaAccess.controlsEnabled && !isSeedance15Experiment) {
      setIsSubmitting(true);
      setStatus({ tone: "idle", message: "Checking your free beta movie..." });
      try {
        const eligibilityResponse = await fetch("/api/beta/status", { cache: "no-store" });
        const eligibility = (await eligibilityResponse.json()) as BetaAccessStatus;
        setBetaAccess(eligibility);
        if (!eligibilityResponse.ok || !eligibility.eligible) {
          throw new Error(eligibility.message || "This generation is not currently available.");
        }
        // The reservation is created at the start of the server request. Reflect it
        // immediately so the beta counter does not remain stale while generation waits.
        setBetaAccess({
          ...eligibility,
          eligible: false,
          reason: "free_generation_used",
          message: "Your free beta AI movie is being created.",
          totalAttemptCount:
            eligibility.totalAttemptCount === null ? null : eligibility.totalAttemptCount + 1,
          remainingAttempts:
            eligibility.remainingAttempts === null ? null : Math.max(0, eligibility.remainingAttempts - 1),
          reservationStatus: "reserved",
        });
      } catch (error) {
        setStatus({
          tone: "error",
          message: error instanceof Error ? error.message : "Could not check beta availability.",
        });
        setIsSubmitting(false);
        return;
      }
    }

    formData.set("templateId", COMPATIBILITY_TEMPLATE_ID);
    formData.set("cameraMode", cameraMode);
    formData.set("genre", COMPATIBILITY_GENRE);
    const renderMode: RenderMode = modelChoice === "seedance-2-fast" ? "seedance-2-fast" : "heavy-worker-beta";
    formData.set("renderMode", renderMode);
    if (modelChoice !== "seedance-2-fast") {
      formData.set("heavyProvider", modelChoice);
    }
    formData.set("quickPrompt", quickPrompt);
    if (selfieFile) {
      formData.set("selfie", selfieFile);
    }

    setIsSubmitting(true);
    setStatus({
      tone: "idle",
      message: "Creating your movie...",
    });

    try {
      if (canUploadDirectly && uploadOwnerId) {
        setStatus({ tone: "idle", message: "Uploading your clip securely..." });
        const extensionMatch = finalVideo.name.match(/\.[a-z0-9]{1,8}$/i);
        const fallbackExtension = finalVideo.type.includes("mp4") ? ".mp4" : ".webm";
        const pathname = `pulsereel/source/${uploadOwnerId}/${crypto.randomUUID()}${
          extensionMatch?.[0]?.toLowerCase() ?? fallbackExtension
        }`;
        const blob = await upload(pathname, finalVideo, {
          access: "public",
          handleUploadUrl: "/api/uploads",
          contentType: finalVideo.type || undefined,
          multipart: finalVideo.size > 4_500_000,
        });
        setProjectVideo(formData, finalVideo, blob.url);
        setStatus({ tone: "idle", message: "Creating your movie..." });
      } else {
        setProjectVideo(formData, finalVideo);
      }

      const response = await fetch("/api/projects", {
        method: "POST",
        body: formData,
      });
      const responseText = await response.text();
      let payload: { slug?: string; error?: string; project?: MovieProject; deleteToken?: string } = {};
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
      if (payload.deleteToken) {
        window.localStorage.setItem(`pulsereel:delete-token:${payload.slug}`, payload.deleteToken);
      }

      window.location.href = `/watch/${payload.slug}`;
    } catch (error) {
      if (usesManagedProvider && betaAccess.controlsEnabled) {
        try {
          const latestAccessResponse = await fetch("/api/beta/status", { cache: "no-store" });
          if (latestAccessResponse.ok) {
            setBetaAccess((await latestAccessResponse.json()) as BetaAccessStatus);
          }
        } catch {
          // Keep the generation error visible even if status reconciliation fails.
        }
      }
      setStatus({
        tone: "error",
        message:
          error instanceof Error
            ? cleanStudioError(error.message)
            : "Something went wrong while creating your movie.",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="studio-simple" onSubmit={onSubmit}>
      <section className="studio-card glass capture-panel">
        <div className="studio-section-title">
          <span>1</span>
          <h2>Your clip</h2>
        </div>
        <p className="capture-guidance">
          Face the camera in even light, keep your full face visible, and hold still briefly. For the strongest identity,
          capture an Identity selfie as well as the 10-second clip.
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
                Record 10s
              </button>
            ) : (
              <button className="button-secondary" type="button" onClick={stopRecording}>
                Stop
              </button>
            )}
            {isCameraActive ? (
              <button className="button-secondary" type="button" onClick={stopCamera}>
                Camera Off
              </button>
            ) : (
              <button className="button-secondary" type="button" onClick={() => void startCamera()}>
                Camera On
              </button>
            )}
            <button className="button-secondary" type="button" onClick={captureSelfie}>
              Identity selfie
            </button>
          </div>

          <label className="label">
            <span>Upload instead</span>
            <input className="input" name="videoUpload" type="file" accept="video/*" />
          </label>
        </div>
      </section>

      <section className="studio-card glass story-panel">
        <div className="studio-section-title">
          <span>2</span>
          <h2>Movie idea</h2>
        </div>

        <label className="label">
          <textarea
            className="textarea idea-box"
            name="quickPrompt"
            onChange={(event) => setQuickPrompt(event.target.value)}
            placeholder="Example: I am on an island with pirates and fishermen."
            required
            value={quickPrompt}
          />
        </label>

        <div className="studio-section-title compact">
          <span>3</span>
          <h2>Camera view</h2>
        </div>

        <div className="simple-template-list compact-list">
          <label className={`template-option ${cameraMode === "cinematic" ? "active" : ""}`}>
            <input
              checked={cameraMode === "cinematic"}
              name="cameraModeChoice"
              onChange={() => setCameraMode("cinematic")}
              type="radio"
              value="cinematic"
            />
            <span>Cinematic scene</span>
          </label>
          <label className={`template-option ${cameraMode === "selfie" ? "active" : ""}`}>
            <input
              checked={cameraMode === "selfie"}
              name="cameraModeChoice"
              onChange={() => setCameraMode("selfie")}
              type="radio"
              value="selfie"
            />
            <span>Selfie story</span>
          </label>
        </div>

        <p className="model-capability-note">
          {cameraMode === "cinematic"
            ? "Recommended for a movie look: another camera films you inside the scene."
            : "Front-camera storytelling: you stay in frame while revealing the world around you."}
        </p>

        <div className="studio-section-title compact">
          <span>4</span>
          <h2>Model</h2>
        </div>

        <div className="simple-template-list compact-list">
          <label className={`template-option ${modelChoice === "replicate-video-adapter" ? "active" : ""}`}>
            <input
              checked={modelChoice === "replicate-video-adapter"}
              name="modelChoice"
              onChange={() => setModelChoice("replicate-video-adapter")}
              type="radio"
              value="replicate-video-adapter"
            />
            <span>Replicate AI · Recommended</span>
          </label>
          <label className={`template-option ${modelChoice === "local-heavy-v1" ? "active" : ""}`}>
            <input
              checked={modelChoice === "local-heavy-v1"}
              name="modelChoice"
              onChange={() => setModelChoice("local-heavy-v1")}
              type="radio"
              value="local-heavy-v1"
            />
            <span>Local worker</span>
          </label>
          <label className={`template-option ${modelChoice === "replicate-kling-v3-omni" ? "active" : ""} ${betaAccess.controlsEnabled ? "disabled" : ""}`}>
            <input
              checked={modelChoice === "replicate-kling-v3-omni"}
              disabled={betaAccess.controlsEnabled}
              name="modelChoice"
              onChange={() => setModelChoice("replicate-kling-v3-omni")}
              type="radio"
              value="replicate-kling-v3-omni"
            />
            <span>Replicate Pro · Kling{betaAccess.controlsEnabled ? " · Not in free beta" : ""}</span>
          </label>
          <label className={`template-option ${modelChoice === "replicate-seedance-1.5-pro" ? "active" : ""} ${seedance15ExperimentEnabled ? "" : "disabled"}`}>
            <input
              checked={modelChoice === "replicate-seedance-1.5-pro"}
              disabled={!seedance15ExperimentEnabled}
              name="modelChoice"
              onChange={() => setModelChoice("replicate-seedance-1.5-pro")}
              type="radio"
              value="replicate-seedance-1.5-pro"
            />
            <span>
              Seedance 1.5 Pro{seedance15ExperimentEnabled ? " · Owner test" : " · Not in free beta"}
            </span>
          </label>
          <label className={`template-option ${modelChoice === "seedance-2-fast" ? "active" : ""} ${betaAccess.controlsEnabled ? "disabled" : ""}`}>
            <input
              checked={modelChoice === "seedance-2-fast"}
              disabled={betaAccess.controlsEnabled}
              name="modelChoice"
              onChange={() => setModelChoice("seedance-2-fast")}
              type="radio"
              value="seedance-2-fast"
            />
            <span>Seedance AI{betaAccess.controlsEnabled ? " · Not in free beta" : ""}</span>
          </label>
        </div>

        <p className="model-capability-note">
          {modelChoice === "replicate-video-adapter"
            ? "Recommended. The current MiniMax identity model creates a realistic 6-second silent clip."
            : modelChoice === "replicate-seedance-1.5-pro"
              ? "Owner cost experiment. Seedance 1.5 Pro creates a 5-second 720p portrait clip with native audio; estimated maximum model cost is $0.26."
            : modelChoice === "replicate-kling-v3-omni"
              ? "Experimental. Kling V3 Omni requests a 15-second portrait movie with native audio and costs more per run."
            : modelChoice === "local-heavy-v1"
              ? "Prototype renderer. It assembles a movie locally but is not a hosted generative video model."
              : "Hosted Seedance generation requires separate provider credit."}
        </p>

        {modelChoice === "replicate-seedance-1.5-pro" && seedance15ExperimentEnabled ? (
          <div className="beta-access-card available">
            <strong>Owner-only Seedance comparison</strong>
            <span>The public free beta remains paused. This test uses your Replicate balance.</span>
            <small>Fixed profile: 5 seconds · 720p · 9:16 · native audio · estimated up to $0.26.</small>
          </div>
        ) : betaAccess.controlsEnabled && modelChoice !== "local-heavy-v1" ? (
          <div className={`beta-access-card ${betaAccess.eligible ? "available" : "unavailable"}`}>
            <strong>{betaAccess.eligible ? "Your first AI movie is free" : "Free beta status"}</strong>
            <span>{betaAccess.message}</span>
            {betaAccess.remainingAttempts !== null ? (
              <small>{betaAccess.remainingAttempts} of {betaAccess.totalAttemptLimit} beta attempts remain.</small>
            ) : null}
          </div>
        ) : null}

        <div className={`status ${status.tone === "error" ? "error" : ""}`}>{status.message}</div>

        <div className="generate-row">
          <button
            className="button generate-button"
            disabled={
              isSubmitting ||
              (modelChoice !== "local-heavy-v1" &&
                modelChoice !== "replicate-seedance-1.5-pro" &&
                betaAccess.controlsEnabled &&
                !betaAccess.eligible)
            }
            type="submit"
          >
            {isSubmitting
              ? "Generating..."
              : modelChoice !== "local-heavy-v1" &&
                  modelChoice !== "replicate-seedance-1.5-pro" &&
                  betaAccess.controlsEnabled &&
                  !betaAccess.eligible
                ? "Generation unavailable"
                : "Generate Movie"}
          </button>
          <p className="generation-consent">
            By generating, you confirm that you have permission to use every person&apos;s identity in
            your uploads and agree to the <a href="/terms">Terms</a> and <a href="/identity-safety">Identity safety rules</a>.
          </p>
        </div>
      </section>
    </form>
  );
}
