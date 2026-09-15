import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import { Image } from "expo-image";
import { VideoView, useVideoPlayer } from "expo-video";
import { colors } from "@/theme";

export function MoviePlayer({
  videoUrl,
  posterUrl,
  active = true,
}: {
  videoUrl?: string;
  posterUrl?: string;
  active?: boolean;
}) {
  const player = useVideoPlayer(videoUrl || null, (instance) => {
    instance.loop = true;
    instance.muted = false;
  });

  useEffect(() => {
    if (!videoUrl) return;
    if (active) player.play();
    else player.pause();
  }, [active, player, videoUrl]);

  if (videoUrl) {
    return <VideoView style={StyleSheet.absoluteFill} player={player} nativeControls={false} contentFit="cover" />;
  }

  if (posterUrl) {
    return <Image style={StyleSheet.absoluteFill} source={posterUrl} contentFit="cover" transition={250} />;
  }

  return (
    <View style={[StyleSheet.absoluteFill, styles.fallback]}>
      <View style={styles.sun} />
      <View style={styles.horizon} />
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: { backgroundColor: "#17120E", overflow: "hidden" },
  sun: {
    position: "absolute",
    top: "16%",
    right: "-18%",
    width: 310,
    height: 310,
    borderRadius: 155,
    backgroundColor: colors.orange,
    opacity: 0.72,
  },
  horizon: {
    position: "absolute",
    left: "-20%",
    right: "-20%",
    bottom: "18%",
    height: 190,
    backgroundColor: colors.black,
    transform: [{ rotate: "-8deg" }],
    opacity: 0.72,
  },
});
