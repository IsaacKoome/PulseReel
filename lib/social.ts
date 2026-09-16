import { createSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/admin";
import type { MovieProject } from "@/lib/types";

export type ProjectSocialSnapshot = {
  recordedLikes: number;
  comments: number;
  recordedShares: number;
  liked: boolean;
  following: boolean;
  owns: boolean;
};

export type MovieComment = {
  id: string;
  body: string;
  authorName: string;
  createdAt: string;
};

const SOCIAL_SETUP_MESSAGE =
  "PulseReel social controls are being prepared. Apply the social-controls database migration first.";

function emptySnapshot(project: MovieProject, viewerId?: string | null): ProjectSocialSnapshot {
  return {
    recordedLikes: 0,
    comments: 0,
    recordedShares: 0,
    liked: false,
    following: false,
    owns: Boolean(viewerId && project.ownerId === viewerId),
  };
}

function socialError(error: { code?: string; message?: string } | null) {
  if (!error) return null;
  if (error.code === "42P01") return new Error(SOCIAL_SETUP_MESSAGE);
  return new Error(error.message || "PulseReel social controls are temporarily unavailable.");
}

function ensureSocialServer() {
  if (!isSupabaseAdminConfigured()) {
    throw new Error("PulseReel social controls require Supabase server access.");
  }
  return createSupabaseAdminClient();
}

export async function getProjectSocialSnapshots(
  projects: MovieProject[],
  viewerId?: string | null,
) {
  const snapshots = new Map(
    projects.map((project) => [project.id, emptySnapshot(project, viewerId)]),
  );
  if (!projects.length || !isSupabaseAdminConfigured()) return snapshots;

  const db = createSupabaseAdminClient();
  const projectIds = projects.map((project) => project.id);
  const creatorIds = [...new Set(projects.map((project) => project.ownerId).filter(Boolean))] as string[];
  const [likesResult, commentsResult, sharesResult, followsResult] = await Promise.all([
    db.from("pulse_reel_movie_likes").select("project_id,user_id").in("project_id", projectIds),
    db.from("pulse_reel_movie_comments").select("project_id").in("project_id", projectIds),
    db.from("pulse_reel_movie_shares").select("project_id").in("project_id", projectIds),
    viewerId && creatorIds.length
      ? db
          .from("pulse_reel_creator_follows")
          .select("creator_id")
          .eq("follower_id", viewerId)
          .in("creator_id", creatorIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const firstError = likesResult.error || commentsResult.error || sharesResult.error || followsResult.error;
  if (firstError?.code === "42P01") return snapshots;
  if (firstError) throw socialError(firstError);

  const followedCreators = new Set((followsResult.data ?? []).map((row) => row.creator_id));
  for (const project of projects) {
    const snapshot = snapshots.get(project.id)!;
    snapshot.following = Boolean(project.ownerId && followedCreators.has(project.ownerId));
  }
  for (const row of likesResult.data ?? []) {
    const snapshot = snapshots.get(row.project_id);
    if (!snapshot) continue;
    snapshot.recordedLikes += 1;
    if (viewerId && row.user_id === viewerId) snapshot.liked = true;
  }
  for (const row of commentsResult.data ?? []) {
    const snapshot = snapshots.get(row.project_id);
    if (snapshot) snapshot.comments += 1;
  }
  for (const row of sharesResult.data ?? []) {
    const snapshot = snapshots.get(row.project_id);
    if (snapshot) snapshot.recordedShares += 1;
  }

  return snapshots;
}

export async function getFollowedCreatorIds(viewerId: string) {
  const db = ensureSocialServer();
  const { data, error } = await db
    .from("pulse_reel_creator_follows")
    .select("creator_id")
    .eq("follower_id", viewerId);
  if (error?.code === "42P01") return [];
  if (error) throw socialError(error);
  return (data ?? []).map((row) => row.creator_id as string);
}

async function recordedCount(table: string, projectId: string) {
  const db = ensureSocialServer();
  const { count, error } = await db
    .from(table)
    .select("*", { count: "exact", head: true })
    .eq("project_id", projectId);
  if (error) throw socialError(error);
  return count ?? 0;
}

export async function setMovieLike(projectId: string, userId: string, liked: boolean) {
  const db = ensureSocialServer();
  const result = liked
    ? await db
        .from("pulse_reel_movie_likes")
        .upsert({ project_id: projectId, user_id: userId }, { onConflict: "project_id,user_id" })
    : await db
        .from("pulse_reel_movie_likes")
        .delete()
        .eq("project_id", projectId)
        .eq("user_id", userId);
  if (result.error) throw socialError(result.error);
  return { liked, recordedLikes: await recordedCount("pulse_reel_movie_likes", projectId) };
}

export async function setCreatorFollow(followerId: string, creatorId: string, following: boolean) {
  if (followerId === creatorId) throw new Error("You already own this creator profile.");
  const db = ensureSocialServer();
  const result = following
    ? await db
        .from("pulse_reel_creator_follows")
        .upsert(
          { follower_id: followerId, creator_id: creatorId },
          { onConflict: "follower_id,creator_id" },
        )
    : await db
        .from("pulse_reel_creator_follows")
        .delete()
        .eq("follower_id", followerId)
        .eq("creator_id", creatorId);
  if (result.error) throw socialError(result.error);
  return { following };
}

export async function listMovieComments(projectId: string) {
  const db = ensureSocialServer();
  const { data, error } = await db
    .from("pulse_reel_movie_comments")
    .select("id,body,author_name,created_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw socialError(error);
  return (data ?? []).map((row) => ({
    id: row.id as string,
    body: row.body as string,
    authorName: row.author_name as string,
    createdAt: row.created_at as string,
  })) satisfies MovieComment[];
}

export async function addMovieComment(input: {
  projectId: string;
  userId: string;
  authorName: string;
  body: string;
}) {
  const db = ensureSocialServer();
  const recentBoundary = new Date(Date.now() - 60_000).toISOString();
  const { count: recentCount, error: rateError } = await db
    .from("pulse_reel_movie_comments")
    .select("*", { count: "exact", head: true })
    .eq("user_id", input.userId)
    .gte("created_at", recentBoundary);
  if (rateError) throw socialError(rateError);
  if ((recentCount ?? 0) >= 5) {
    throw new Error("Please wait a moment before posting another comment.");
  }

  const { data, error } = await db
    .from("pulse_reel_movie_comments")
    .insert({
      project_id: input.projectId,
      user_id: input.userId,
      author_name: input.authorName,
      body: input.body,
    })
    .select("id,body,author_name,created_at")
    .single();
  if (error || !data) throw socialError(error);
  return {
    id: data.id as string,
    body: data.body as string,
    authorName: data.author_name as string,
    createdAt: data.created_at as string,
  } satisfies MovieComment;
}

export async function recordMovieShare(projectId: string, userId: string) {
  const db = ensureSocialServer();
  const { error } = await db
    .from("pulse_reel_movie_shares")
    .insert({ project_id: projectId, user_id: userId });
  if (error) throw socialError(error);
  return { recordedShares: await recordedCount("pulse_reel_movie_shares", projectId) };
}
