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
    return "Movie generation is temporarily unavailable. Please try again shortly.";
  }

  return message;
}

async function extractIdentityFrameFromVideo(videoFile: File) {
  const objectUrl = URL.createObjectURL(videoFile);
  const video = document.createElement("video");
  video.preload = "auto";
  video.muted = true;
  video.playsInline = true;

  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(
        () => reject(new Error("The clip took too long to prepare an identity frame.")),
        12_000,
      );

      video.onerror = () => {
        window.clearTimeout(timeout);
        reject(new Error("MimiReel could not read this clip to preserve your identity."));
      };
      video.onloadeddata = () => {
        const duration = Number.isFinite(video.duration) ? video.duration : 0;
        const targetTime = duration > 0.25 ? Math.min(0.8, Math.max(0.1, duration * 0.2)) : 0;
        if (targetTime <= 0) {
          window.clearTimeout(timeout);
          resolve();
          return;
        }

        video.onseeked = () => {
          window.clearTimeout(timeout);
          resolve();
        };
        video.currentTime = targetTime;
      };
      video.src = objectUrl;
      video.load();
    });

    if (video.videoWidth <= 0 || video.videoHeight <= 0) {
      throw new Error("The selected clip did not contain a readable video frame.");
    }

    const maximumDimension = 1280;
    const scale = Math.min(1, maximumDimension / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("MimiReel could not prepare the creator identity frame.");
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (value) => value ? resolve(value) : reject(new Error("MimiReel could not encode the identity frame.")),
        "image/jpeg",
        0.88,
      );
    });
    return new File([blob], "mimireel-video-identity.jpg", { type: "image/jpeg" });
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(objectUrl);
  }
}

