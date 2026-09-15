import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MoviePlayer } from "@/components/MoviePlayer";
import { getMovie, setMovieVisibility } from "@/lib/api";
import { useAuth } from "@/providers/AuthProvider";
import { colors } from "@/theme";
import type { MovieProject } from "@/types";

export default function MovieScreen() {
  const insets = useSafeAreaInsets();
  const { slug, fresh } = useLocalSearchParams<{ slug: string; fresh?: string }>();
  const { session } = useAuth();
  const [movie, setMovie] = useState<MovieProject | null>(null);
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!slug) return;
    try {
      const next = await getMovie(slug);
      setMovie(next);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That movie could not load.");
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!movie || (movie.status !== "processing" && movie.status !== "draft")) return;
    const timer = setInterval(load, 5_000);
    return () => clearInterval(timer);
  }, [load, movie]);

  async function publish() {
    if (!session?.access_token || !slug) return;
    setPublishing(true);
    try {
      const result = await setMovieVisibility(slug, "public", session.access_token);
      setMovie(result.project);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The movie could not be published.");
    } finally {
      setPublishing(false);
    }
  }

  if (loading) {
    return <View style={styles.center}><ActivityIndicator size="large" color={colors.orange} /></View>;
  }

  if (!movie) {
    return (
      <View style={styles.center}>
        <Ionicons name="alert-circle-outline" size={36} color={colors.danger} />
        <Text style={styles.error}>{error || "Movie not found."}</Text>
        <Pressable style={styles.secondaryButton} onPress={() => router.replace("/profile")}><Text style={styles.secondaryText}>Back to You</Text></Pressable>
      </View>
    );
  }

  const ready = movie.status === "published";
  const failed = movie.status === "failed";
  const progress = Math.max(0, Math.min(movie.workerJob?.progress ?? 8, 100));

  return (
    <View style={styles.screen}>
      <MoviePlayer
        videoUrl={ready ? movie.processedVideoUrl || movie.sourceVideoUrl : undefined}
        posterUrl={movie.posterUrl}
        active={ready}
      />
      <View style={styles.scrim} />
      <Pressable style={[styles.back, { top: insets.top + 12 }]} onPress={() => router.back()}>
        <Ionicons name="chevron-back" size={25} color={colors.ivory} />
      </Pressable>

      {!ready ? (
        <View style={styles.progressWrap}>
          <View style={[styles.stateIcon, failed && styles.failedIcon]}>
            {failed ? <Ionicons name="alert" size={28} color={colors.danger} /> : <ActivityIndicator color={colors.orange} />}
          </View>
          <Text style={styles.eyebrow}>{failed ? "THIS TAKE STOPPED" : "YOUR MOVIE IS BEING MADE"}</Text>
          <Text style={styles.progressTitle}>{failed ? "This scene needs another take." : movie.workerJob?.stage || "Building your world…"}</Text>
          <Text style={styles.progressBody}>
            {failed ? movie.workerJob?.error || "A technical problem interrupted generation. Your attempt can be reviewed for restoration." : "You can leave this screen. The movie will remain in You while it finishes."}
          </Text>
          {!failed ? <View style={styles.track}><View style={[styles.fill, { width: `${progress}%` }]} /></View> : null}
          <Pressable style={styles.secondaryButton} onPress={() => router.replace("/")}>
            <Text style={styles.secondaryText}>Keep watching</Text>
          </Pressable>
        </View>
      ) : (
        <View style={[styles.resultPanel, { paddingBottom: insets.bottom + 24 }]}>
          <Text style={styles.eyebrow}>{fresh === "1" ? "YOUR MOVIE IS READY" : movie.genre.toUpperCase()}</Text>
          <Text style={styles.movieTitle}>{movie.title}</Text>
          <Text style={styles.moviePremise} numberOfLines={3}>{movie.caption || movie.premise}</Text>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <View style={styles.actions}>
            {movie.visibility !== "public" ? (
              <Pressable style={styles.publishButton} onPress={publish} disabled={publishing || !session}>
                {publishing ? <ActivityIndicator color={colors.black} /> : <Ionicons name="earth" size={18} color={colors.black} />}
                <Text style={styles.publishText}>Publish</Text>
              </Pressable>
            ) : (
              <View style={styles.livePill}><Ionicons name="checkmark-circle" size={17} color={colors.success} /><Text style={styles.liveText}>Published</Text></View>
            )}
            <Pressable style={styles.privateButton} onPress={() => router.replace("/profile")}>
              <Text style={styles.privateText}>{movie.visibility === "public" ? "Done" : "Keep private"}</Text>
            </Pressable>
          </View>
          <Pressable
            style={styles.another}
            onPress={() => router.push({ pathname: "/create", params: { inspiration: movie.premise } })}
          >
            <Ionicons name="refresh" size={16} color={colors.ivory} />
            <Text style={styles.anotherText}>Another take</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.black },
  center: { flex: 1, backgroundColor: colors.black, alignItems: "center", justifyContent: "center", padding: 32, gap: 16 },
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(0,0,0,0.38)" },
  back: { position: "absolute", left: 16, width: 42, height: 42, borderRadius: 21, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center", zIndex: 5 },
  progressWrap: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 34, gap: 13 },
  stateIcon: { width: 72, height: 72, borderRadius: 36, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center", marginBottom: 8 },
  failedIcon: { backgroundColor: "rgba(255,107,100,0.08)" },
  eyebrow: { color: colors.orangeSoft, fontSize: 11, fontWeight: "900", letterSpacing: 1.6 },
  progressTitle: { color: colors.ivory, fontSize: 29, lineHeight: 35, fontWeight: "900", textAlign: "center" },
  progressBody: { color: colors.muted, fontSize: 15, lineHeight: 22, textAlign: "center" },
  track: { width: "100%", height: 5, borderRadius: 3, backgroundColor: colors.surfaceRaised, overflow: "hidden", marginTop: 10 },
  fill: { height: "100%", backgroundColor: colors.orange, borderRadius: 3 },
  secondaryButton: { marginTop: 10, height: 48, borderRadius: 24, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 22, alignItems: "center", justifyContent: "center" },
  secondaryText: { color: colors.ivory, fontSize: 14, fontWeight: "800" },
  resultPanel: { position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: "rgba(5,5,5,0.92)", borderTopLeftRadius: 30, borderTopRightRadius: 30, borderTopWidth: 1, borderColor: colors.line, padding: 24, gap: 10 },
  movieTitle: { color: colors.ivory, fontSize: 31, lineHeight: 36, fontWeight: "900", letterSpacing: -0.8 },
  moviePremise: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  actions: { flexDirection: "row", gap: 10, marginTop: 8 },
  publishButton: { flex: 1, height: 52, borderRadius: 26, backgroundColor: colors.orange, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  publishText: { color: colors.black, fontSize: 15, fontWeight: "900" },
  privateButton: { flex: 1, height: 52, borderRadius: 26, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center" },
  privateText: { color: colors.ivory, fontSize: 15, fontWeight: "800" },
  livePill: { flex: 1, height: 52, borderRadius: 26, backgroundColor: "rgba(84,217,140,0.1)", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 },
  liveText: { color: colors.success, fontSize: 14, fontWeight: "900" },
  another: { alignSelf: "center", padding: 10, flexDirection: "row", gap: 7, alignItems: "center" },
  anotherText: { color: colors.ivory, fontSize: 13, fontWeight: "700" },
  error: { color: colors.danger, fontSize: 13, lineHeight: 18, textAlign: "center" },
});
