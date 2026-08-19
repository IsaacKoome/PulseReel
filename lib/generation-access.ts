import type { User } from "@supabase/supabase-js";
import { createSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/admin";
import type { HeavyRenderProviderId, RenderMode } from "@/lib/types";

type ReservationStatus = "reserved" | "submitted" | "completed" | "failed";

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
  const { error } = await supabase
    .from("pulse_reel_generation_reservations")
    .update({
      status,
      project_id: projectId ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", reservationId);

  if (error) {
    console.error("Could not update PulseReel generation reservation.", error);
  }
}
