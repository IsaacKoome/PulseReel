import { createSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/admin";

export type WillingnessToPay = "yes" | "maybe" | "no";

export type MovieFeedback = {
  id: string;
  projectId: string;
  userId: string;
  identityRating: number;
  movieRating: number;
  willingnessToPay: WillingnessToPay;
  comment: string;
  createdAt: string;
  updatedAt: string;
};

export type FeedbackAdminSnapshot = {
  totalResponses: number;
  averageIdentityRating: number | null;
  averageMovieRating: number | null;
  willingToPayCount: number;
  maybePayCount: number;
  recentFeedback: MovieFeedback[];
};

type FeedbackRow = {
  id: string;
  project_id: string;
  user_id: string;
  identity_rating: number;
  movie_rating: number;
  willingness_to_pay: WillingnessToPay;
  comment: string;
  created_at: string;
  updated_at: string;
};

function toMovieFeedback(row: FeedbackRow): MovieFeedback {
  return {
    id: row.id,
    projectId: row.project_id,
    userId: row.user_id,
    identityRating: Number(row.identity_rating),
    movieRating: Number(row.movie_rating),
    willingnessToPay: row.willingness_to_pay,
    comment: row.comment,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getMovieFeedback(projectId: string, userId: string) {
  if (!isSupabaseAdminConfigured()) return null;

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("pulse_reel_movie_feedback")
    .select("id,project_id,user_id,identity_rating,movie_rating,willingness_to_pay,comment,created_at,updated_at")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    if (error.code !== "42P01") console.error("Could not read PulseReel movie feedback.", error);
    return null;
  }

  return data ? toMovieFeedback(data as FeedbackRow) : null;
}

export async function saveMovieFeedback(input: {
  projectId: string;
  userId: string;
  identityRating: number;
  movieRating: number;
  willingnessToPay: WillingnessToPay;
  comment: string;
}) {
  if (!isSupabaseAdminConfigured()) {
    throw new Error("PulseReel feedback storage is not configured.");
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("pulse_reel_movie_feedback")
    .upsert(
      {
        project_id: input.projectId,
        user_id: input.userId,
        identity_rating: input.identityRating,
        movie_rating: input.movieRating,
        willingness_to_pay: input.willingnessToPay,
        comment: input.comment,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "project_id,user_id" },
    )
    .select("id,project_id,user_id,identity_rating,movie_rating,willingness_to_pay,comment,created_at,updated_at")
    .single();

  if (error || !data) throw new Error("PulseReel could not save your feedback.");
  return toMovieFeedback(data as FeedbackRow);
}

export async function getFeedbackAdminSnapshot(): Promise<FeedbackAdminSnapshot> {
  if (!isSupabaseAdminConfigured()) {
    throw new Error("PulseReel feedback storage is not configured.");
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("pulse_reel_movie_feedback")
    .select("id,project_id,user_id,identity_rating,movie_rating,willingness_to_pay,comment,created_at,updated_at")
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    if (error.code === "42P01") {
      return {
        totalResponses: 0,
        averageIdentityRating: null,
        averageMovieRating: null,
        willingToPayCount: 0,
        maybePayCount: 0,
        recentFeedback: [],
      };
    }
    throw new Error("Could not load beta feedback.");
  }

  const feedback = (data ?? []).map((row) => toMovieFeedback(row as FeedbackRow));
  const totalResponses = feedback.length;
  const average = (values: number[]) =>
    values.length ? values.reduce((total, value) => total + value, 0) / values.length : null;

  return {
    totalResponses,
    averageIdentityRating: average(feedback.map((item) => item.identityRating)),
    averageMovieRating: average(feedback.map((item) => item.movieRating)),
    willingToPayCount: feedback.filter((item) => item.willingnessToPay === "yes").length,
    maybePayCount: feedback.filter((item) => item.willingnessToPay === "maybe").length,
    recentFeedback: feedback,
  };
}
