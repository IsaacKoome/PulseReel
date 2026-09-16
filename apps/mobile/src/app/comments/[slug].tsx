import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { getMovieComments, postMovieComment } from "@/lib/api";
import { useAuth } from "@/providers/AuthProvider";
import { colors } from "@/theme";
import type { MovieComment } from "@/types";

function shortTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Now";
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function CommentsScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ slug: string; title?: string }>();
  const slug = Array.isArray(params.slug) ? params.slug[0] : params.slug;
  const title = Array.isArray(params.title) ? params.title[0] : params.title;
  const { session, signInWithGoogle } = useAuth();
  const [comments, setComments] = useState<MovieComment[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!slug) return;
    setLoading(true);
    try {
      const data = await getMovieComments(slug);
      setComments(data.comments);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The conversation could not load.");
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function send() {
    const body = draft.trim();
    if (!slug || !body || sending) return;
    setSending(true);
    setError(null);
    try {
      const activeSession = session ?? (await signInWithGoogle());
      if (!activeSession?.access_token) return;
      const result = await postMovieComment(slug, body, activeSession.access_token);
      setComments((current) => [result.comment, ...current]);
      setDraft("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The comment could not be posted.");
    } finally {
      setSending(false);
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={styles.screen}
    >
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Pressable style={styles.iconButton} onPress={() => router.back()} accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={26} color={colors.ivory} />
        </Pressable>
        <View style={styles.headingCopy}>
          <Text style={styles.eyebrow}>TALK</Text>
          <Text style={styles.title} numberOfLines={1}>{title || "Movie conversation"}</Text>
        </View>
        <View style={styles.countPill}>
          <Text style={styles.count}>{comments.length}</Text>
        </View>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.orange} size="large" /></View>
      ) : comments.length ? (
        <FlatList
          data={comments}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <View style={styles.comment}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{item.authorName.trim().charAt(0).toUpperCase()}</Text>
              </View>
              <View style={styles.commentBody}>
                <View style={styles.commentMeta}>
                  <Text style={styles.author} numberOfLines={1}>{item.authorName}</Text>
                  <Text style={styles.time}>{shortTime(item.createdAt)}</Text>
                </View>
                <Text style={styles.body}>{item.body}</Text>
              </View>
            </View>
          )}
        />
      ) : (
        <View style={styles.center}>
          <View style={styles.emptyIcon}><Ionicons name="chatbubbles-outline" size={35} color={colors.orange} /></View>
          <Text style={styles.emptyTitle}>Start the conversation.</Text>
          <Text style={styles.emptyBody}>Say what the scene made you feel.</Text>
        </View>
      )}

      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder={session ? "Add to the conversation…" : "Sign in and join the conversation…"}
          placeholderTextColor={colors.faint}
          style={styles.input}
          multiline
          maxLength={500}
          editable={!sending}
        />
        <Pressable
          style={[styles.sendButton, (!draft.trim() || sending) && styles.sendDisabled]}
          onPress={() => void send()}
          disabled={!draft.trim() || sending}
          accessibilityLabel="Post comment"
        >
          {sending
            ? <ActivityIndicator color={colors.black} size="small" />
            : <Ionicons name="arrow-up" size={22} color={colors.black} />}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.black },
  header: { paddingHorizontal: 18, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: colors.line, flexDirection: "row", alignItems: "center", gap: 12 },
  iconButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surfaceRaised, alignItems: "center", justifyContent: "center" },
  headingCopy: { flex: 1 },
  eyebrow: { color: colors.orangeSoft, fontSize: 10, fontWeight: "900", letterSpacing: 1.6 },
  title: { color: colors.ivory, fontSize: 18, fontWeight: "900", marginTop: 2 },
  countPill: { minWidth: 36, height: 30, paddingHorizontal: 10, borderRadius: 15, backgroundColor: "rgba(255,122,26,0.16)", alignItems: "center", justifyContent: "center" },
  count: { color: colors.orangeSoft, fontWeight: "900" },
  list: { padding: 18, gap: 18 },
  comment: { flexDirection: "row", alignItems: "flex-start", gap: 11 },
  avatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.orange, alignItems: "center", justifyContent: "center" },
  avatarText: { color: colors.black, fontSize: 16, fontWeight: "900" },
  commentBody: { flex: 1, borderBottomWidth: 1, borderBottomColor: colors.line, paddingBottom: 16 },
  commentMeta: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  author: { flex: 1, color: colors.ivory, fontSize: 14, fontWeight: "900" },
  time: { color: colors.faint, fontSize: 10 },
  body: { color: colors.muted, fontSize: 15, lineHeight: 21, marginTop: 5 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 34, gap: 12 },
  emptyIcon: { width: 72, height: 72, borderRadius: 36, backgroundColor: "rgba(255,122,26,0.12)", alignItems: "center", justifyContent: "center" },
  emptyTitle: { color: colors.ivory, fontSize: 24, fontWeight: "900", textAlign: "center" },
  emptyBody: { color: colors.muted, fontSize: 15, textAlign: "center" },
  error: { color: colors.danger, fontSize: 12, lineHeight: 17, paddingHorizontal: 18, paddingTop: 8 },
  composer: { borderTopWidth: 1, borderTopColor: colors.line, paddingHorizontal: 14, paddingTop: 12, flexDirection: "row", alignItems: "flex-end", gap: 10, backgroundColor: colors.surface },
  input: { flex: 1, minHeight: 48, maxHeight: 120, borderRadius: 24, borderWidth: 1, borderColor: colors.line, color: colors.ivory, backgroundColor: colors.black, paddingHorizontal: 16, paddingTop: 13, paddingBottom: 12, fontSize: 15 },
  sendButton: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.orange, alignItems: "center", justifyContent: "center" },
  sendDisabled: { opacity: 0.4 },
});