export function CreateStudio({
  initialBetaAccess,
  directVideoUploadEnabled = false,
  uploadOwnerId,
}: {
  initialBetaAccess: BetaAccessStatus;
  directVideoUploadEnabled?: boolean;
  uploadOwnerId?: string;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const mountedRef = useRef(true);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const canvasPreviewRef = useRef<HTMLCanvasElement | null>(null);
  const cameraRetryRef = useRef<number | null>(null);
  const trackFramePendingRef = useRef(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const [recordedVideo, setRecordedVideo] = useState<File | null>(null);
  const [selfieFile, setSelfieFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [modelChoice, setModelChoice] = useState<ModelChoice>(FREE_BETA_MANAGED_PROVIDER);
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
      if (!streamRef.current || previewUrl) {
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
    if (element && streamRef.current && isCameraActive && !previewUrl) {
      void attachStreamToPreview(streamRef.current, element);
    }
  }

  async function startCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: cameraVideoConstraints,
        audio: false,
      });
      if (!mountedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      if (uploadInputRef.current) uploadInputRef.current.value = "";
      setPreviewUrl(null);
      setRecordedVideo(null);
      setSelfieFile(null);
      streamRef.current = stream;
      setIsCameraActive(true);
      setIsPreviewReady(false);
      setUseCanvasPreview(false);
      await attachStreamToPreview(stream);
      setStatus({ tone: "success", message: "Camera is ready. Recording starts only when you press Record." });
    } catch {
      setIsCameraActive(false);
      setStatus({
        tone: "error",
        message: "Camera access was blocked. You can still upload a video manually below.",
      });
    }
  }

  useEffect(() => {
    if (!isCameraActive || previewUrl || !streamRef.current) {
      return;
    }

    void attachStreamToPreview(streamRef.current);
  }, [isCameraActive, previewUrl]);

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
    };
  }, [previewUrl]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      if (cameraRetryRef.current) window.cancelAnimationFrame(cameraRetryRef.current);
    };
  }, []);

  function chooseVideo(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const maxBytes = directVideoUploadEnabled && uploadOwnerId ? 50_000_000 : 3_500_000;
    if (file.size > maxBytes) {
      event.target.value = "";
      setStatus({
        tone: "error",
        message: `Choose a clip under ${maxBytes === 50_000_000 ? "50 MB" : "3.5 MB"}.`,
      });
      return;
    }
    stopCamera();
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setRecordedVideo(file);
    setPreviewUrl(URL.createObjectURL(file));
    setSelfieFile(null);
    setStatus({ tone: "success", message: "Clip selected. Add one scene idea to continue." });
  }

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
      const file = new File([blob], "mimireel-recording.webm", { type: blob.type });
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

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const finalVideo = recordedVideo;

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
        message: "That clip is larger than the current 50 MB MimiReel upload limit.",
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
    if (
      usesManagedProvider &&
      betaAccess.controlsEnabled &&
      modelChoice !== FREE_BETA_MANAGED_PROVIDER
    ) {
      setStatus({
        tone: "error",
        message: "The free beta currently supports Seedance 1.5 Pro · Recommended only.",
      });
      return;
    }

    let identityFile = selfieFile;
    if (!identityFile) {
      setIsSubmitting(true);
      setStatus({ tone: "idle", message: "Selecting a clear frame from your clip to preserve your identity..." });
      try {
        identityFile = await extractIdentityFrameFromVideo(finalVideo);
      } catch (error) {
        setStatus({
          tone: "error",
          message: error instanceof Error ? error.message : "MimiReel could not prepare your identity frame.",
        });
        setIsSubmitting(false);
        return;
      }
    }

    if (usesManagedProvider && betaAccess.controlsEnabled) {
      setIsSubmitting(true);
      setStatus({ tone: "idle", message: "Checking your available generation attempts..." });
      try {
        const eligibilityResponse = await fetch("/api/beta/status", { cache: "no-store" });
        const eligibility = (await eligibilityResponse.json()) as BetaAccessStatus;
        setBetaAccess(eligibility);
        if (!eligibilityResponse.ok || !eligibility.eligible) {
          throw new Error(eligibility.message || "This generation is not currently available.");
        }
        const usesPaidAttempt = eligibility.reason === "paid_available";
        setBetaAccess({
          ...eligibility,
          eligible: false,
          message: usesPaidAttempt
            ? "Your paid attempt is being reserved for this movie."
            : "Your free beta AI movie is being created.",
          paidAttemptsRemaining: usesPaidAttempt
            ? Math.max(0, (eligibility.paidAttemptsRemaining ?? 0) - 1)
            : eligibility.paidAttemptsRemaining,
          totalAttemptCount: usesPaidAttempt || eligibility.totalAttemptCount === null
            ? eligibility.totalAttemptCount
            : eligibility.totalAttemptCount + 1,
          remainingAttempts: usesPaidAttempt || eligibility.remainingAttempts === null
            ? eligibility.remainingAttempts
            : Math.max(0, eligibility.remainingAttempts - 1),
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
    formData.set("selfie", identityFile);

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
    <form className="mimi-studio" onSubmit={onSubmit}>
      <div className="mimi-studio-intro">
        <p className="mimi-kicker">CAST YOURSELF</p>
        <h1>Your story starts with you.</h1>
        <p>Bring one short clip and one scene idea. MimiReel will make the movie.</p>
      </div>

      <div className="mimi-studio-grid">
        <section className="mimi-studio-card" aria-labelledby="clip-heading">
          <div className="mimi-step-heading">
            <span className="mimi-step-number">01</span>
            <div>
              <h2 id="clip-heading">Your clip</h2>
              <p>Record ten seconds or choose a video from your device.</p>
            </div>
          </div>

          <div className="mimi-camera-stage">
            {previewUrl ? (
              <video className="camera-video camera-playback" src={previewUrl} controls playsInline aria-label="Your selected clip" />
            ) : isCameraActive ? (
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
                  style={{ display: useCanvasPreview ? "block" : "none" }}
                />
                {!isPreviewReady ? <p className="mimi-camera-loading">Starting camera…</p> : null}
              </>
            ) : (
              <div className="mimi-camera-empty">
                <span className="mimi-camera-symbol" aria-hidden="true">▶</span>
                <strong>Step into the scene.</strong>
                <p>Face the camera briefly in even light so your movie can look like you.</p>
              </div>
            )}
            {isRecording ? <span className="mimi-record-state"><span className="dot" /> Recording</span> : null}
          </div>

          <div className="mimi-capture-actions">
            {isCameraActive ? (
              isRecording ? (
                <button className="button" type="button" onClick={stopRecording}>Finish recording</button>
              ) : (
                <button className="button" type="button" onClick={startRecording}>Record 10s</button>
              )
            ) : (
              <button className="button" type="button" onClick={() => void startCamera()}>Use camera</button>
            )}
            <label className={`mimi-upload-button ${isRecording ? "disabled" : ""}`}>
              Choose a clip
              <input ref={uploadInputRef} name="videoUpload" type="file" accept="video/*" disabled={isRecording} onChange={chooseVideo} />
            </label>
            {isCameraActive && !isRecording ? (
              <button className="mimi-text-button" type="button" onClick={stopCamera}>Turn camera off</button>
            ) : null}
          </div>
          {recordedVideo ? <p className="mimi-selected-clip">Ready: {recordedVideo.name}</p> : null}
          <p className="mimi-help-note">Your camera starts only when you choose it. Nothing records until you press Record.</p>
        </section>

        <section className="mimi-studio-card mimi-story-card" aria-labelledby="story-heading">
          <div className="mimi-step-heading">
            <span className="mimi-step-number">02</span>
            <div>
              <h2 id="story-heading">Your scene</h2>
              <p>One sentence is enough. Where do you want your story to go?</p>
            </div>
          </div>

          <label className="mimi-field-label" htmlFor="movie-idea">What happens in your movie?</label>
          <textarea
            id="movie-idea"
            className="mimi-idea-input"
            name="quickPrompt"
            onChange={(event) => setQuickPrompt(event.target.value)}
            placeholder="I walk into a rain-soaked city and discover that everyone has frozen in time…"
            required
            minLength={10}
            maxLength={500}
            value={quickPrompt}
          />
          <div className="mimi-prompt-meta">
            <span>No camera directions needed.</span>
            <span>{quickPrompt.length}/500</span>
          </div>

          <details className="mimi-advanced">
            <summary>Creative settings <span>Optional</span></summary>
            <div className="mimi-advanced-body">
              <fieldset>
                <legend>Camera view</legend>
                <div className="mimi-choice-grid">
                  <label className={`mimi-choice ${cameraMode === "cinematic" ? "active" : ""}`}>
                    <input type="radio" name="cameraModeChoice" value="cinematic" checked={cameraMode === "cinematic"} onChange={() => setCameraMode("cinematic")} />
                    <span>Cinematic scene</span>
                  </label>
                  <label className={`mimi-choice ${cameraMode === "selfie" ? "active" : ""}`}>
                    <input type="radio" name="cameraModeChoice" value="selfie" checked={cameraMode === "selfie"} onChange={() => setCameraMode("selfie")} />
                    <span>Selfie story</span>
                  </label>
                </div>
              </fieldset>
              <fieldset>
                <legend>Movie engine</legend>
                <p>The recommended engine is chosen for you.</p>
                <div className="mimi-choice-grid">
                  {([
                    ["replicate-seedance-1.5-pro", "Recommended AI movie"],
                    ["local-heavy-v1", "Local worker · prototype"],
                    ["replicate-video-adapter", "MiniMax AI"],
                    ["replicate-kling-v3-omni", "Kling Pro"],
                    ["seedance-2-fast", "Seedance AI"],
                  ] as const).map(([value, label]) => {
                    const disabled = betaAccess.controlsEnabled && value !== FREE_BETA_MANAGED_PROVIDER && value !== "local-heavy-v1";
                    return (
                      <label key={value} className={`mimi-choice ${modelChoice === value ? "active" : ""} ${disabled ? "disabled" : ""}`}>
                        <input type="radio" name="modelChoice" value={value} checked={modelChoice === value} disabled={disabled} onChange={() => setModelChoice(value)} />
                        <span>{label}{disabled ? " · Unavailable in beta" : ""}</span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
              <label className="mimi-extra-photo">
                <span>Clear face photo <small>(optional)</small></span>
                <input type="file" accept="image/*" onChange={(event) => setSelfieFile(event.target.files?.[0] ?? null)} />
                <small>If you skip this, MimiReel selects a frame from your clip.</small>
              </label>
            </div>
          </details>

          {betaAccess.controlsEnabled && modelChoice !== "local-heavy-v1" ? (
            <div className={`mimi-access ${betaAccess.eligible ? "available" : "unavailable"}`}>
              <strong>{betaAccess.eligible ? "Ready when you are" : "Generation unavailable"}</strong>
              <p>{betaAccess.message}</p>
              {!betaAccess.eligible && betaAccess.reason === "free_generation_used" ? (
                <a href="/billing">See generation options</a>
              ) : null}
            </div>
          ) : null}

          {status.message ? <p className={`mimi-status ${status.tone}`} role={status.tone === "error" ? "alert" : "status"}>{status.message}</p> : null}

          <button
            className="button mimi-make-button"
            disabled={isSubmitting || !recordedVideo || quickPrompt.trim().length < 10 || (modelChoice !== "local-heavy-v1" && betaAccess.controlsEnabled && !betaAccess.eligible)}
            type="submit"
          >
            {isSubmitting ? "Making your movie…" : !recordedVideo ? "Add your clip to continue" : quickPrompt.trim().length < 10 ? "Describe your scene" : modelChoice !== "local-heavy-v1" && betaAccess.controlsEnabled && !betaAccess.eligible ? "Generation unavailable" : "Make my movie"}
          </button>
          <p className="mimi-consent">
            By continuing, you confirm you have permission to use everyone shown in your clip and agree to our <a href="/terms">Terms</a> and <a href="/identity-safety">identity safety rules</a>.
          </p>
        </section>
      </div>
    </form>
  );
}
