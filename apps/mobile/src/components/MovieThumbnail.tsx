import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Image } from "expo-image";
import { createVideoPlayer, type VideoThumbnail } from "expo-video";

const cache = new Map<string, VideoThumbnail>();
let queue: Promise<unknown> = Promise.resolve();
export function MovieThumbnail({ videoUrl, posterUrl }: { videoUrl?: string; posterUrl?: string }) {
  const [frame, setFrame] = useState<VideoThumbnail | undefined>(videoUrl ? cache.get(videoUrl) : undefined);
  const [posterFailed, setPosterFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    if (!videoUrl || cache.has(videoUrl)) return;
    queue = queue.catch(() => {}).then(async () => {
      if (cancelled) return;
      const player = createVideoPlayer(null);
      try {
        await player.replaceAsync({ uri: videoUrl, useCaching: true });
        const [thumbnail] = await player.generateThumbnailsAsync(0.5, { maxWidth: 360 });
        if (thumbnail) { cache.set(videoUrl, thumbnail); if (!cancelled) setFrame(thumbnail); }
      } catch { /* A poster remains available when thumbnail extraction fails. */ }
      finally { player.release(); }
    });
    return () => { cancelled = true; };
  }, [videoUrl]);
  return <View style={StyleSheet.absoluteFill}>
    {frame ? <Image source={frame} style={StyleSheet.absoluteFill} contentFit="cover" /> :
      posterUrl && !posterFailed ? <Image source={posterUrl} onError={() => setPosterFailed(true)} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
  </View>;
}
