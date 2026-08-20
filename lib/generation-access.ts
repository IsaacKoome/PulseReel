import type { User } from "@supabase/supabase-js";
import { createSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/admin";
import { FREE_BETA_MANAGED_PROVIDER } from "@/lib/beta-config";
import type { HeavyRenderProviderId, RenderMode } from "@/lib/types";

export type ReservationStatus = "reserved" | "submitted" | "completed" | "failed";

export type BetaAccessReason =
  | "available"
  | "controls_off"
  | "paused"
  | "global_limit_reached"
  | "free_generation_used"
  | "sign_in_required"
  | "email_verification_required"
  | "not_configured";

export type BetaAccessStatus = {
  controlsEnabled: boolean;
  generationEnabled: boolean;
  eligible: boolean;
  reason: BetaAccessReason;
  message: string;
  totalAttemptLimit: number | null;
  totalAttemptCount: number | null;
  remainingAttempts: number | null;
  reservationStatus: ReservationStatus | null;
};

export type BetaAdminSnapshot = {
  controlsEnabled: boolean;
  generationEnabled: boolean;
  totalAttemptLimit: number;
  totalAttemptCount: number;
  remainingAttempts: number;
  counts: Record<ReservationStatus, number>;
  recentReservations: Array<{
    id: string;
    userId: string;
    projectId: string | null;
    provider: string;
    status: ReservationStatus;
    createdAt: string;
    updatedAt: string;
  }>;
};

export class GenerationAccessError extends Error {
  constructor(message: string, readonly code: string, readonly status: number) {
    super(message);
    this.name = "GenerationAccessError";
  }
}

export function areLaunchControlsEnabled() {
  return process.env.PULSEREEL_LAUNCH_CONTROLS_ENABLED === "true";
}

export function isManagedGeneration(input: {
  renderMode: RenderMode;
  heavyProvider?: HeavyRenderProviderId;
}) {
  if (input.renderMode === "seedance-2-fast") {
    return true;
  }

  return input.heavyProvider !== "local-heavy-v1";
}

function accessMessage(reason: BetaAccessReason) {
  switch (reason) {
    case "available":
      return "Your first AI movie is free during the PulseReel beta.";
    case "paused":
      return "Free beta generation is temporarily paused while we protect the project budget.";
    case "global_limit_reached":
      return "The current free-beta movie limit has been reached.";
    case "free_generation_used":
      return "You have used your free beta AI movie. Paid generation is coming soon.";
    case "sign_in_required":
      return "Sign in to claim your free beta AI movie.";
    case "email_verification_required":
      return "Verify your email before using your free beta AI movie.";
    case "not_configured":
      return "Free beta generation is paused while spending controls are configured.";
    default:
      return "PulseReel beta spending controls are not active yet.";
  }
}

export async function getGenerationAccessStatus(user: User | null): Promise<BetaAccessStatus> {
  const controlsEnabled = areLaunchControlsEnabled();
  if (!controlsEnabled) {
    return {
      controlsEnabled: false,
      generationEnabled: true,
      eligible: true,
      reason: "controls_off",
      message: accessMessage("controls_off"),
      totalAttemptLimit: null,
      totalAttemptCount: null,
      remainingAttempts: null,
      reservationStatus: null,
    };
  }

  if (!isSupabaseAdminConfigured()) {
    return {
      controlsEnabled: true,
      generationEnabled: false,
      eligible: false,
      reason: "not_configured",
      message: accessMessage("not_configured"),
      totalAttemptLimit: null,
      totalAttemptCount: null,
      remainingAttempts: null,
      reservationStatus: null,
    };
  }

  const supabase = createSupabaseAdminClient();
  const [{ data: config, error: configError }, reservationResult] = await Promise.all([
    supabase
      .from("pulse_reel_beta_config")
      .select("generation_enabled,total_attempt_limit,total_attempt_count")
      .eq("id", true)
      .maybeSingle(),
    user
      ? supabase
          .from("pulse_reel_generation_reservations")
          .select("status")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  if (configError || !config) {
    console.error("Could not read PulseReel beta configuration.", configError);
    return {
      controlsEnabled: true,
      generationEnabled: false,
      eligible: false,
      reason: "not_configured",
      message: accessMessage("not_configured"),
      totalAttemptLimit: null,
      totalAttemptCount: null,
      remainingAttempts: null,
      reservationStatus: null,
    };
  }

  if (reservationResult.error) {
    console.error("Could not read PulseReel generation reservation.", reservationResult.error);
  }

  const totalAttemptLimit = Number(config.total_attempt_limit);
  const totalAttemptCount = Number(config.total_attempt_count);
  const reservationStatus = (reservationResult.data?.status as ReservationStatus | undefined) ?? null;
  const hasUsedFreeGeneration =
    reservationStatus === "reserved" || reservationStatus === "submitted" || reservationStatus === "completed";

  let reason: BetaAccessReason = "available";
  if (!user) reason = "sign_in_required";
  else if (!user.email_confirmed_at) reason = "email_verification_required";
  else if (!config.generation_enabled) reason = "paused";
  else if (totalAttemptCount >= totalAttemptLimit) reason = "global_limit_reached";
  else if (hasUsedFreeGeneration) reason = "free_generation_used";

  return {
    controlsEnabled: true,
    generationEnabled: Boolean(config.generation_enabled),
    eligible: reason === "available",
    reason,
    message: accessMessage(reason),
    totalAttemptLimit,
    totalAttemptCount,
    remainingAttempts: Math.max(0, totalAttemptLimit - totalAttemptCount),
    reservationStatus,
  };
}

export async function trackBetaEvent(input: {
  eventType: string;
  userId?: string | null;
  projectId?: string | null;
  metadata?: Record<string, unknown>;
}) {
  if (!isSupabaseAdminConfigured()) return;

  const supabase = createSupabaseAdminClient();
  const { error } = await supabase.from("pulse_reel_beta_events").insert({
    event_type: input.eventType,
    user_id: input.userId ?? null,
    project_id: input.projectId ?? null,
    metadata: input.metadata ?? {},
  });
  if (error && error.code !== "42P01") {
    console.error("Could not record PulseReel beta event.", error);
  }
}

function friendlyReservationError(message: string) {
  if (message.includes("PULSEREEL_GENERATION_PAUSED")) {
    return new GenerationAccessError(
      "PulseReel generation is temporarily paused to protect the beta budget.",
      "generation_paused",
      503,
    );
  }
  if (message.includes("PULSEREEL_GLOBAL_LIMIT_REACHED")) {
    return new GenerationAccessError(
      "The current PulseReel beta generation limit has been reached.",
      "global_limit_reached",
      429,
    );
  }
  if (message.includes("PULSEREEL_FREE_GENERATION_USED")) {
    return new GenerationAccessError(
      "This account has already used its free beta movie.",
      "free_generation_used",
      402,
    );
  }
  return new GenerationAccessError(
    "PulseReel could not reserve this generation safely. Please try again later.",
    "reservation_failed",
    503,
  );
}

export async function reserveManagedGeneration(
  user: User | null,
  provider: string,
) {
  if (!areLaunchControlsEnabled()) {
    return null;
  }
  if (provider !== FREE_BETA_MANAGED_PROVIDER) {
    throw new GenerationAccessError(
      "The free beta currently supports Replicate AI · Recommended only.",
      "provider_not_in_free_beta",
      403,
    );
  }
  if (!isSupabaseAdminConfigured()) {
    throw new GenerationAccessError(
      "PulseReel generation is paused while the beta spending controls are configured.",
      "launch_controls_not_configured",
      503,
    );
  }
  if (!user) {
    throw new GenerationAccessError("Sign in before generating a movie.", "sign_in_required", 401);
  }
  if (!user.email_confirmed_at) {
    throw new GenerationAccessError(
      "Verify your email before using the free beta generation.",
      "email_verification_required",
      403,
    );
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.rpc("pulsereel_reserve_generation", {
    p_provider: provider,
    p_user_id: user.id,
  });

  if (error) {
    throw friendlyReservationError(error.message);
  }

  const reservation = Array.isArray(data) ? data[0] : data;
  const reservationId = reservation?.reservation_id;
  if (!reservationId || typeof reservationId !== "string") {
    throw friendlyReservationError("Missing reservation ID");
  }
  await trackBetaEvent({
    eventType: "generation_reserved",
    userId: user.id,
    metadata: { provider, reservationId },
  });
  return reservationId;
}

export async function updateGenerationReservation(
  reservationId: string | null,
  status: ReservationStatus,
  projectId?: string,
) {
  if (!reservationId || !areLaunchControlsEnabled()) {
    return;
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("pulse_reel_generation_reservations")
    .update({
      status,
      project_id: projectId ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", reservationId)
    .select("user_id,project_id,provider")
    .maybeSingle();

  if (error) {
    console.error("Could not update PulseReel generation reservation.", error);
    return;
  }

  if (data) {
    await trackBetaEvent({
      eventType: `generation_${status}`,
      userId: data.user_id,
      projectId: data.project_id,
      metadata: { provider: data.provider, reservationId },
    });
  }
}

export async function syncGenerationReservationForProject(
  projectId: string,
  status: Extract<ReservationStatus, "completed" | "failed">,
) {
  if (!areLaunchControlsEnabled() || !isSupabaseAdminConfigured()) return;

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("pulse_reel_generation_reservations")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("project_id", projectId)
    .in("status", ["reserved", "submitted"])
    .select("id,user_id,provider")
    .maybeSingle();

  if (error) {
    console.error("Could not reconcile PulseReel generation reservation.", error);
    return;
  }
  if (data) {
    await trackBetaEvent({
      eventType: `generation_${status}`,
      userId: data.user_id,
      projectId,
      metadata: { provider: data.provider, reservationId: data.id },
    });
  }
}

export async function getBetaAdminSnapshot(): Promise<BetaAdminSnapshot> {
  if (!isSupabaseAdminConfigured()) {
    throw new Error("Supabase server access is not configured.");
  }

  const supabase = createSupabaseAdminClient();
  const [{ data: config, error: configError }, { data: reservations, error: reservationsError }] =
    await Promise.all([
      supabase
        .from("pulse_reel_beta_config")
        .select("generation_enabled,total_attempt_limit,total_attempt_count")
        .eq("id", true)
        .single(),
      supabase
        .from("pulse_reel_generation_reservations")
        .select("id,user_id,project_id,provider,status,created_at,updated_at")
        .order("created_at", { ascending: false })
        .limit(50),
    ]);

  if (configError || !config) throw new Error("Could not load beta configuration.");
  if (reservationsError) throw new Error("Could not load beta reservations.");

  const counts: Record<ReservationStatus, number> = {
    reserved: 0,
    submitted: 0,
    completed: 0,
    failed: 0,
  };
  for (const reservation of reservations ?? []) {
    const status = reservation.status as ReservationStatus;
    if (status in counts) counts[status] += 1;
  }

  const totalAttemptLimit = Number(config.total_attempt_limit);
  const totalAttemptCount = Number(config.total_attempt_count);
  return {
    controlsEnabled: areLaunchControlsEnabled(),
    generationEnabled: Boolean(config.generation_enabled),
    totalAttemptLimit,
    totalAttemptCount,
    remainingAttempts: Math.max(0, totalAttemptLimit - totalAttemptCount),
    counts,
    recentReservations: (reservations ?? []).map((reservation) => ({
      id: reservation.id,
      userId: reservation.user_id,
      projectId: reservation.project_id,
      provider: reservation.provider,
      status: reservation.status as ReservationStatus,
      createdAt: reservation.created_at,
      updatedAt: reservation.updated_at,
    })),
  };
}

export async function setBetaGenerationEnabled(enabled: boolean) {
  if (!isSupabaseAdminConfigured()) {
    throw new Error("Supabase server access is not configured.");
  }
  const supabase = createSupabaseAdminClient();
  const { error } = await supabase
    .from("pulse_reel_beta_config")
    .update({ generation_enabled: enabled, updated_at: new Date().toISOString() })
    .eq("id", true);
  if (error) throw new Error("Could not update the beta generation switch.");
  await trackBetaEvent({
    eventType: enabled ? "beta_resumed" : "beta_paused",
  });
}

export async function setBetaAttemptLimit(limit: number) {
  if (!isSupabaseAdminConfigured()) {
    throw new Error("Supabase server access is not configured.");
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("The beta attempt limit must be a whole number between 1 and 100.");
  }

  const supabase = createSupabaseAdminClient();
  const { data: config, error: configError } = await supabase
    .from("pulse_reel_beta_config")
    .select("total_attempt_count")
    .eq("id", true)
    .single();

  if (configError || !config) {
    throw new Error("Could not read the current beta attempt count.");
  }
  if (limit < Number(config.total_attempt_count)) {
    throw new Error("The attempt limit cannot be lower than the attempts already used.");
  }

  const { error } = await supabase
    .from("pulse_reel_beta_config")
    .update({ total_attempt_limit: limit, updated_at: new Date().toISOString() })
    .eq("id", true);
  if (error) throw new Error("Could not update the beta attempt limit.");
}
