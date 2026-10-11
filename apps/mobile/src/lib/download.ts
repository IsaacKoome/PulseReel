import { Alert, Platform } from "react-native";
import { File, Paths } from "expo-file-system";
import * as MediaLibrary from "expo-media-library/legacy";
import * as Sharing from "expo-sharing";
import type { MovieProject } from "@/types";
import { canDownloadMovie } from "@/lib/media-policy";

const running = new Set<string>();
export async function downloadMovie(movie: MovieProject) {
  if (running.has(movie.id)) return;
  if (!canDownloadMovie(movie) || !movie.processedVideoUrl) {
    Alert.alert("Download unavailable", "Only public movies or your own completed movies can be downloaded.");
    return;
  }
  running.add(movie.id);
  const destination = new File(Paths.cache, `mimireel-${movie.id}.mp4`);
  try {
    if (destination.exists) destination.delete();
    const file = await File.downloadFileAsync(movie.processedVideoUrl, destination);
    if (Platform.OS !== "android" || Number(Platform.Version) < 29) {
      const permission = await MediaLibrary.requestPermissionsAsync(true);
      if (!permission.granted) {
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(file.uri, { mimeType: "video/mp4", dialogTitle: "Save or share your movie" });
          return;
        }
        throw new Error("Allow saving videos to download this movie.");
      }
    }
    await MediaLibrary.saveToLibraryAsync(file.uri);
    Alert.alert("Movie saved", "Find it in your phone’s gallery.");
  } catch (error) {
    Alert.alert("Download did not finish", error instanceof Error ? error.message : "Check your connection and try again.");
  } finally {
    running.delete(movie.id);
    if (destination.exists) destination.delete();
  }
}
