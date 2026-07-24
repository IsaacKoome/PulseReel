import { createHash, timingSafeEqual } from "node:crypto";
import type { HeavyRenderProviderId, MovieProject } from "@/lib/types";
import { getCreatorRuntimeSettings } from "@/lib/creator-settings";

export type CreatorBetaClientConfig = {
  enabled: boolean;
  generationEnabled: boolean;
  managedGenerationEnabled: boolean;
  requireAccessCode: boolean;
  defaultFunding: "managed" | "creator-byok";
  managedDailyLimit: number | null;
  launchMode: "creator-beta" | "original-mvp";
};

function enabled(value: string | undefined, fallback: boolean) {
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function positiveInteger(value: string | undefined) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function getCreatorBetaConfig(): CreatorBetaClientConfig {
  const betaEnabled = enabled(process.env.PULSEREEL_CREATOR_BETA_ENABLED, false);
  const managedGenerationEnabled = enabled(
    process.env.PULSEREEL_CREATOR_MANAGED_GENERATION_ENABLED,
    true,
  );
  const configuredDefault = process.env.PULSEREEL_CREATOR_DEFAULT_FUNDING;
  const defaultFunding =
    configuredDefault === "managed" || configuredDefault === "creator-byok"
      ? configuredDefault
      : betaEnabled
        ? "creator-byok"
        : "managed";

  return {
    enabled: betaEnabled,
    generationEnabled: enabled(process.env.PULSEREEL_GENERATION_ENABLED, true),
    managedGenerationEnabled,
    requireAccessCode: enabled(process.env.PULSEREEL_CREATOR_REQUIRE_ACCESS_CODE, false),
    defaultFunding:
      betaEnabled && !managedGenerationEnabled && defaultFunding === "managed"
        ? "creator-byok"
        : defaultFunding,
    managedDailyLimit: positiveInteger(process.env.PULSEREEL_MANAGED_DAILY_LIMIT),
    launchMode: "creator-beta",
  };
}

export async function getEffectiveCreatorBetaConfig(): Promise<CreatorBetaClientConfig> {
  const configured = getCreatorBetaConfig();
  if (!configured.enabled) return configured;

  const runtime = await getCreatorRuntimeSettings();
  if (runtime.launchMode === "original-mvp") {
    return {
      ...configured,
      enabled: false,
      managedGenerationEnabled: true,
      requireAccessCode: false,
      defaultFunding: "managed",
      managedDailyLimit: runtime.managedDailyLimit,
      launchMode: runtime.launchMode,
    };
  }

  return {
    ...configured,
    launchMode: runtime.launchMode,
  };
}

function digest(value: string) {
  return createHash("sha256").update(value).digest();
}

function safelyMatches(candidate: string, expected: string) {
  return timingSafeEqual(digest(candidate), digest(expected));
}

export function isValidCreatorAccessCode(candidate: string | undefined) {
  const codes = (process.env.PULSEREEL_CREATOR_ACCESS_CODES ?? "")
    .split(",")
    .map((code) => code.trim())
    .filter(Boolean);

  return Boolean(candidate && codes.some((code) => safelyMatches(candidate.trim(), code)));
}

export function isValidCreatorAdminToken(candidate: string | null) {
  const expected = process.env.PULSEREEL_CREATOR_BETA_ADMIN_TOKEN?.trim();
  return Boolean(candidate && expected && safelyMatches(candidate, expected));
}

export function estimatedGenerationCostUsd(provider: HeavyRenderProviderId) {
  const configured =
    provider === "replicate-kling-v3-omni"
      ? process.env.PULSEREEL_KLING_ESTIMATED_COST_USD
      : provider === "replicate-video-adapter"
        ? process.env.PULSEREEL_MINIMAX_ESTIMATED_COST_USD
        : undefined;
  const parsed = Number.parseFloat(configured ?? "");
  if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  return undefined;
}

export function isManagedProject(project: MovieProject) {
  return project.generationFunding !== "creator-byok";
}
