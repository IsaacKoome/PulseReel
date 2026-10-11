import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { VideoView, useVideoPlayer } from "expo-video";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { colors } from "@/theme";
import { useEvent } from "expo";

export function IdentityFramePicker({ uri, onSelect, onGallery }: {
  uri: string; onSelect: (uri: string) => void; onGallery: () => void;
}) {
  const player = useVideoPlayer(uri);
  const { status } = useEvent(player, "statusChange", { status: player.status });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function select() {
    setBusy(true); setError(null); player.pause();
    try {
      const [frame] = await player.generateThumbnailsAsync(player.currentTime, { maxWidth: 1600 });
      if (!frame) throw new Error("No frame found.");
      const context = ImageManipulator.manipulate(frame);
      try {
        const image = await context.renderAsync();
        try { const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.85 }); onSelect(saved.uri); }
        finally { image.release(); }
      } finally { context.release(); frame.release(); }
    } catch { setError("This frame could not be read. Try another moment or choose a gallery photo."); }
    finally { setBusy(false); }
  }
  return <View style={styles.screen}>
    <Text style={styles.title}>Choose your identity frame</Text>
    <Text style={styles.body}>Play or scrub to a clear, well-lit view of your face, then use that frame. No new camera photo needed.</Text>
    <VideoView player={player} nativeControls contentFit="contain" style={styles.video} />
    {error ? <Text style={styles.error}>{error}</Text> : null}
    <Pressable style={styles.button} onPress={select} disabled={busy || status !== "readyToPlay"}>{busy ? <ActivityIndicator /> : <Text style={styles.label}>{status === "readyToPlay" ? "Use this frame" : status === "error" ? "Video cannot load — use a gallery photo" : "Loading video…"}</Text>}</Pressable>
    <Pressable style={styles.button} onPress={onGallery} disabled={busy}><Text style={styles.label}>Choose a gallery photo instead</Text></Pressable>
  </View>;
}
const styles = StyleSheet.create({
  screen: { flex: 1, padding: 20, paddingTop: 90, gap: 14 },
  title: { color: colors.ivory, fontSize: 24, fontWeight: "800" },
  body: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  video: { flex: 1, minHeight: 180 },
  button: { padding: 16, borderRadius: 24, backgroundColor: colors.orange },
  label: { color: colors.black, textAlign: "center", fontWeight: "800" },
  error: { color: colors.danger },
});
