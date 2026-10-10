import { createSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/admin";

const SAFETY_SETUP_MESSAGE =
  "PulseReel safety controls are being prepared. Apply the safety-controls database migration first.";

function safetyError(error: { code?: string; message?: string } | null) {
  if (!error) return null;
  if (error.code === "42P01") return new Error(SAFETY_SETUP_MESSAGE);
  return new Error(error.message || "PulseReel safety controls are temporarily unavailable.");
}

function safetyServer() {
  if (!isSupabaseAdminConfigured()) {
    throw new Error("PulseReel safety controls require Supabase server access.");
  }
  return createSupabaseAdminClient();
}

export async function getBlockedUserIds(blockerId: string) {
  if (!isSupabaseAdminConfigured()) return [];
  const db = createSupabaseAdminClient();
  const { data, error } = await db
    .from("pulse_reel_user_blocks")
    .select("blocked_user_id")
    .eq("blocker_id", blockerId);
  if (error?.code === "42P01") return [];
  if (error) throw safetyError(error);
  return (data ?? []).map((row) => row.blocked_user_id as string);
}

export async function setUserBlocked(blockerId: string, blockedUserId: string, blocked: boolean) {
  if (blockerId === blockedUserId) throw new Error("You cannot block your own account.");
  const db = safetyServer();
  const result = blocked
    ? await db
        .from("pulse_reel_user_blocks")
        .upsert(
          { blocker_id: blockerId, blocked_user_id: blockedUserId },
          { onConflict: "blocker_id,blocked_user_id" },
        )
    : await db
        .from("pulse_reel_user_blocks")
        .delete()
        .eq("blocker_id", blockerId)
        .eq("blocked_user_id", blockedUserId);
  if (result.error) throw safetyError(result.error);
  return { blocked };
}

export async function reportProject(input: {
  reporterId: string;
  projectId: string;
  reportedUserId?: string | null;
  reason: string;
}) {
  const db = safetyServer();
  const recentBoundary = new Date(Date.now() - 60_000).toISOString();
  const { count, error: rateError } = await db
    .from("pulse_reel_content_reports")
    .select("*", { count: "exact", head: true })
    .eq("reporter_id", input.reporterId)
    .gte("created_at", recentBoundary);
  if (rateError) throw safetyError(rateError);
  if ((count ?? 0) >= 5) throw new Error("Please wait before submitting another report.");

  const { error } = await db.from("pulse_reel_content_reports").insert({
    reporter_id: input.reporterId,
    project_id: input.projectId,
    reported_user_id: input.reportedUserId ?? null,
    reason: input.reason,
  });
  if (error) throw safetyError(error);
}

export async function reportComment(input: {
  reporterId: string;
  projectId: string;
  commentId: string;
  reason: string;
}) {
  const db = safetyServer();
  const { data: comment, error: commentError } = await db
    .from("pulse_reel_movie_comments")
    .select("id,user_id")
    .eq("id", input.commentId)
    .eq("project_id", input.projectId)
    .maybeSingle();
  if (commentError) throw safetyError(commentError);
  if (!comment) throw new Error("Comment not found.");

  const { error } = await db.from("pulse_reel_content_reports").insert({
    reporter_id: input.reporterId,
    project_id: input.projectId,
    comment_id: input.commentId,
    reported_user_id: comment.user_id,
    reason: input.reason,
  });
  if (error) throw safetyError(error);
}

export async function requestAccountDeletion(userId: string, email?: string | null) {
  const db = safetyServer();
  const { data: existing, error: existingError } = await db
    .from("pulse_reel_account_deletion_requests")
    .select("id,status")
    .eq("user_id", userId)
    .in("status", ["pending", "confirmed"])
    .maybeSingle();
  if (existingError) throw safetyError(existingError);
  if (existing) return { status: existing.status as string };

  const { error } = await db.from("pulse_reel_account_deletion_requests").insert({
    user_id: userId,
    email: email ?? null,
  });
  if (error) throw safetyError(error);
  return { status: "pending" };
}
