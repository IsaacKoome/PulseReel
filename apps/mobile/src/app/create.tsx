import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { CameraView, useCameraPermissions, useMicrophonePermissions } from "expo-camera";
import * as ImagePicker from "expo-image-picker";
import { File } from "expo-file-system";
import { VideoView, useVideoPlayer } from "expo-video";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { createMovie, getGenerationAccess, PulseReelApiError } from "@/lib/api";
import { useAuth } from "@/providers/AuthProvider";
import { colors } from "@/theme";

const MAX_UPLOADED_VIDEO_BYTES = 50_000_000;

type Asset = {
  uri: string;
  mimeType?: string | null;
  fileName?: string | null;
  fileSize?: number;
  uploadDirectly?: boolean;
};
type Stage = "capture" | "identity" | "describe" | "making";

function ClipPreview({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (instance) => {
    instance.loop = true;
    instance.muted = true;
    instance.play();
  });
  return <VideoView style={styles.preview} player={player} nativeControls={false} contentFit="cover" />;
}

export default function CreateScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ inspiration?: string }>();
  const { session, signInWithGoogle } = useAuth();
  const [permission, requestPermission] = useCameraPermissions();
  const [microphonePermission, requestMicrophonePermission] = useMicrophonePermissions();
  const camera = useRef<CameraView>(null);
  const [stage, setStage] = useState<Stage>("capture");
  const [clip, setClip] = useState<Asset | null>(null);
  const [identity, setIdentity] = useState<Asset | null>(null);
  const [prompt, setPrompt] = useState(params.inspiration?.trim() || "");
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!recording) {
      setSeconds(0);
      return;
    }
    const timer = setInterval(() => setSeconds((value) => Math.min(value + 1, 10)), 1_000);
    return () => clearInterval(timer);
  }, [recording]);

  async function ensureCamera() {
    if (permission?.granted) return true;
    const next = await requestPermission();
    return next.granted;
  }

  async function allowCapture() {
    const cameraResult = permission?.granted ? permission : await requestPermission();
    if (!cameraResult.granted) return;
    if (!microphonePermission?.granted) await requestMicrophonePermission();
  }

  async function record() {
    if (recording) {
      camera.current?.stopRecording();
      return;
    }
    if (!(await ensureCamera()) || !camera.current) return;
    const microphone = microphonePermission?.granted
      ? microphonePermission
      : await requestMicrophonePermission();
    if (!microphone.granted) {
      Alert.alert("Microphone access needed", "Allow the microphone so your ten-second clip can include sound.");
      return;
    }

    setError(null);
    setRecording(true);
    try {
      const movie = await camera.current.recordAsync({ maxDuration: 10, maxFileSize: 2_800_000 });
      if (!movie?.uri) return;
      setClip({ uri: movie.uri, mimeType: "video/mp4", fileName: "clip.mp4", uploadDirectly: false });
      setIdentity(null);
      setStage("identity");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The camera could not record that clip.");
    } finally {
      setRecording(false);
    }
  }

  async function pickVideo() {
    const access = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!access.granted) {
      Alert.alert("Video access needed", "Allow PulseReel to choose the clip you want to turn into a movie.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["videos"],
      allowsEditing: false,
      quality: 1,
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    if (!asset) return;
    const fileSize = asset.fileSize ?? new File(asset.uri).size;
    if (fileSize > MAX_UPLOADED_VIDEO_BYTES) {
      Alert.alert("Clip is too large", "Choose an uploaded video no larger than 50 MB.");
      return;
    }
    setClip({
      uri: asset.uri,
      mimeType: asset.mimeType,
      fileName: asset.fileName,
      fileSize,
      uploadDirectly: true,
    });
    setIdentity(null);
    setStage("identity");
  }

  async function captureIdentity() {
    if (!(await ensureCamera()) || !camera.current) return;
    try {
      const photo = await camera.current.takePictureAsync({ quality: 0.5, shutterSound: false });
      if (!photo?.uri) return;
      setIdentity({ uri: photo.uri, mimeType: "image/jpeg", fileName: "identity.jpg" });
      setStage("describe");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That identity frame could not be captured.");
    }
  }

  async function submit() {
    if (!clip || !identity || prompt.trim().length < 10) return;
    setStage("making");
    setError(null);
    try {
      const activeSession = session ?? (await signInWithGoogle());
      if (!activeSession?.access_token) {
        setStage("describe");
        return;
      }
      const access = await getGenerationAccess(activeSession.access_token);
      if (!access.eligible && access.reason === "free_generation_used") {
        setStage("describe");
        router.push("/billing");
        return;
      }
      if (!access.eligible && access.reason === "global_limit_reached") {
        setError(access.message || "The shared free-beta generation cap has been reached.");
        setStage("describe");
        return;
      }
      const result = await createMovie({
        clip,
        identity,
        prompt: prompt.trim(),
        token: activeSession.access_token,
        ownerId: activeSession.user.id,
      });
      router.replace({ pathname: "/movie/[slug]", params: { slug: result.slug, fresh: "1" } });
    } catch (caught) {
      if (
        caught instanceof PulseReelApiError
        && (caught.code === "paid_attempts_required" || caught.code === "free_generation_used")
      ) {
        setStage("describe");
        router.push("/billing");
        return;
      }
      setError(caught instanceof Error ? caught.message : "Your movie could not be started.");
      setStage("describe");
    }
  }

  function goBack() {
    if (stage === "making") return;
    if (stage === "describe") {
      setStage("capture");
      setClip(null);
      setIdentity(null);
      return;
    }
    if (stage === "identity") {
      setStage("capture");
      setClip(null);
      return;
    }
    router.back();
  }

  const needsCamera = stage === "capture" || stage === "identity";

  return (
    <View style={styles.screen}>
      {needsCamera && permission?.granted ? (
        <CameraView
          ref={camera}
          style={StyleSheet.absoluteFill}
          facing="front"
          mode={stage === "capture" ? "video" : "picture"}
          mute={false}
          videoQuality="480p"
          videoBitrate={1_300_000}
        />
      ) : needsCamera ? (
        <View style={styles.permission}>
          <Ionicons name="camera-outline" size={38} color={colors.orange} />
          <Text style={styles.permissionTitle}>Your camera, when you choose.</Text>
          <Text style={styles.permissionBody}>PulseReel needs it only to record your clip and keep your face consistent in the movie.</Text>
          <Pressable style={styles.primaryButton} onPress={allowCapture}>
            <Text style={styles.primaryButtonText}>Allow camera</Text>
          </Pressable>
        </View>
      ) : null}

      {stage === "capture" && permission?.granted ? (
        <>
          <View style={styles.cameraScrim} />
          <View style={[styles.captureCopy, { top: insets.top + 70 }]}>
            <Text style={styles.eyebrow}>CAST YOURSELF</Text>
            <Text style={styles.captureTitle}>Record ten seconds.</Text>
            <Text style={styles.captureBody}>Look toward the camera and move naturally, or upload any video up to 50 MB. Your clip stays private unless you publish.</Text>
          </View>
          <View style={[styles.captureControls, { bottom: insets.bottom + 32 }]}>
            <Pressable style={styles.upload} onPress={pickVideo} disabled={recording}>
              <Ionicons name="images-outline" size={24} color={colors.ivory} />
              <Text style={styles.uploadText}>Upload</Text>
              <Text style={styles.uploadLimit}>≤ 50 MB</Text>
            </Pressable>
            <Pressable style={[styles.recordOuter, recording && styles.recordingOuter]} onPress={record}>
              <View style={[styles.recordInner, recording && styles.recordingInner]} />
            </Pressable>
            <View style={styles.timerSlot}>
              <Text style={styles.timer}>{recording ? `${seconds}s` : "10s"}</Text>
            </View>
          </View>
        </>
      ) : null}

      {stage === "identity" && permission?.granted ? (
        <>
          <View style={styles.cameraScrim} />
          <View style={[styles.captureCopy, { top: insets.top + 76 }]}>
            <Text style={styles.eyebrow}>ONE QUICK FRAME</Text>
            <Text style={styles.captureTitle}>Let the movie recognize you.</Text>
            <Text style={styles.captureBody}>Face the light. This photo anchors your likeness to the video you chose.</Text>
          </View>
          <View style={[styles.captureControls, { bottom: insets.bottom + 40 }] }>
            <View style={styles.timerSlot} />
            <Pressable style={styles.photoOuter} onPress={captureIdentity}>
              <View style={styles.photoInner} />
            </Pressable>
            <View style={styles.timerSlot} />
          </View>
        </>
      ) : null}

      {stage === "describe" && clip ? (
        <KeyboardAvoidingView style={styles.describe} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <ClipPreview uri={clip.uri} />
          <View style={styles.previewScrim} />
          <View style={[styles.describePanel, { paddingBottom: insets.bottom + 24 }]}>
            <Text style={styles.eyebrow}>WHAT HAPPENS?</Text>
            <Text style={styles.describeTitle}>Describe one scene.</Text>
            <TextInput
              value={prompt}
              onChangeText={setPrompt}
              placeholder="I walk into a rain-soaked city and discover everyone has frozen in time…"
              placeholderTextColor={colors.faint}
              style={styles.input}
              multiline
              maxLength={500}
              autoFocus={!params.inspiration}
            />
            <View style={styles.promptMeta}>
              <Text style={styles.hint}>No camera directions needed.</Text>
              <Text style={styles.count}>{prompt.length}/500</Text>
            </View>
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Pressable
              style={[styles.makeButton, prompt.trim().length < 10 && styles.disabled]}
              disabled={prompt.trim().length < 10}
              onPress={submit}
            >
              <Ionicons name="sparkles" size={18} color={colors.black} />
              <Text style={styles.makeText}>Make my movie</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      ) : null}

      {stage === "making" ? (
        <View style={styles.making}>
          <View style={styles.pulseRing}>
            <ActivityIndicator size="large" color={colors.orange} />
          </View>
          <Text style={styles.makingEyebrow}>YOUR SCENE IS IN MOTION</Text>
          <Text style={styles.makingTitle}>Building your world…</Text>
          <Text style={styles.makingBody}>We’re starting the movie now. Once it is safely queued, it will live in You while it finishes.</Text>
        </View>
      ) : null}

      {stage !== "making" ? (
        <Pressable style={[styles.close, { top: insets.top + 12 }]} onPress={goBack} accessibilityLabel="Close creator">
          <Ionicons name="close" size={25} color={colors.ivory} />
        </Pressable>
      ) : null}
      {error && stage !== "describe" ? <Text style={[styles.floatingError, { top: insets.top + 58 }]}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.black },
  close: { position: "absolute", left: 16, zIndex: 20, width: 42, height: 42, borderRadius: 21, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center" },
  permission: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 36, gap: 14 },
  permissionTitle: { color: colors.ivory, fontSize: 27, fontWeight: "900", textAlign: "center" },
  permissionBody: { color: colors.muted, fontSize: 15, lineHeight: 22, textAlign: "center" },
  primaryButton: { marginTop: 8, backgroundColor: colors.orange, borderRadius: 25, height: 50, paddingHorizontal: 22, justifyContent: "center" },
  primaryButtonText: { color: colors.black, fontSize: 15, fontWeight: "900" },
  cameraScrim: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(0,0,0,0.18)" },
  captureCopy: { position: "absolute", left: 24, right: 24, alignItems: "center", gap: 9 },
  eyebrow: { color: colors.orangeSoft, fontSize: 12, fontWeight: "900", letterSpacing: 1.8 },
  captureTitle: { color: colors.ivory, fontSize: 32, fontWeight: "900", textAlign: "center", letterSpacing: -0.8 },
  captureBody: { color: colors.ivory, opacity: 0.88, fontSize: 14, lineHeight: 20, textAlign: "center", maxWidth: 340 },
  captureControls: { position: "absolute", left: 28, right: 28, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  upload: { width: 68, alignItems: "center", gap: 5 },
  uploadText: { color: colors.ivory, fontSize: 12, fontWeight: "700" },
  uploadLimit: { color: colors.muted, fontSize: 9, fontWeight: "700" },
  timerSlot: { width: 68, alignItems: "center" },
  timer: { color: colors.ivory, fontSize: 13, fontWeight: "800" },
  recordOuter: { width: 78, height: 78, borderRadius: 39, borderWidth: 4, borderColor: colors.ivory, alignItems: "center", justifyContent: "center" },
  recordingOuter: { borderColor: colors.orange },
  recordInner: { width: 62, height: 62, borderRadius: 31, backgroundColor: colors.orange },
  recordingInner: { width: 30, height: 30, borderRadius: 8, backgroundColor: colors.orange },
  photoOuter: { width: 78, height: 78, borderRadius: 39, borderWidth: 4, borderColor: colors.ivory, alignItems: "center", justifyContent: "center" },
  photoInner: { width: 62, height: 62, borderRadius: 31, backgroundColor: colors.ivory },
  describe: { flex: 1, justifyContent: "flex-end" },
  preview: { ...StyleSheet.absoluteFill },
  previewScrim: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(0,0,0,0.46)" },
  describePanel: { backgroundColor: "rgba(5,5,5,0.96)", borderTopLeftRadius: 30, borderTopRightRadius: 30, borderTopWidth: 1, borderColor: colors.line, padding: 24, gap: 12 },
  describeTitle: { color: colors.ivory, fontSize: 30, fontWeight: "900", letterSpacing: -0.7 },
  input: { minHeight: 128, maxHeight: 190, borderRadius: 18, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, color: colors.ivory, fontSize: 17, lineHeight: 24, padding: 16, textAlignVertical: "top" },
  promptMeta: { flexDirection: "row", justifyContent: "space-between" },
  hint: { color: colors.muted, fontSize: 12 },
  count: { color: colors.faint, fontSize: 12 },
  error: { color: colors.danger, fontSize: 13, lineHeight: 18 },
  makeButton: { height: 54, borderRadius: 27, backgroundColor: colors.orange, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9 },
  makeText: { color: colors.black, fontSize: 16, fontWeight: "900" },
  disabled: { opacity: 0.4 },
  making: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 36, gap: 14 },
  pulseRing: { width: 94, height: 94, borderRadius: 47, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center", marginBottom: 12 },
  makingEyebrow: { color: colors.orangeSoft, fontSize: 11, fontWeight: "900", letterSpacing: 1.7 },
  makingTitle: { color: colors.ivory, fontSize: 31, fontWeight: "900", textAlign: "center" },
  makingBody: { color: colors.muted, fontSize: 15, lineHeight: 22, textAlign: "center" },
  floatingError: { position: "absolute", left: 24, right: 24, color: colors.danger, fontSize: 13, textAlign: "center", zIndex: 30 },
});
