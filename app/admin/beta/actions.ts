"use server";

import { revalidatePath } from "next/cache";
import { isPulseReelAdmin } from "@/lib/auth/admin";
import { getCurrentUser } from "@/lib/auth/user";
import { setBetaAttemptLimit, setBetaGenerationEnabled } from "@/lib/generation-access";

export async function setGenerationEnabled(formData: FormData) {
  const user = await getCurrentUser();
  if (!isPulseReelAdmin(user)) {
    throw new Error("You are not allowed to change PulseReel beta controls.");
  }

  await setBetaGenerationEnabled(formData.get("enabled") === "true");
  revalidatePath("/admin/beta");
  revalidatePath("/create");
}

export async function setAttemptLimit(formData: FormData) {
  const user = await getCurrentUser();
  if (!isPulseReelAdmin(user)) {
    throw new Error("You are not allowed to change PulseReel beta controls.");
  }

  const rawLimit = formData.get("attemptLimit");
  const limit = typeof rawLimit === "string" ? Number(rawLimit) : Number.NaN;
  await setBetaAttemptLimit(limit);
  revalidatePath("/admin/beta");
  revalidatePath("/create");
}
