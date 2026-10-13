import { useCallback } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useEvent } from "expo";
import { useFocusEffect } from "expo-router";
import { VideoView, useVideoPlayer } from "expo-video";
import { colors } from "@/theme";
import { pausePlayerSafely } from "@/lib/player-lifecycle";

export function MoviePreview({ uri }: { uri: string }) {
  const player = useVideoPlayer({ uri, useCaching: true }, instance => {
    instance.loop = false;
    instance.muted = false;
  });
  const { status } = useEvent(player, "statusChange", { status: player.status });
  useFocusEffect(useCallback(() => () => pausePlayerSafely(player), [player]));
  return <View style={styles.wrap}>
    <VideoView player={player} style={styles.video} nativeControls contentFit="contain" fullscreenOptions={{ enable: true }} />
    {status === "error" ? <Text style={styles.error}>The preview could not load. Go back and try again.</Text> : null}
  </View>;
}
const styles = StyleSheet.create({
  wrap: { width: "100%", aspectRatio: 9 / 12, backgroundColor: "#000" },
  video: { flex: 1 },
  error: { color: colors.danger, padding: 12 },
});
