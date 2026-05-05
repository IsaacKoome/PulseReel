"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { movieTemplates } from "@/data/templates";
import type { MovieProject } from "@/lib/types";

type RenderMode = "fast-trailer" | "prompt-movie-beta" | "heavy-worker-beta";

type StatusState = {
  tone: "idle" | "success" | "error";
  message: string;
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
  const [renderMode] = useState<RenderMode>("heavy-worker-beta");
  const [quickPrompt, setQuickPrompt] = useState("");
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isPreviewReady, setIsPreviewReady] = useState(false);
  const [useCanvasPreview, setUseCanvasPreview] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [status, setStatus] = useState<StatusState>({ tone: "idle", message: "" });
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
      const file = new File([blob], "pulsereel-selfie.png", { type: "image/png" });
      if (selfieUrl) {
        URL.revokeObjectURL(selfieUrl);
      }
      setSelfieFile(file);
      setSelfieUrl(URL.createObjectURL(file));
      setStatus({ tone: "success", message: "Selfie captured." });
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
    <form className="studio-simple" onSubmit={onSubmit}>
      <section className="studio-card glass capture-panel">
        <div className="studio-section-title">
          <span>1</span>
          <h2>Your clip</h2>
        </div>
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
              Selfie
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
          <h2>Style</h2>
        </div>

        <div className="simple-template-list">
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
              <span>{template.name}</span>
            </label>
          ))}
        </div>

        <div className={`status ${status.tone === "error" ? "error" : ""}`}>{status.message}</div>

        <div className="generate-row">
          <button className="button generate-button" disabled={isSubmitting} type="submit">
            {isSubmitting ? "Generating..." : "Generate Movie"}
          </button>
        </div>
      </section>
    </form>
  );
}
