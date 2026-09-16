import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
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
import { getMovies } from "@/lib/api";
import { colors } from "@/theme";
import type { MovieProject } from "@/types";

function compactCount(value = 0) {
  if (value < 1_000) return String(value);
  return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)}k`;
}

function RailButton({ icon, label }: { icon: keyof typeof Ionicons.glyphMap; label: string }) {
  return (
    <Pressable style={styles.railButton}>
      <View style={styles.railIcon}>
        <Ionicons name={icon} size={24} color={colors.ivory} />
      </View>
      <Text style={styles.railLabel}>{label}</Text>
    </Pressable>
  );
}

function MovieCard({ project, active, height }: { project: MovieProject; active: boolean; height: number }) {
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
        <RailButton icon="heart-outline" label={compactCount(project.metrics?.likes)} />
        <RailButton icon="chatbubble-outline" label="Talk" />
        <RailButton icon="paper-plane-outline" label={compactCount(project.metrics?.shares)} />
      </View>

      <View style={styles.story}>
        <Text style={styles.creator}>@{project.creatorName.replace(/\s+/g, "").toLowerCase()}</Text>
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
  const [tab, setTab] = useState<"following" | "for-you">("for-you");
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [projects, setProjects] = useState<MovieProject[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focused, setFocused] = useState(true);

  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    try {
      const data = await getMovies("feed");
      setProjects(data.projects);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The feed could not load.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

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
      {tab === "for-you" && visibleProjects.length > 0 ? (
        <FlatList
          data={visibleProjects}
          keyExtractor={(item) => item.id}
          renderItem={({ item, index }) => (
            <MovieCard project={item} active={focused && index === activeIndex} height={contentHeight} />
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
                {error || (normalizedQuery ? `Nothing in the feed matches “${query.trim()}”.` : "Record ten seconds. Say what happens. PulseReel turns you into the lead.")}
              </Text>
              <Pressable style={styles.emptyButton} onPress={() => normalizedQuery ? setQuery("") : router.push("/create")}>
                <Ionicons name={normalizedQuery ? "close" : "add"} size={22} color={colors.black} />
                <Text style={styles.emptyButtonText}>{normalizedQuery ? "Clear search" : "Create a movie"}</Text>
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
  railLabel: { color: colors.ivory, fontSize: 11, fontWeight: "700" },
  story: { position: "absolute", left: 18, right: 82, bottom: 104, gap: 7 },
  creator: { color: colors.ivory, fontSize: 14, fontWeight: "800" },
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
