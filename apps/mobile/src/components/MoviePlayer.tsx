import { useEffect, useMemo } from "react";
import { StyleSheet, View } from "react-native";
import { Image } from "expo-image";
import { VideoView, useVideoPlayer, type VideoSource } from "expo-video";
import { colors } from "@/theme";

function BufferedVideo({ videoUrl, active }: { videoUrl: string; active: boolean }) {
  const source = useMemo<VideoSource>(() => ({ uri: videoUrl, useCaching: true }), [videoUrl]);
  const player = useVideoPlayer(source, (instance) => {
    instance.loop = true;
    instance.muted = false;
    // Five-second movies should have most of their data ready before playback resumes.
    instance.bufferOptions = {
      minBufferForPlayback: 4,
      preferredForwardBufferDuration: 8,
      maxBufferBytes: 12_000_000,
      prioritizeTimeOverSizeThreshold: true,
    };
  });

  useEffect(() => {
    if (active) player.play();
    else player.pause();
  }, [active, player]);

  // Keeping the player mounted without a view lets Expo preload the next feed movie.
  if (!active) return null;

  return (
    <VideoView
      style={StyleSheet.absoluteFill}
      player={player}
      nativeControls={false}
      contentFit="cover"
    />
  );
}

export function MoviePlayer({
  videoUrl,
  posterUrl,
  active = true,
  preload = false,
}: {
  videoUrl?: string;
  posterUrl?: string;
  active?: boolean;
  preload?: boolean;
}) {
  return (
    <View style={StyleSheet.absoluteFill}>
      {posterUrl ? (
        <Image style={StyleSheet.absoluteFill} source={posterUrl} contentFit="cover" transition={250} />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.fallback]}>
          <View style={styles.sun} />
          <View style={styles.horizon} />
        </View>
      )}
      {videoUrl && (active || preload) ? <BufferedVideo videoUrl={videoUrl} active={active} /> : null}
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
