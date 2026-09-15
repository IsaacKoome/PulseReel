import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { getGenerationAccess, getMovies } from "@/lib/api";
import { useAuth } from "@/providers/AuthProvider";
import { PulseDock } from "@/components/PulseDock";
import { colors } from "@/theme";
import type { GenerationAccess, MovieProject } from "@/types";

function MovieTile({ movie }: { movie: MovieProject }) {
  return (
    <Pressable
      style={styles.tile}
      onPress={() => router.push({ pathname: "/movie/[slug]", params: { slug: movie.slug } })}
    >
      {movie.posterUrl ? (
        <Image source={movie.posterUrl} style={StyleSheet.absoluteFill} contentFit="cover" />
      ) : (
        <View style={styles.tileFallback}>
          <Ionicons name={movie.status === "failed" ? "alert-circle-outline" : "sparkles"} size={26} color={colors.orange} />
        </View>
      )}
      <View style={styles.tileScrim} />
      <View style={styles.statusPill}>
        <Text style={styles.statusText}>{movie.status === "published" ? "READY" : movie.status.toUpperCase()}</Text>
      </View>
      <Text style={styles.tileTitle} numberOfLines={2}>{movie.title}</Text>
    </Pressable>
  );
}

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const { ready, configured, session, user, signInWithGoogle, signOut } = useAuth();
  const [movies, setMovies] = useState<MovieProject[]>([]);
  const [access, setAccess] = useState<GenerationAccess | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (refresh = false) => {
    const token = session?.access_token;
    if (!token) return;
    if (refresh) setRefreshing(true);
    else setLoading(true);
    try {
      const [movieData, accessData] = await Promise.all([
        getMovies("mine", token),
        getGenerationAccess(token),
      ]);
      setMovies(movieData.projects);
      setAccess(accessData);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Your movies could not load.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [session?.access_token]);

  useEffect(() => {
    load();
  }, [load]);

  async function signIn() {
    setError(null);
    try {
      await signInWithGoogle();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Google sign-in did not finish.");
    }
  }

  if (!ready) {
    return <View style={styles.center}><ActivityIndicator color={colors.orange} size="large" /></View>;
  }

  if (!user) {
    return (
      <View style={[styles.signedOut, { paddingTop: insets.top + 72 }] }>
        <Text style={styles.brand}>PULSEREEL</Text>
        <View style={styles.avatarEmpty}><Ionicons name="person-outline" size={38} color={colors.ivory} /></View>
        <Text style={styles.signedOutTitle}>Your movies belong to you.</Text>
        <Text style={styles.signedOutBody}>Sign in to create a scene, keep private drafts, and publish when you are ready.</Text>
        <Pressable style={styles.signInButton} onPress={signIn}>
          <Ionicons name="logo-google" size={19} color={colors.black} />
          <Text style={styles.signInText}>Continue with Google</Text>
        </Pressable>
        {!configured ? <Text style={styles.error}>Mobile Supabase public settings still need to be added.</Text> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <PulseDock />
      </View>
    );
  }

  const fullName = String(user.user_metadata?.full_name || user.email?.split("@")[0] || "Creator");
  const initial = fullName.trim().charAt(0).toUpperCase();
  const paid = access?.paidAttemptsRemaining ?? 0;
  const needsAttempts = Boolean(
    access
    && !access.eligible
    && (access.reason === "free_generation_used" || access.reason === "global_limit_reached"),
  );

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 24 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={colors.orange} />}
      >
        <View style={styles.headerRow}>
          <Text style={styles.brand}>PULSEREEL</Text>
          <Pressable onPress={signOut} style={styles.iconButton} accessibilityLabel="Sign out">
            <Ionicons name="log-out-outline" size={22} color={colors.ivory} />
          </Pressable>
        </View>

        <View style={styles.profileRow}>
          <View style={styles.avatar}><Text style={styles.avatarText}>{initial}</Text></View>
          <View style={styles.identityCopy}>
            <Text style={styles.name}>{fullName}</Text>
            <Text style={styles.email}>{user.email}</Text>
          </View>
        </View>

        <View style={styles.attemptCard}>
          <View>
            <Text style={styles.attemptLabel}>PAID ATTEMPTS</Text>
            <Text style={styles.attemptCount}>{paid}</Text>
          </View>
          <View style={styles.attemptIcon}><Ionicons name="sparkles" size={22} color={colors.orange} /></View>
        </View>
        {access?.message ? <Text style={styles.accessMessage}>{access.message}</Text> : null}
        {needsAttempts ? (
          <Pressable style={styles.attemptButton} onPress={() => router.push("/billing")}>
            <Ionicons name="card-outline" size={19} color={colors.black} />
            <Text style={styles.attemptButtonText}>Get 5 attempts</Text>
          </Pressable>
        ) : null}

        <View style={styles.sectionRow}>
          <Text style={styles.sectionTitle}>Your movies</Text>
          <Pressable onPress={() => router.push("/create")}><Text style={styles.createText}>+ Create</Text></Pressable>
        </View>

        {loading ? <ActivityIndicator color={colors.orange} /> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {!loading && movies.length === 0 ? (
          <Pressable style={styles.noMovies} onPress={() => router.push("/create")}>
            <Ionicons name="add-circle-outline" size={32} color={colors.orange} />
            <Text style={styles.noMoviesTitle}>No movies yet</Text>
            <Text style={styles.noMoviesBody}>Your first scene takes only a clip and one sentence.</Text>
          </Pressable>
        ) : (
          <View style={styles.grid}>{movies.map((movie) => <MovieTile key={movie.id} movie={movie} />)}</View>
        )}
      </ScrollView>
      <PulseDock />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.black },
  center: { flex: 1, backgroundColor: colors.black, alignItems: "center", justifyContent: "center" },
  signedOut: { flex: 1, backgroundColor: colors.black, paddingHorizontal: 30, alignItems: "center", gap: 16 },
  brand: { color: colors.orangeSoft, fontSize: 12, fontWeight: "900", letterSpacing: 2.2 },
  avatarEmpty: { width: 92, height: 92, borderRadius: 46, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center", marginTop: 42 },
  signedOutTitle: { color: colors.ivory, fontSize: 31, lineHeight: 36, fontWeight: "900", textAlign: "center", letterSpacing: -0.8 },
  signedOutBody: { color: colors.muted, fontSize: 15, lineHeight: 22, textAlign: "center" },
  signInButton: { marginTop: 12, height: 52, borderRadius: 26, backgroundColor: colors.ivory, paddingHorizontal: 22, flexDirection: "row", alignItems: "center", gap: 10 },
  signInText: { color: colors.black, fontSize: 15, fontWeight: "900" },
  content: { paddingHorizontal: 20, paddingBottom: 118 },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 30 },
  iconButton: { width: 42, height: 42, borderRadius: 21, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center" },
  profileRow: { flexDirection: "row", alignItems: "center", gap: 15 },
  avatar: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.orange, alignItems: "center", justifyContent: "center" },
  avatarText: { color: colors.black, fontSize: 30, fontWeight: "900" },
  identityCopy: { flex: 1, gap: 4 },
  name: { color: colors.ivory, fontSize: 24, fontWeight: "900" },
  email: { color: colors.muted, fontSize: 13 },
  attemptCard: { marginTop: 28, minHeight: 118, borderRadius: 22, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, padding: 20, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  attemptLabel: { color: colors.muted, fontSize: 11, fontWeight: "900", letterSpacing: 1.3 },
  attemptCount: { color: colors.ivory, fontSize: 44, fontWeight: "900", marginTop: 4 },
  attemptIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: "rgba(255,122,26,0.12)", alignItems: "center", justifyContent: "center" },
  accessMessage: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 10 },
  attemptButton: { marginTop: 14, height: 50, borderRadius: 25, backgroundColor: colors.orange, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9 },
  attemptButtonText: { color: colors.black, fontSize: 15, fontWeight: "900" },
  sectionRow: { marginTop: 32, marginBottom: 16, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  sectionTitle: { color: colors.ivory, fontSize: 22, fontWeight: "900" },
  createText: { color: colors.orangeSoft, fontSize: 14, fontWeight: "800" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  tile: { width: "48.4%", aspectRatio: 0.7, borderRadius: 17, backgroundColor: colors.surface, overflow: "hidden", justifyContent: "flex-end", padding: 13 },
  tileFallback: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center", backgroundColor: "#17120E" },
  tileScrim: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(0,0,0,0.24)" },
  statusPill: { position: "absolute", top: 10, left: 10, borderRadius: 10, backgroundColor: "rgba(0,0,0,0.62)", paddingHorizontal: 8, paddingVertical: 5 },
  statusText: { color: colors.orangeSoft, fontSize: 9, fontWeight: "900", letterSpacing: 0.8 },
  tileTitle: { color: colors.ivory, fontSize: 15, lineHeight: 19, fontWeight: "900" },
  noMovies: { minHeight: 220, borderRadius: 22, borderWidth: 1, borderColor: colors.line, borderStyle: "dashed", alignItems: "center", justifyContent: "center", padding: 24, gap: 8 },
  noMoviesTitle: { color: colors.ivory, fontSize: 20, fontWeight: "900" },
  noMoviesBody: { color: colors.muted, fontSize: 13, textAlign: "center", lineHeight: 19 },
  error: { color: colors.danger, fontSize: 13, lineHeight: 18, textAlign: "center" },
});
