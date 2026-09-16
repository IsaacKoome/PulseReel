import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  Share,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
  type ViewToken,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MoviePlayer } from "@/components/MoviePlayer";
import { PulseDock } from "@/components/PulseDock";
import {
  API_URL,
  getMovies,
  recordMovieShare,
  setCreatorFollow,
  setMovieLike,
} from "@/lib/api";
import { useAuth } from "@/providers/AuthProvider";
import { colors } from "@/theme";
import type { MovieProject } from "@/types";

function compactCount(value = 0) {
  if (value < 1_000) return String(value);
  return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)}k`;
}

function RailButton({
  icon,
  label,
  active = false,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  active?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable style={styles.railButton} onPress={onPress}>
      <View style={[styles.railIcon, active && styles.railIconActive]}>
        <Ionicons name={icon} size={24} color={active ? colors.orange : colors.ivory} />
      </View>
      <Text style={styles.railLabel}>{label}</Text>
    </Pressable>
  );
}

function MovieCard({
  project,
  active,
  height,
  onLike,
  onTalk,
  onShare,
  onFollow,
}: {
  project: MovieProject;
  active: boolean;
  height: number;
  onLike: () => void;
  onTalk: () => void;
  onShare: () => void;
  onFollow: () => void;
}) {
  return (
    <View style={[styles.card, { height }]}>
      <MoviePlayer
        videoUrl={project.processedVideoUrl || project.sourceVideoUrl}
        posterUrl={project.posterUrl}
        active={active}
      />
      <View style={styles.scrimTop} />
      <View style={styles.scrimBottom} />

      <View style={styles.rail}>
        <RailButton
          icon={project.viewer?.liked ? "heart" : "heart-outline"}
          label={compactCount(project.metrics?.likes)}
          active={project.viewer?.liked}
          onPress={onLike}
        />
        <RailButton
          icon="chatbubble-outline"
          label={project.metrics?.comments ? compactCount(project.metrics.comments) : "Talk"}
          onPress={onTalk}
        />
        <RailButton
          icon="paper-plane-outline"
          label={compactCount(project.metrics?.shares)}
          onPress={onShare}
        />
      </View>

      <View style={styles.story}>
        <View style={styles.creatorRow}>
          <Text style={styles.creator}>@{project.creatorName.replace(/\s+/g, "").toLowerCase()}</Text>
          {project.creatorId && !project.viewer?.owns ? (
            <Pressable style={styles.followButton} onPress={onFollow}>
              <Text style={[styles.followText, project.viewer?.following && styles.followingText]}>
                {project.viewer?.following ? "Following" : "Follow"}
              </Text>
            </Pressable>
          ) : null}
        </View>
        <Text style={styles.title}>{project.title}</Text>
        <Text style={styles.premise} numberOfLines={2}>{project.caption || project.premise}</Text>
        <View style={styles.genreRow}>
          <Text style={styles.genre}>{project.genre}</Text>
          <Text style={styles.dot}>•</Text>
          <Text style={styles.scene}>PulseReel original</Text>
        </View>
        <Pressable
          style={styles.starButton}
          onPress={() => router.push({ pathname: "/create", params: { inspiration: project.premise } })}
        >
          <Ionicons name="sparkles" size={16} color={colors.black} />
          <Text style={styles.starText}>Star in this story</Text>
        </Pressable>
      </View>
    </View>
  );
}

export default function WatchScreen() {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const { ready, session, signInWithGoogle } = useAuth();
  const [tab, setTab] = useState<"following" | "for-you">("for-you");
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [projects, setProjects] = useState<MovieProject[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focused, setFocused] = useState(true);

  const load = useCallback(async (refresh = false) => {
    if (!ready) return;
    if (refresh) setRefreshing(true);
    else setLoading(true);
    try {
      if (tab === "following" && !session?.access_token) {
        setProjects([]);
        setError(null);
        return;
      }
      const data = await getMovies(
        tab === "following" ? "following" : "feed",
        session?.access_token,
      );
      setProjects(data.projects);
      setActiveIndex(0);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The feed could not load.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [ready, session?.access_token, tab]);

  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      void load();
      return () => setFocused(false);
    }, [load]),
  );

  useEffect(() => {
    if (tab === "following") setQuery("");
  }, [tab]);

  async function signedInToken() {
    if (session?.access_token) return session.access_token;
    const activeSession = await signInWithGoogle();
    return activeSession?.access_token ?? null;
  }

  function updateProject(projectId: string, updater: (project: MovieProject) => MovieProject) {
    setProjects((current) => current.map((project) => (
      project.id === projectId ? updater(project) : project
    )));
  }

  async function like(project: MovieProject) {
    try {
      const token = await signedInToken();
      if (!token) return;
      const liked = !project.viewer?.liked;
      updateProject(project.id, (current) => ({
        ...current,
        metrics: { ...current.metrics, likes: Math.max(0, current.metrics.likes + (liked ? 1 : -1)) },
        viewer: { liked, following: Boolean(current.viewer?.following), owns: Boolean(current.viewer?.owns) },
      }));
      const saved = await setMovieLike(project.slug, liked, token);
      updateProject(project.id, (current) => ({
        ...current,
        metrics: { ...current.metrics, likes: saved.likes },
        viewer: { liked: saved.liked, following: Boolean(current.viewer?.following), owns: Boolean(current.viewer?.owns) },
      }));
    } catch (caught) {
      void load(true);
      Alert.alert("Like not saved", caught instanceof Error ? caught.message : "Please try again.");
    }
  }

  async function follow(project: MovieProject) {
    try {
      const token = await signedInToken();
      if (!token) return;
      const following = !project.viewer?.following;
      setProjects((current) => current.map((item) => (
        item.creatorId && item.creatorId === project.creatorId
          ? {
              ...item,
              viewer: {
                liked: Boolean(item.viewer?.liked),
                following,
                owns: Boolean(item.viewer?.owns),
              },
            }
          : item
      )));
      await setCreatorFollow(project.slug, following, token);
      if (!following && tab === "following") {
        setProjects((current) => current.filter((item) => item.creatorId !== project.creatorId));
      }
    } catch (caught) {
      void load(true);
      Alert.alert("Follow not saved", caught instanceof Error ? caught.message : "Please try again.");
    }
  }

  async function share(project: MovieProject) {
    try {
      const result = await Share.share(
        {
          title: project.title,
          message: `${project.title} on PulseReel\n${API_URL}/watch/${encodeURIComponent(project.slug)}`,
        },
        { dialogTitle: `Share ${project.title}` },
      );
      if (result.action !== Share.sharedAction) return;
      const saved = await recordMovieShare(project.slug, session?.access_token);
      if (saved.tracked && typeof saved.shares === "number") {
        updateProject(project.id, (current) => ({
          ...current,
          metrics: { ...current.metrics, shares: saved.shares! },
        }));
      }
    } catch (caught) {
      Alert.alert("Could not share", caught instanceof Error ? caught.message : "Please try again.");
    }
  }

  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken<MovieProject>[] }) => {
      const index = viewableItems[0]?.index;
      if (typeof index === "number") setActiveIndex(index);
    },
  ).current;

  const contentHeight = height;
  const normalizedQuery = query.trim().toLowerCase();
  const visibleProjects = normalizedQuery
    ? projects.filter((project) =>
        `${project.title} ${project.creatorName} ${project.genre} ${project.premise}`
          .toLowerCase()
          .includes(normalizedQuery),
      )
    : projects;

  return (
    <View style={styles.screen}>
      {visibleProjects.length > 0 ? (
        <FlatList
          data={visibleProjects}
          keyExtractor={(item) => item.id}
          renderItem={({ item, index }) => (
            <MovieCard
              project={item}
              active={focused && index === activeIndex}
              height={contentHeight}
              onLike={() => void like(item)}
              onTalk={() => router.push({ pathname: "/comments/[slug]", params: { slug: item.slug, title: item.title } })}
              onShare={() => void share(item)}
              onFollow={() => void follow(item)}
            />
          )}
          pagingEnabled
          showsVerticalScrollIndicator={false}
          initialNumToRender={1}
          maxToRenderPerBatch={2}
          windowSize={3}
          removeClippedSubviews
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={{ itemVisiblePercentThreshold: 72 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={colors.orange} />}
        />
      ) : (
        <View style={styles.empty}>
          <MoviePlayer active={false} />
          <View style={styles.emptyScrim} />
          {loading ? (
            <ActivityIndicator color={colors.orange} size="large" />
          ) : (
            <View style={styles.emptyCopy}>
              <Text style={styles.emptyEyebrow}>{tab === "following" ? "FOLLOWING" : normalizedQuery ? "NO MATCH YET" : "THE STAGE IS OPEN"}</Text>
              <Text style={styles.emptyTitle}>
                {tab === "following" ? "The people you follow will appear here." : normalizedQuery ? "Try another story, star, or genre." : "Your first story can start here."}
              </Text>
              <Text style={styles.emptyBody}>
                {error || (tab === "following"
                  ? session
                    ? "Follow creators from For you and their public movies will collect here."
                    : "Sign in, follow creators you like, and their new movies will collect here."
                  : normalizedQuery
                    ? `Nothing in the feed matches “${query.trim()}”.`
                    : "Record ten seconds. Say what happens. PulseReel turns you into the lead.")}
              </Text>
              <Pressable
                style={styles.emptyButton}
                onPress={() => {
                  if (normalizedQuery) setQuery("");
                  else if (tab === "following" && !session) void signInWithGoogle();
                  else if (tab === "following") setTab("for-you");
                  else router.push("/create");
                }}
              >
                <Ionicons
                  name={normalizedQuery ? "close" : tab === "following" && !session ? "logo-google" : tab === "following" ? "compass-outline" : "add"}
                  size={22}
                  color={colors.black}
                />
                <Text style={styles.emptyButtonText}>
                  {normalizedQuery ? "Clear search" : tab === "following" && !session ? "Sign in" : tab === "following" ? "Explore stories" : "Create a movie"}
                </Text>
              </Pressable>
            </View>
          )}
        </View>
      )}

      <View style={[styles.topBar, { top: insets.top + 10 }]}>
        {searching ? (
          <View style={styles.searchBox}>
            <Ionicons name="search" size={18} color={colors.muted} />
            <TextInput
              autoFocus
              value={query}
              onChangeText={setQuery}
              placeholder="Search stories"
              placeholderTextColor={colors.faint}
              style={styles.searchInput}
            />
            <Pressable accessibilityLabel="Close search" onPress={() => { setSearching(false); setQuery(""); }}>
              <Ionicons name="close" size={20} color={colors.ivory} />
            </Pressable>
          </View>
        ) : (
          <>
            <View style={styles.tabs}>
              <Pressable onPress={() => setTab("following")}>
                <Text style={[styles.tab, tab === "following" && styles.tabActive]}>Following</Text>
              </Pressable>
              <Pressable onPress={() => setTab("for-you")}>
                <Text style={[styles.tab, tab === "for-you" && styles.tabActive]}>For you</Text>
              </Pressable>
            </View>
            <Pressable accessibilityLabel="Search" style={styles.search} onPress={() => { setTab("for-you"); setSearching(true); }}>
              <Ionicons name="search" size={22} color={colors.ivory} />
            </Pressable>
          </>
        )}
      </View>

      <PulseDock />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.black },
  card: { width: "100%", backgroundColor: colors.black, overflow: "hidden" },
  scrimTop: { position: "absolute", left: 0, right: 0, top: 0, height: 180, backgroundColor: "rgba(0,0,0,0.28)" },
  scrimBottom: { position: "absolute", left: 0, right: 0, bottom: 0, height: 390, backgroundColor: "rgba(0,0,0,0.58)" },
  topBar: { position: "absolute", left: 22, right: 22, flexDirection: "row", alignItems: "center", justifyContent: "center" },
  tabs: { flexDirection: "row", gap: 24, alignItems: "center" },
  tab: { color: colors.muted, fontSize: 16, fontWeight: "700" },
  tabActive: { color: colors.ivory, fontSize: 17 },
  search: { position: "absolute", right: 0, padding: 8 },
  searchBox: { height: 44, width: "100%", borderRadius: 22, backgroundColor: "rgba(10,10,9,0.88)", borderWidth: 1, borderColor: colors.line, flexDirection: "row", alignItems: "center", gap: 9, paddingHorizontal: 14 },
  searchInput: { flex: 1, color: colors.ivory, fontSize: 15, paddingVertical: 0 },
  rail: { position: "absolute", right: 16, bottom: 188, gap: 16, alignItems: "center" },
  railButton: { alignItems: "center", gap: 3 },
  railIcon: { width: 45, height: 45, borderRadius: 23, backgroundColor: "rgba(0,0,0,0.36)", alignItems: "center", justifyContent: "center" },
  railIconActive: { backgroundColor: "rgba(255,122,26,0.18)", borderWidth: 1, borderColor: "rgba(255,122,26,0.5)" },
  railLabel: { color: colors.ivory, fontSize: 11, fontWeight: "700" },
  story: { position: "absolute", left: 18, right: 82, bottom: 104, gap: 7 },
  creatorRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  creator: { color: colors.ivory, fontSize: 14, fontWeight: "800" },
  followButton: { borderWidth: 1, borderColor: "rgba(255,245,231,0.5)", borderRadius: 14, paddingHorizontal: 10, paddingVertical: 4, backgroundColor: "rgba(0,0,0,0.25)" },
  followText: { color: colors.ivory, fontSize: 11, fontWeight: "900" },
  followingText: { color: colors.orangeSoft },
  title: { color: colors.ivory, fontSize: 28, fontWeight: "900", letterSpacing: -0.7 },
  premise: { color: colors.ivory, fontSize: 15, lineHeight: 20 },
  genreRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  genre: { color: colors.orangeSoft, fontSize: 12, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.8 },
  dot: { color: colors.faint },
  scene: { color: colors.muted, fontSize: 12 },
  starButton: { marginTop: 5, alignSelf: "flex-start", height: 42, paddingHorizontal: 16, borderRadius: 21, backgroundColor: colors.ivory, flexDirection: "row", alignItems: "center", gap: 8 },
  starText: { color: colors.black, fontSize: 13, fontWeight: "900" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center" },
  emptyScrim: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(0,0,0,0.38)" },
  emptyCopy: { marginHorizontal: 34, alignItems: "center", gap: 12 },
  emptyEyebrow: { color: colors.orangeSoft, fontSize: 12, fontWeight: "900", letterSpacing: 1.6 },
  emptyTitle: { color: colors.ivory, fontSize: 34, fontWeight: "900", textAlign: "center", lineHeight: 39, letterSpacing: -1 },
  emptyBody: { color: colors.muted, fontSize: 15, lineHeight: 22, textAlign: "center" },
  emptyButton: { marginTop: 8, height: 50, borderRadius: 25, paddingHorizontal: 20, backgroundColor: colors.orange, flexDirection: "row", alignItems: "center", gap: 8 },
  emptyButtonText: { color: colors.black, fontSize: 15, fontWeight: "900" },
});
